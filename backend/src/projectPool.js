// 프로젝트(= 사용자가 등록한 대상 RENOBIT DB)별 커넥션 풀을 캐싱합니다.
// tb_user_rhh / tb_project_list 는 항상 고정된 RHH 관리용 DB(db.js 의 pool)에 있지만,
// tb_page_hist / tb_instance_hist 는 사용자가 선택한 프로젝트가 가리키는 DB에 있어서
// db.js 와 같은 방식(pg.Pool)으로 프로젝트별로 별도 풀을 만들어 재사용합니다.
import pg from "pg";
import { buildInstallPlan, runInstallPlan } from "./schemaInstall.js";

const { Pool, Client } = pg;

// project_id -> Pool. 매 요청마다 새로 연결하지 않고 재사용합니다.
const pools = new Map();

export function getProjectPool(project) {
  let pool = pools.get(project.project_id);
  if (!pool) {
    pool = new Pool({
      host: project.host,
      port: project.port,
      database: project.db_name,
      user: project.account,
      password: project.password,
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
    pool.on("error", (err) => {
      console.error(`[projectPool:${project.project_id}] 유휴 커넥션 오류:`, err.message);
    });
    pools.set(project.project_id, pool);
  }
  return pool;
}

// PostgreSQL 서버가 보내는 에러 메시지는 서버의 lc_messages 로케일(주로 한글 Windows
// 환경에서 EUC-KR/CP949)로 인코딩돼 있는데, node-postgres 는 이걸 UTF-8로 그대로
// 디코딩해버립니다. 그 시점에 한글 바이트가 U+FFFD(깨진 문자)로 이미 되돌릴 수 없이
// 손상되기 때문에("wemb" 사이사이 ▤▤▤ 같은 것들), 원문을 되살리는 대신 자주 나오는
// 에러 코드(SQLSTATE)/Node 에러 코드만 알아보고 우리가 직접 깨끗한 한글 메시지로
// 바꿔줍니다. 모르는 에러인데 순수 ASCII면(예: pg 자체 타임아웃 메시지) 안전하니
// 그대로 보여주고, 그것도 아니면(=원문이 깨졌을 가능성) 안전한 일반 메시지로 대체합니다.
function describeConnectionError(err) {
  switch (err.code) {
    case "28P01": // invalid_password
    case "28000": // invalid_authorization_specification
      return "계정 또는 비밀번호가 올바르지 않습니다";
    case "3D000": // invalid_catalog_name
      return "존재하지 않는 데이터베이스입니다";
    case "ENOTFOUND":
      return "호스트를 찾을 수 없습니다";
    case "ECONNREFUSED":
      return "연결이 거부되었습니다 (host/port를 확인해 주세요)";
    case "ETIMEDOUT":
      return "연결 시간이 초과되었습니다";
    case "42501": // insufficient_privilege — 자동 설치 시 읽기 전용 계정 등에서 발생
      return "테이블/트리거를 생성할 권한이 없는 계정입니다 (DDL 권한이 있는 계정으로 다시 시도해 주세요)";
    default:
      return /^[\x00-\x7F]*$/.test(err.message ?? "")
        ? err.message
        : "연결에 실패했습니다 (서버가 알 수 없는 오류를 반환했습니다)";
  }
}

// tb_page/tb_instance 는 RHH가 만드는 게 아니라 RENOBIT 제품 자체의 테이블입니다.
// 이게 없으면 "RHH 이력 기능을 아직 설치 안 한 것"이 아니라 "이 DB에 RENOBIT이
// 설치돼 있지 않은 것"이라 성격이 다릅니다 — tb_page_hist/트리거는 tb_page 위에
// 얹는 것이라 tb_page 없이는 애초에 만들 수도 없습니다. [프로젝트 연결 화면]은
// 이 base 가 하나라도 없으면 "RENOBIT 미설치" 안내를 보여주고 [프로젝트 연결]
// 버튼을 계속 비활성 상태로 둬야 합니다(그 외엔 경고만 하고 막지 않음).
const BASE_TABLES = ["tb_page", "tb_instance"];

// RHH가 이력을 쌓으려면 반드시 있어야 하는 것들(없으면 이력 자체가 안 쌓임)과,
// 있으면 부가 기능(중요표시/알람/댓글)이 켜지는 선택 항목들입니다. [프로젝트 연결
// 화면]에서 "이 DB에 이력 저장 트리거가 있는지"를 실제로 보여주기 위해 씁니다.
const REQUIRED_TABLES = ["tb_page_hist", "tb_instance_hist"];
const REQUIRED_TRIGGERS = ["trg_tb_page_hist", "trg_tb_instance_hist"];
const OPTIONAL_TABLES = ["tb_history_starred", "tb_alarm_check", "tb_history_comment", "tb_alarm_mail_log"];

// tb_user_rhh/tb_project_list 는 원래 RHH 관리용 고정 DB에만 있어야 하는 테이블이라
// "이 대상 DB"에서 확인할 이유가 원래는 없지만, [프로젝트 연결 화면]의 자동 설치가
// 이 둘도 설치 대상에 포함하기로 해서(schemaInstall.js 참고) 여기서도 존재 여부를
// 같이 확인합니다.
const MANAGEMENT_TABLES = ["tb_user_rhh", "tb_project_list"];

// 이미 접속에 성공한 client를 그대로 재사용해서(연결을 또 안 맺음) 테이블/트리거
// 존재 여부만 조회합니다. 이 조회 자체가 실패해도(예: information_schema 조회
// 권한이 없는 특수한 계정) 접속 테스트 결과 자체엔 영향 주지 않도록, 호출부에서
// 실패를 따로 잡습니다.
// 테이블은 이미 있지만 나중에 컬럼만 추가된 경우(예: 대댓글 기능의
// tb_history_comment.parent_comment_id)를 감지하기 위한, 테이블 존재 여부와는
// 별개의 컬럼 단위 확인입니다. "테이블 있음" 체크만으로는 이 컬럼이 없는 예전
// 설치를 구분할 수 없어서 따로 둡니다 — 이게 없으면 "자동 설치"가 테이블이 이미
// 있다는 이유로 컬럼 추가를 건너뛰어 버립니다.
const COLUMN_CHECKS = [
  { key: "tb_history_comment_reply", table: "tb_history_comment", column: "parent_comment_id" },
  { key: "tb_alarm_check_entry_saved_at", table: "tb_alarm_check", column: "entry_saved_at" },
];

async function checkSchema(client) {
  const tableNames = [...BASE_TABLES, ...REQUIRED_TABLES, ...OPTIONAL_TABLES, ...MANAGEMENT_TABLES];
  const [tableRes, triggerRes, columnRes] = await Promise.all([
    client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [tableNames],
    ),
    client.query(
      `SELECT DISTINCT trigger_name FROM information_schema.triggers WHERE trigger_schema = 'public' AND trigger_name = ANY($1)`,
      [REQUIRED_TRIGGERS],
    ),
    client.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [COLUMN_CHECKS.map((c) => c.table)],
    ),
  ]);
  const existingTables = new Set(tableRes.rows.map((row) => row.table_name));
  const existingTriggers = new Set(triggerRes.rows.map((row) => row.trigger_name));
  const existingColumns = new Set(columnRes.rows.map((row) => `${row.table_name}.${row.column_name}`));

  const base = {};
  for (const name of BASE_TABLES) base[name] = existingTables.has(name);

  const required = {};
  for (const name of REQUIRED_TABLES) required[name] = existingTables.has(name);
  for (const name of REQUIRED_TRIGGERS) required[name] = existingTriggers.has(name);

  const optional = {};
  for (const name of OPTIONAL_TABLES) optional[name] = existingTables.has(name);
  // 컬럼 단위 확인 결과도 optional 안에 같이 얹습니다 — buildInstallPlan()이 쓰는
  // toMissingMap()이 optional의 모든 키를 그대로 통과시키므로 별도 배선이 필요 없습니다.
  for (const { key, table, column } of COLUMN_CHECKS) optional[key] = existingColumns.has(`${table}.${column}`);

  const management = {};
  for (const name of MANAGEMENT_TABLES) management[name] = existingTables.has(name);

  return { base, required, optional, management };
}

// checkSchema() 결과(required/optional/management)에서 "없는 것"만 true인 하나의
// 평평한 맵으로 합칩니다 — schemaInstall.js의 buildInstallPlan()이 바로 쓸 수 있는
// 모양입니다. base(tb_page/tb_instance)는 여기 안 넣습니다 — RHH가 설치할 대상이
// 아니라서 자동 설치 계획에 절대 포함되면 안 되기 때문입니다.
function toMissingMap(schema) {
  const missing = {};
  for (const [name, exists] of Object.entries(schema.required)) missing[name] = !exists;
  for (const [name, exists] of Object.entries(schema.optional)) missing[name] = !exists;
  for (const [name, exists] of Object.entries(schema.management)) missing[name] = !exists;
  return missing;
}

async function testConnectionInner({ host, port, database, user, password }) {
  const client = new Client({ host, port, database, user, password, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.query("SELECT 1");

    // 접속에 성공한 김에, 같은 연결로 RHH가 필요로 하는 테이블/트리거가 이 DB에
    // 설치되어 있는지도 같이 확인합니다. [프로젝트 연결 화면]이 "연결 테스트"
    // 버튼 한 번으로 접속 가능 여부 + 스키마 상태를 동시에 보여줄 수 있게 하기
    // 위함입니다. 이 확인 자체가 실패해도 접속 테스트 결과는 성공으로 유지하고,
    // schema는 null(=확인 불가)로 내려서 프론트가 "없음"과 구분할 수 있게 합니다.
    let schema = null;
    try {
      schema = await checkSchema(client);
    } catch (err) {
      console.warn("[testConnection] 스키마 확인 실패(무시하고 접속 성공만 반환):", err.message);
    }

    return { ok: true, schema };
  } catch (err) {
    return { ok: false, error: describeConnectionError(err) };
  } finally {
    // client.end() 를 기다리지 않습니다 — 연결에 실패한 클라이언트는 end() 자체가
    // 응답 없이 멈추는 경우가 있어서, 여기서 await 하면 connectionTimeoutMillis 를
    // 지키고도 함수 전체가 계속 걸려있게 됩니다. 정리는 백그라운드로 흘려보냅니다.
    client.end().catch(() => {});
  }
}

// 프로젝트 등록/수정 시점에 실제로 접속 가능한 정보인지 확인합니다. 캐시에 남기지
// 않는 일회성 커넥션이라 Pool 대신 Client 를 바로 맺었다 끊습니다.
// 같은 사내망의 RENOBIT DB라 정상 접속은 보통 100ms 안쪽이라(직접 측정함), 잘못된
// host/port 는 굳이 오래 기다리지 않고 실패로 판단합니다.
//
// connectionTimeoutMillis 는 pg 내부 동작이라 100% 보장되지 않는 경우가 있어(예:
// 응답 없이 패킷만 버리는 호스트는 OS 차원의 TCP 재시도로 더 오래 걸릴 수 있음),
// 여기서 별도의 하드 타임아웃을 걸어 이 함수가 절대 3초 넘게 안 걸리게 만듭니다.
export async function testConnection(config) {
  return Promise.race([
    testConnectionInner(config),
    new Promise((resolve) => {
      setTimeout(() => resolve({ ok: false, error: "연결 시간이 초과되었습니다" }), 3000);
    }),
  ]);
}

// [프로젝트 연결 화면]의 "자동 설치" 버튼용. dryRun=true 면 아무것도 실행하지 않고
// "무엇을 실행할 예정인지"(plan)만 돌려줍니다 — 확인창에 SQL을 미리 보여주는 용도.
// dryRun=false(기본)면 실제로 트랜잭션으로 실행합니다.
//
// 클라이언트가 보낸 "무엇이 없는지" 정보를 신뢰하지 않고, 여기서 매번 checkSchema()를
// 다시 실행해서 서버가 직접 확인한 최신 상태로만 설치 계획을 세웁니다.
async function installSchemaInner({ host, port, database, user, password, dryRun }) {
  const client = new Client({ host, port, database, user, password, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();

    const before = await checkSchema(client);
    // tb_page/tb_instance(RENOBIT 자체 테이블) 자체가 없으면 그 위에 아무것도 설치할
    // 수 없습니다 — DDL로 해결할 수 있는 문제가 아니라서 여기서 명확히 거부합니다.
    if (!before.base.tb_page || !before.base.tb_instance) {
      return {
        ok: false,
        error: "RENOBIT이 설치되지 않은 DB입니다 (tb_page/tb_instance 없음) — 자동 설치할 수 없습니다",
      };
    }

    const plan = buildInstallPlan(toMissingMap(before));
    if (dryRun) {
      return { ok: true, dryRun: true, plan, schema: before };
    }

    const installed = await runInstallPlan(client, plan);
    const after = await checkSchema(client);
    return { ok: true, dryRun: false, installed, schema: after };
  } catch (err) {
    return { ok: false, error: describeConnectionError(err) };
  } finally {
    client.end().catch(() => {});
  }
}

export async function installSchema(config) {
  return Promise.race([
    installSchemaInner(config),
    new Promise((resolve) => {
      // DDL 여러 개를 트랜잭션으로 실행하는 거라 단순 SELECT보다 오래 걸릴 수 있어,
      // 연결 테스트(3초)보다 넉넉하게 잡습니다.
      setTimeout(() => resolve({ ok: false, error: "설치 처리 시간이 초과되었습니다" }), 10000);
    }),
  ]);
}
