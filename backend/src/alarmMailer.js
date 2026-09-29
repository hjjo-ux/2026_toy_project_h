// 알람 이메일 폴링 스캐너. 트리거를 안 쓰고, 주기적으로 각 프로젝트(대상 DB)를
// 돌면서 tb_alarm_mail_log 를 기준으로 아직 안 보낸 새 이력을 찾아 메일을 보냅니다.
//
// tb_alarm_mail_log(hist_type, hist_id) 의 UNIQUE 제약이 두 역할을 겸합니다:
//   1) 중복 발송 방지 — INSERT ... ON CONFLICT DO NOTHING 으로 "먼저 처리 성공한
//      스캔"만 실제로 메일을 보냅니다.
//   2) 재시작/다운타임 보정 커서 — MAX(hist_id) 가 "마지막으로 처리한 지점"입니다.
//
// [콜드 스타트 주의] 이 테이블이 방금 막 생겨서 아직 로그가 하나도 없는 hist_type은
// MAX(hist_id) 가 NULL 이라, 그대로 두면 그동안 쌓여있던 모든 과거 이력이 "새 알림"
// 으로 잡혀 한꺼번에 메일이 쏟아집니다. 그래서 로그가 없는 첫 스캔에서는 "지금 시점의
// 최댓값"으로 커서를 시딩만 하고 넘어가며, 그 이후에 생기는 것부터 알림 대상입니다.
import cron from "node-cron";
import { query as rhhQuery } from "./db.js";
import { getProjectPool } from "./projectPool.js";
import { sendMail } from "./mailer.js";

const POLL_MINUTES = Number(process.env.ALARM_MAIL_POLL_MINUTES) || 5;

const TARGETS = [
  { hist_type: "page", table: "tb_page_hist", nameExpr: "COALESCE(title, name)" },
  { hist_type: "inst", table: "tb_instance_hist", nameExpr: "COALESCE(title, comp_name)" },
];

// 같은 물리 DB(host+port+db_name)를 여러 프로젝트가 등록해 공유하는 경우(과거
// 휴지통 비우기 때 발견된 것과 같은 케이스)를 위해, 스캔은 물리 DB 단위로 한 번만
// 하고 수신자는 그 물리 DB를 등록한 모든 프로젝트 소유자를 전부 모아서 결정합니다.
function groupProjectsByTarget(projects) {
  const groups = new Map();
  for (const p of projects) {
    const key = `${p.host}:${p.port}:${p.db_name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  return [...groups.values()];
}

async function getRecipientEmails(projectsInGroup) {
  const userIds = [...new Set(projectsInGroup.map((p) => p.user_id))];
  const result = await rhhQuery(
    `SELECT DISTINCT email FROM tb_user_rhh WHERE user_id = ANY($1) AND email IS NOT NULL AND email <> ''`,
    [userIds],
  );
  return result.rows.map((r) => r.email);
}

async function getCursor(pool, { hist_type, table }) {
  const logRes = await pool.query(`SELECT MAX(hist_id) AS max_id FROM tb_alarm_mail_log WHERE hist_type = $1`, [
    hist_type,
  ]);
  const logMax = logRes.rows[0].max_id;
  if (logMax !== null) return Number(logMax);

  // 이 hist_type을 한 번도 처리한 적 없음 — 콜드 스타트 시딩
  const curRes = await pool.query(`SELECT MAX(hist_id) AS max_id FROM ${table}`);
  const seed = curRes.rows[0].max_id;
  if (seed === null) return 0; // 이 프로젝트엔 이력 자체가 아직 없음

  await pool.query(
    `INSERT INTO tb_alarm_mail_log (hist_type, hist_id) VALUES ($1, $2) ON CONFLICT (hist_type, hist_id) DO NOTHING`,
    [hist_type, seed],
  );
  return Number(seed);
}

async function scanNewEntries(pool, target, cursor) {
  const result = await pool.query(
    `SELECT hist_id, ${target.nameExpr} AS label, reg_dt FROM ${target.table} WHERE hist_id > $1 ORDER BY hist_id ASC`,
    [cursor],
  );
  return result.rows.map((row) => ({
    hist_type: target.hist_type,
    hist_id: Number(row.hist_id),
    label: row.label,
    reg_dt: row.reg_dt,
  }));
}

async function scanProjectGroup(projectsInGroup) {
  const representative = projectsInGroup[0];
  const pool = getProjectPool(representative);

  const newEntries = [];
  for (const target of TARGETS) {
    const cursor = await getCursor(pool, target);
    newEntries.push(...(await scanNewEntries(pool, target, cursor)));
  }
  if (newEntries.length === 0) return;

  const recipients = await getRecipientEmails(projectsInGroup);
  const typeLabel = { page: "페이지", inst: "컴포넌트" };

  for (const entry of newEntries) {
    // 이 hist_id를 처음 claim한 스캔만 아래로 진행됩니다 — 물리 DB를 공유하는
    // 다른 프로젝트 그룹이나 다음 주기 스캔과 겹쳐도 중복 발송되지 않습니다.
    const claimed = await pool.query(
      `INSERT INTO tb_alarm_mail_log (hist_type, hist_id) VALUES ($1, $2) ON CONFLICT (hist_type, hist_id) DO NOTHING RETURNING log_id`,
      [entry.hist_type, entry.hist_id],
    );
    if (claimed.rowCount === 0) continue;
    if (recipients.length === 0) continue; // 로그는 남기되(재알림 방지), 받을 사람 없으면 발송 스킵

    for (const to of recipients) {
      await sendMail({
        to,
        subject: `[RHH] ${representative.project_name} - ${typeLabel[entry.hist_type]} 변경: ${entry.label ?? entry.hist_id}`,
        text: `${representative.project_name} 프로젝트에 새 이력이 발생했습니다.\n\n종류: ${typeLabel[entry.hist_type]}\n이름: ${entry.label ?? "(제목 없음)"}\n시각: ${entry.reg_dt}\n`,
      }).catch((err) => console.error("[alarmMailer] 발송 실패:", to, err.message));
    }
  }
}

export async function runAlarmMailScan() {
  let projects;
  try {
    const result = await rhhQuery(`SELECT * FROM tb_project_list WHERE use = true`);
    projects = result.rows;
  } catch (err) {
    console.error("[alarmMailer] 프로젝트 목록 조회 실패:", err.message);
    return;
  }

  for (const group of groupProjectsByTarget(projects)) {
    try {
      await scanProjectGroup(group);
    } catch (err) {
      // tb_alarm_mail_log 가 아직 설치 안 된 프로젝트 등 — 이 그룹만 건너뛰고 계속 진행
      // (다른 프로젝트 스캔이나 핵심 기능엔 영향 없음)
      console.error(`[alarmMailer] "${group[0]?.project_name ?? "?"}" 스캔 실패:`, err.message);
    }
  }
}

// [전체 이력 보기 화면] 새로고침(= GET /api/history 호출) 시, 폴링 주기(기본 5분)를
// 기다리지 않고 "지금 보고 있는 이 프로젝트"만 즉시 한 번 더 스캔하기 위한 진입점.
// 같은 물리 DB(host+port+db_name)를 공유하는 다른 프로젝트가 있으면 그것도 같이
// 묶어서(수신자 병합) 스캔합니다 — runAlarmMailScan()의 그룹 하나만 떼어낸 것과 동일.
// 호출부에서 await 하지 않고 fire-and-forget으로 쓰는 걸 전제로, 에러를 여기서
// 전부 삼켜 호출부에 영향을 주지 않습니다.
export async function scanForProject(project) {
  let group;
  try {
    const result = await rhhQuery(
      `SELECT * FROM tb_project_list WHERE use = true AND host = $1 AND port = $2 AND db_name = $3`,
      [project.host, project.port, project.db_name],
    );
    group = result.rows;
  } catch (err) {
    console.error("[alarmMailer] scanForProject 그룹 조회 실패:", err.message);
    return;
  }
  if (group.length === 0) group = [project];

  try {
    await scanProjectGroup(group);
  } catch (err) {
    console.error(`[alarmMailer] "${project.project_name}" 즉시 스캔 실패:`, err.message);
  }
}

export function startAlarmMailScheduler() {
  cron.schedule(`*/${POLL_MINUTES} * * * *`, () => {
    runAlarmMailScan().catch((err) => console.error("[alarmMailer] 스캔 중 오류:", err.message));
  });
  console.log(`[alarmMailer] 알람 메일 스케줄러 시작 (매 ${POLL_MINUTES}분)`);
}
