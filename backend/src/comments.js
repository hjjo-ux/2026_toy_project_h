// 이력에 달리는 댓글(대화) 관련 조회/작성/수정/삭제.
//
// tb_history_comment 는 tb_alarm_check/tb_history_starred 와 같은 이유로 같은
// 자리(이력 테이블과 같은 대상 DB)에 있습니다 — 댓글이 참조하는 hist_id가 그 DB
// 안에 있어야 크로스 DB 조인 없이 끝납니다. 다만 저 둘과 다르게 댓글은 "나만
// 보는 값"이 아니라 "모두가 보는 값"이라, 작성자별로 걸러내지 않고 그 이력에
// 달린 댓글 전체를 그대로 돌려줍니다.
//
// 작성자의 닉네임(user_name)은 RHH 관리 DB(tb_user_rhh)에 있어서, 댓글을 가져온
// 뒤 여기서 한 번 더(cross-DB 조인이 아니라 애플리케이션 레벨에서) 조회해 합칩니다.
// 이 조회가 실패해도 댓글 자체는 보여줘야 하므로 실패를 삼키고 userName만 null로 둡니다.
//
//   CREATE TABLE tb_history_comment (
//     comment_id        BIGSERIAL PRIMARY KEY,
//     hist_type         VARCHAR(10)   NOT NULL,        -- 'page' | 'inst'
//     hist_id           INTEGER       NOT NULL,
//     parent_comment_id BIGINT NULL REFERENCES tb_history_comment(comment_id) ON DELETE CASCADE,
//                                                       -- NULL이면 원댓글, 값이 있으면 그 댓글의 대댓글
//     user_id           VARCHAR(1000) NOT NULL,        -- 작성자. tb_user_rhh.user_id 와 같은 문자열(FK 아님)
//     content           TEXT          NOT NULL,
//     created_at        TIMESTAMP     NOT NULL DEFAULT now(),
//     updated_at        TIMESTAMP     NOT NULL DEFAULT now()
//   );
//
// 대댓글도 hist_type/hist_id는 부모 댓글과 동일하게(=그 이력 그대로) 채웁니다 —
// "이 이력에 달린 댓글 전체"를 가져오는 쿼리가 대댓글 유무와 무관하게 그대로
// 동작하게 하기 위함이고, 원댓글/대댓글 구분은 parent_comment_id 로만 합니다.
import { query as rhhQuery } from "./db.js";
import { deleteCheckedForComments } from "./alarms.js";

// entries.js 가 만드는 id 는 "page-39" / "inst-101" 형식입니다.
function splitEntryId(id) {
  const at = id.indexOf("-");
  if (at === -1) return null;
  const histType = id.slice(0, at);
  const histId = id.slice(at + 1);
  if (!/^\d+$/.test(histId)) return null;
  if (histType !== "page" && histType !== "inst") return null;
  return { histType, histId };
}

function toDto(row) {
  return {
    commentId: Number(row.comment_id),
    id: `${row.hist_type}-${row.hist_id}`,
    parentCommentId: row.parent_comment_id != null ? Number(row.parent_comment_id) : null,
    userId: row.user_id,
    userName: row.user_name ?? null,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// 여러 작성자의 닉네임을 RHH 관리 DB에서 한 번에 조회해 { user_id: user_name } 맵으로 돌려줍니다.
async function fetchUserNames(userIds) {
  const uniqueIds = [...new Set(userIds)];
  if (uniqueIds.length === 0) return new Map();
  try {
    const { rows } = await rhhQuery(`SELECT user_id, user_name FROM tb_user_rhh WHERE user_id = ANY($1)`, [
      uniqueIds,
    ]);
    return new Map(rows.map((row) => [row.user_id, row.user_name]));
  } catch (err) {
    console.warn("[comments] 작성자 닉네임 조회 실패(무시하고 계속):", err.message);
    return new Map();
  }
}

// id(예: "page-39")에 달린 댓글 전체를 오래된순(대화창처럼 아래로 쌓이는 순서)으로
// 돌려줍니다. id 형식이 잘못됐으면 null(호출부가 400 처리).
export async function getCommentsForEntry({ id, query: runQuery }) {
  const parsed = splitEntryId(id);
  if (!parsed) return null;

  const { rows } = await runQuery(
    `SELECT * FROM tb_history_comment WHERE hist_type = $1 AND hist_id = $2 ORDER BY created_at ASC`,
    [parsed.histType, parsed.histId],
  );
  const names = await fetchUserNames(rows.map((row) => row.user_id));
  return rows.map((row) => toDto({ ...row, user_name: names.get(row.user_id) }));
}

// 댓글(또는 대댓글) 작성. 작성자는 항상 호출부가 넘긴 userId(토큰 주인)입니다.
// parentCommentId 를 넘기면 그 댓글에 대한 대댓글로 저장합니다 — 대댓글 대상이
// 실제로 존재하고, 같은 이력(id)에 달린 댓글이 맞는지 먼저 확인합니다(다른
// 이력의 댓글에 몰래 대댓글이 달리는 걸 방지).
//
// 반환: { status: "invalid_id" | "parent_not_found" | "parent_mismatch" | "ok", comment? }
export async function createComment({ id, userId, content, parentCommentId = null, query: runQuery }) {
  const parsed = splitEntryId(id);
  if (!parsed) return { status: "invalid_id" };

  if (parentCommentId != null) {
    const parentRes = await runQuery(`SELECT hist_type, hist_id FROM tb_history_comment WHERE comment_id = $1`, [
      parentCommentId,
    ]);
    if (parentRes.rowCount === 0) return { status: "parent_not_found" };
    const parent = parentRes.rows[0];
    if (parent.hist_type !== parsed.histType || String(parent.hist_id) !== String(parsed.histId)) {
      return { status: "parent_mismatch" };
    }
  }

  const { rows } = await runQuery(
    `INSERT INTO tb_history_comment (hist_type, hist_id, parent_comment_id, user_id, content)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [parsed.histType, parsed.histId, parentCommentId, userId, content],
  );
  const names = await fetchUserNames([userId]);
  return { status: "ok", comment: toDto({ ...rows[0], user_name: names.get(userId) }) };
}

// 댓글 수정. 작성자 본인만 수정할 수 있습니다.
export async function updateComment({ commentId, userId, content, query: runQuery }) {
  const existing = await runQuery(`SELECT user_id FROM tb_history_comment WHERE comment_id = $1`, [
    commentId,
  ]);
  if (existing.rowCount === 0) return { status: "not_found" };
  if (existing.rows[0].user_id !== userId) return { status: "forbidden" };

  const { rows } = await runQuery(
    `UPDATE tb_history_comment SET content = $1, updated_at = now() WHERE comment_id = $2 RETURNING *`,
    [content, commentId],
  );
  const names = await fetchUserNames([userId]);
  return { status: "ok", comment: toDto({ ...rows[0], user_name: names.get(userId) }) };
}

// 댓글 삭제. 작성자 본인만 삭제할 수 있습니다.
export async function deleteComment({ commentId, userId, query: runQuery }) {
  const existing = await runQuery(`SELECT user_id FROM tb_history_comment WHERE comment_id = $1`, [
    commentId,
  ]);
  if (existing.rowCount === 0) return "not_found";
  if (existing.rows[0].user_id !== userId) return "forbidden";

  // ON DELETE CASCADE로 대댓글도 같이 지워지므로, 지워지기 전에 영향받을
  // comment_id(자신 + 모든 대댓글)를 먼저 구해서 tb_alarm_check 기록도 같이 정리합니다.
  const affected = await runQuery(
    `WITH RECURSIVE descendants AS (
       SELECT comment_id FROM tb_history_comment WHERE comment_id = $1
       UNION ALL
       SELECT c.comment_id FROM tb_history_comment c JOIN descendants d ON c.parent_comment_id = d.comment_id
     )
     SELECT comment_id FROM descendants`,
    [commentId],
  );
  await deleteCheckedForComments({ commentIds: affected.rows.map((row) => row.comment_id), query: runQuery });

  await runQuery(`DELETE FROM tb_history_comment WHERE comment_id = $1`, [commentId]);
  return "ok";
}

// 이력이 영구 삭제될 때 그 이력에 달려있던 댓글도 같이 지웁니다(고아 row 방지).
// tb_alarm_check/tb_history_starred 정리 함수와 같은 이유·같은 패턴입니다.
// tb_history_comment 가 없는 프로젝트에서도 삭제 자체(핵심 기능)는 계속 성공해야
// 하므로 여기서 실패를 삼킵니다.
export async function deleteCommentsForHist({ histType, histId, query: runQuery }) {
  try {
    const ids = await runQuery(`SELECT comment_id FROM tb_history_comment WHERE hist_type = $1 AND hist_id = $2`, [
      histType,
      histId,
    ]);
    await deleteCheckedForComments({ commentIds: ids.rows.map((row) => row.comment_id), query: runQuery });
    await runQuery(`DELETE FROM tb_history_comment WHERE hist_type = $1 AND hist_id = $2`, [histType, histId]);
  } catch (err) {
    console.warn("[deleteCommentsForHist] 정리 실패(무시하고 계속):", err.message);
  }
}

// 위와 같은 정리를, "휴지통 비우기"처럼 한 번에 여러 이력이 삭제될 때 쓰는 버전입니다.
// entries: [{ histType, histId }, ...]
export async function deleteCommentsForHists({ entries, query: runQuery }) {
  if (!entries || entries.length === 0) return;
  try {
    const pageIds = entries.filter((e) => e.histType === "page").map((e) => e.histId);
    const instIds = entries.filter((e) => e.histType === "inst").map((e) => e.histId);

    const affected = await runQuery(
      `SELECT comment_id FROM tb_history_comment
       WHERE (hist_type = 'page' AND hist_id = ANY($1::int[]))
          OR (hist_type = 'inst' AND hist_id = ANY($2::int[]))`,
      [pageIds, instIds],
    );
    await deleteCheckedForComments({ commentIds: affected.rows.map((row) => row.comment_id), query: runQuery });

    if (pageIds.length > 0) {
      await runQuery(`DELETE FROM tb_history_comment WHERE hist_type = 'page' AND hist_id = ANY($1::int[])`, [
        pageIds,
      ]);
    }
    if (instIds.length > 0) {
      await runQuery(`DELETE FROM tb_history_comment WHERE hist_type = 'inst' AND hist_id = ANY($1::int[])`, [
        instIds,
      ]);
    }
  } catch (err) {
    console.warn("[deleteCommentsForHists] 정리 실패(무시하고 계속):", err.message);
  }
}

// GET /api/history 목록에 댓글 개수를 얹기 위한, 이 프로젝트 전체의
// "page-39"/"inst-101" -> 개수 맵입니다. tb_history_starred 의 getStarredIds 와
// 비슷하지만, 댓글은 사용자별로 안 갈리는 값이라 userId 를 안 받습니다.
export async function getCommentCounts({ query: runQuery }) {
  const { rows } = await runQuery(
    `SELECT hist_type, hist_id, COUNT(*)::int AS cnt FROM tb_history_comment GROUP BY hist_type, hist_id`,
  );
  return new Map(rows.map((row) => [`${row.hist_type}-${row.hist_id}`, row.cnt]));
}
