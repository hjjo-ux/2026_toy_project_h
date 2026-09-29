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
//     PRIMARY KEY (user_id, hist_type, hist_id)
//   );
import { query as defaultQuery } from "./db.js";
import { getAllEntries } from "./entries.js";

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
// (작성자/내용 등) 같은 배열에 안 섞고 별도로 다룹니다 — 본인이 쓴 댓글도 페이지
// 편집자를 안 가리는 지금 방식과 똑같이 예외 없이 "안 읽음" 대상에 포함합니다.
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

// 로그인한 사용자가 아직 확인하지 않은 댓글/대댓글만 돌려줍니다.
export async function getUnreadComments({ userId, query: runQuery = defaultQuery }) {
  const [comments, checkedIds] = await Promise.all([fetchAllComments(runQuery), fetchCheckedIds(runQuery, userId)]);
  return comments.filter((comment) => !checkedIds.has(comment.id));
}

async function fetchCheckedIds(runQuery, userId) {
  const { rows } = await runQuery(`SELECT hist_type, hist_id FROM tb_alarm_check WHERE user_id = $1`, [
    userId,
  ]);
  return new Set(rows.map((row) => `${row.hist_type}-${row.hist_id}`));
}

// 로그인한 사용자가 이 프로젝트에서 아직 확인하지 않은 이력만 돌려줍니다.
// (숨김 처리된 이력은 getAllEntries 가 기본으로 이미 빼줍니다.)
export async function getUnreadEntries({ userId, query: runQuery = defaultQuery }) {
  const [entries, checkedIds] = await Promise.all([
    getAllEntries({ query: runQuery }),
    fetchCheckedIds(runQuery, userId),
  ]);
  return entries.filter((entry) => !checkedIds.has(entry.id));
}

// 이력 하나를 "확인함"으로 기록합니다. 이미 확인한 것이면 조용히 무시합니다.
// id 형식이 잘못됐으면 false 를 돌려주고(호출부가 400 처리), 정상이면 true.
export async function checkEntry({ userId, id, query: runQuery = defaultQuery }) {
  const parsed = splitEntryId(id);
  if (!parsed) return false;

  await runQuery(
    `INSERT INTO tb_alarm_check (user_id, hist_type, hist_id) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [userId, parsed.histType, parsed.histId],
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
    values.push(userId, parsed.histType, parsed.histId);
    const base = index * 3;
    return `($${base + 1}, $${base + 2}, $${base + 3})`;
  });

  await runQuery(
    `INSERT INTO tb_alarm_check (user_id, hist_type, hist_id) VALUES ${placeholders.join(", ")}
     ON CONFLICT DO NOTHING`,
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
