// 미확인 알람(변경 이력 중 아직 안 본 것) 관련 조회/처리.
//
// tb_alarm_check 는 tb_page_hist/tb_instance_hist 와 같은 대상 DB(프로젝트가
// 가리키는 RENOBIT DB)에 있습니다 — RHH 관리 DB(db.js)와는 별개이고, 어느 사용자가
// 어느 이력을 "확인"했는지는 (user_id, hist_type, hist_id) 조합으로 기록됩니다.
// 트리거로 미리 만들어두지 않고, entries.js 가 이미 갖고 있는 전체 이력 목록에서
// tb_alarm_check 에 없는 것만 골라내는 방식이라 새 테이블 하나 말고는 아무것도
// 추가로 필요하지 않습니다.
//
//   CREATE TABLE tb_alarm_check (
//     user_id    VARCHAR(1000) NOT NULL,  -- tb_user_rhh.user_id 와 같은 문자열
//     hist_type  VARCHAR(10) NOT NULL,   -- 'page' | 'inst' (entries.js 의 id 접두사와 동일)
//     hist_id    INTEGER NOT NULL,
//     checked_at TIMESTAMP NOT NULL DEFAULT now(),
//     entry_saved_at VARCHAR(20) NULL,   -- 확인 당시 그 이력의 저장 시각(entries.js의 savedAt).
//                                        -- hist_id가 나중에 재사용(DB 리셋 등)되어 내용이 바뀌면
//                                        -- 이 값이 달라지므로 "다시 안읽음"으로 되돌릴 수 있습니다.
//     PRIMARY KEY (user_id, hist_type, hist_id)
//   );
import { query as defaultQuery } from "./db.js";
import { getAllEntries, getEntryById } from "./entries.js";

// entries.js 가 만드는 id 는 "page-39" / "inst-101" 형식입니다. tb_alarm_check 의
// hist_type/hist_id 컬럼은 그 접두사/숫자를 그대로 나눠 담습니다. 댓글/대댓글도
// 같은 방식으로 "comment-42"(comment_id) 형식을 씁니다 — 새 테이블 없이
// tb_alarm_check 를 그대로 재사용하기 위함입니다.
function splitEntryId(id) {
  const at = id.indexOf("-");
  if (at === -1) return null;
  const histType = id.slice(0, at);
  const histId = id.slice(at + 1);
  if (!/^\d+$/.test(histId)) return null;
  if (histType !== "page" && histType !== "inst" && histType !== "comment") return null;
  return { histType, histId };
}

// 이 프로젝트에 달린 댓글/대댓글 전체를, 이력 항목과 같은 방식으로 확인 처리할 수
// 있도록 id("comment-42")를 붙여서 돌려줍니다. 페이지/인스턴스 이력과 모양이 달라서
// (작성자/내용 등) 같은 배열에 안 섞고 별도로 다룹니다.
async function fetchAllComments(runQuery) {
  const { rows } = await runQuery(
    `SELECT comment_id, hist_type, hist_id, parent_comment_id, user_id, content, created_at
     FROM tb_history_comment ORDER BY created_at ASC`,
  );
  return rows.map((row) => ({
    id: `comment-${row.comment_id}`,
    targetId: `${row.hist_type}-${row.hist_id}`,
    parentCommentId: row.parent_comment_id != null ? Number(row.parent_comment_id) : null,
    userId: row.user_id,
    content: row.content,
    createdAt: row.created_at,
  }));
}

// 로그인한 사용자가 아직 확인하지 않은 댓글/대댓글만 돌려줍니다. 본인이 쓴
// 댓글/대댓글은 본인에게는 애초에 "새 알림"이 아니므로 제외합니다(팀원에게는
// 그대로 보임 — userId 기준으로 각자 다르게 걸러지는 부분이라 자연히 됩니다).
export async function getUnreadComments({ userId, query: runQuery = defaultQuery }) {
  const [comments, checkedMap] = await Promise.all([fetchAllComments(runQuery), fetchCheckedMap(runQuery, userId)]);
  return comments.filter((comment) => comment.userId !== userId && !checkedMap.has(comment.id));
}

// user_id -> Map(id -> entry_saved_at 확인 당시 저장값). 댓글 쪽은 이 값을 안 쓰고
// has()로 존재 여부만 보므로 영향 없습니다.
async function fetchCheckedMap(runQuery, userId) {
  const { rows } = await runQuery(`SELECT hist_type, hist_id, entry_saved_at FROM tb_alarm_check WHERE user_id = $1`, [
    userId,
  ]);
  const map = new Map();
  for (const row of rows) map.set(`${row.hist_type}-${row.hist_id}`, row.entry_saved_at);
  return map;
}

// 로그인한 사용자가 이 프로젝트에서 아직 확인하지 않은 이력만 돌려줍니다.
// (숨김 처리된 이력은 getAllEntries 가 기본으로 이미 빼줍니다.)
//
// hist_id가 재사용될 수 있다는 전제 하에(예: 공유 테스트 DB를 통째로 리셋하면
// bigserial 시퀀스도 다시 1부터 시작), 단순히 "확인한 적 있는 id인지"만 보면
// 안 됩니다 — 재사용된 새 내용이 과거에 확인했던 옛 내용과 같은 id를 갖게 되어
// 실제로는 처음 보는 내용인데도 "이미 확인함"으로 숨겨지는 버그가 생깁니다.
// 그래서 확인 당시 저장해둔 entry_saved_at과 지금 값을 비교해서, 달라졌으면
// (=같은 id인데 내용이 바뀜) 다시 안읽음으로 간주합니다. 이 컬럼이 생기기 전에
// 이미 확인된 기존 기록(entry_saved_at이 NULL)은 그대로 "읽음"으로 유지합니다
// (안 그러면 배포 순간 모든 사용자의 전체 이력이 한꺼번에 안읽음으로 쏟아집니다).
export async function getUnreadEntries({ userId, query: runQuery = defaultQuery }) {
  const [entries, checkedMap] = await Promise.all([
    getAllEntries({ query: runQuery }),
    fetchCheckedMap(runQuery, userId),
  ]);
  return entries.filter((entry) => {
    if (!checkedMap.has(entry.id)) return true;
    const checkedSavedAt = checkedMap.get(entry.id);
    if (checkedSavedAt === null) return false;
    return checkedSavedAt !== entry.savedAt;
  });
}

// 이력 하나를 "확인함"으로 기록합니다. 이미 확인한 기록이 있으면(재확인) 저장
// 시각도 지금 값으로 갱신합니다 — 안 그러면 한 번 확인한 뒤 id가 재사용돼도
// 다시 확인 처리할 방법이 없어집니다. id 형식이 잘못됐으면 false(호출부가 400 처리).
export async function checkEntry({ userId, id, query: runQuery = defaultQuery }) {
  const parsed = splitEntryId(id);
  if (!parsed) return false;

  // 댓글(comment)은 entry_saved_at 개념이 없음(재사용 이슈 자체가 해당 안 됨) — null로 둡니다.
  const entry = parsed.histType === "comment" ? null : await getEntryById(id, { query: runQuery });
  const savedAt = entry?.savedAt ?? null;

  await runQuery(
    `INSERT INTO tb_alarm_check (user_id, hist_type, hist_id, entry_saved_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, hist_type, hist_id)
     DO UPDATE SET entry_saved_at = EXCLUDED.entry_saved_at, checked_at = now()`,
    [userId, parsed.histType, parsed.histId, savedAt],
  );
  return true;
}

// 지금 시점 기준 미확인 전체(이력 + 댓글/대댓글)를 한 번에 확인 처리합니다
// ("전체알림확인" 버튼용). 몇 건을 처리했는지 돌려줍니다.
export async function checkAllEntries({ userId, query: runQuery = defaultQuery }) {
  const [unreadEntries, unreadComments] = await Promise.all([
    getUnreadEntries({ userId, query: runQuery }),
    // tb_history_comment 가 없는 프로젝트도 있어서(부가 기능), 여기서 실패해도
    // 이력 쪽 "전체 확인"은 계속 되도록 실패를 삼키고 빈 배열로 처리합니다.
    getUnreadComments({ userId, query: runQuery }).catch((err) => {
      console.warn("[checkAllEntries] 댓글 알람 조회 실패(무시하고 계속):", err.message);
      return [];
    }),
  ]);
  const unread = [...unreadEntries, ...unreadComments];
  if (unread.length === 0) return 0;

  const values = [];
  const placeholders = unread.map((entry, index) => {
    const parsed = splitEntryId(entry.id);
    // 댓글은 savedAt 개념이 없어서 null — 이력(page/inst)만 entry.savedAt을 저장합니다.
    values.push(userId, parsed.histType, parsed.histId, entry.savedAt ?? null);
    const base = index * 4;
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
  });

  await runQuery(
    `INSERT INTO tb_alarm_check (user_id, hist_type, hist_id, entry_saved_at) VALUES ${placeholders.join(", ")}
     ON CONFLICT (user_id, hist_type, hist_id)
     DO UPDATE SET entry_saved_at = EXCLUDED.entry_saved_at, checked_at = now()`,
    values,
  );
  return unread.length;
}

// 이력이 영구 삭제될 때 그 이력에 대한 확인 기록도 같이 지웁니다. tb_history_starred와
// 같은 이유로 user_id로 좁히지 않고 그 (hist_type, hist_id)를 가리키던 행 전부를 지웁니다
// — 안 그러면 이미 없는 이력을 가리키는 고아 row로 계속 남습니다. tb_alarm_check 가 없는
// 프로젝트에서도 삭제 자체(핵심 기능)는 계속 성공해야 하므로 여기서 실패를 삼킵니다.
export async function deleteCheckedForHist({ histType, histId, query: runQuery = defaultQuery }) {
  try {
    await runQuery(`DELETE FROM tb_alarm_check WHERE hist_type = $1 AND hist_id = $2`, [
      histType,
      histId,
    ]);
  } catch (err) {
    console.warn("[deleteCheckedForHist] 정리 실패(무시하고 계속):", err.message);
  }
}

// 댓글(또는 대댓글)이 삭제될 때 그 확인 기록도 같이 지웁니다. tb_alarm_check는
// tb_history_comment에 대한 FK가 아니라서(범용 테이블이라 걸 수 없음), 댓글이
// ON DELETE CASCADE로 지워져도 이 기록은 자동으로 안 지워집니다 — 호출부(comments.js)가
// 삭제되기 "전에" 영향받을 comment_id 전부(자신 + 모든 대댓글)를 넘겨줘야 합니다.
export async function deleteCheckedForComments({ commentIds, query: runQuery = defaultQuery }) {
  if (!commentIds || commentIds.length === 0) return;
  try {
    await runQuery(`DELETE FROM tb_alarm_check WHERE hist_type = 'comment' AND hist_id = ANY($1::int[])`, [
      commentIds,
    ]);
  } catch (err) {
    console.warn("[deleteCheckedForComments] 정리 실패(무시하고 계속):", err.message);
  }
}

// 위와 같은 정리를, "휴지통 비우기"처럼 한 번에 여러 이력이 삭제될 때 쓰는 버전입니다.
// entries: [{ histType, histId }, ...]
export async function deleteCheckedForHists({ entries, query: runQuery = defaultQuery }) {
  if (!entries || entries.length === 0) return;
  try {
    const pageIds = entries.filter((e) => e.histType === "page").map((e) => e.histId);
    const instIds = entries.filter((e) => e.histType === "inst").map((e) => e.histId);
    if (pageIds.length > 0) {
      await runQuery(
        `DELETE FROM tb_alarm_check WHERE hist_type = 'page' AND hist_id = ANY($1::int[])`,
        [pageIds],
      );
    }
    if (instIds.length > 0) {
      await runQuery(
        `DELETE FROM tb_alarm_check WHERE hist_type = 'inst' AND hist_id = ANY($1::int[])`,
        [instIds],
      );
    }
  } catch (err) {
    console.warn("[deleteCheckedForHists] 정리 실패(무시하고 계속):", err.message);
  }
}
