# API_sub.md — 이번에 전달할 내용만 발췌

`API.md`(전체 API 문서)에서, 지금 요청하신 부분만 뽑아둔 파일입니다. 매번 전체 문서를
주기 애매할 때 이 파일 내용만 갈아끼워서 전달하는 용도라, **여기 내용은 다음 요청이
오면 다른 내용으로 덮어써집니다** — 계속 남겨둘 내용이면 `API.md` 쪽을 보세요.

---

## 알람(우측 상단 배지) — 댓글/대댓글 포함하도록 변경

**엔드포인트는 그대로**입니다(`GET /api/alarms?projectId=`), **응답 모양만** 바뀌었습니다.

### 이전 응답
```json
[ ...이력 항목 배열... ]
```

### 변경된 응답
```json
{
  "entries": [ /* 이전과 완전히 동일한 모양의 이력 항목 배열 */ ],
  "comments": [
    {
      "id": "comment-42",
      "targetId": "page-80",
      "parentCommentId": null,
      "userId": "hjjo2",
      "content": "댓글 내용",
      "createdAt": "2026-09-29T23:03:19.134Z"
    }
  ]
}
```
- `targetId`: 이 댓글이 달린 이력의 id(`page-80`/`inst-107`) — 클릭 시 그 이력 상세/댓글창으로 이동할 때 씀
- `parentCommentId`: `null`이면 원댓글, 값이 있으면 그 댓글(comment_id)의 대댓글

### 프론트에서 반영해야 할 것
1. **배지 카운트** = `entries.length + comments.length`
2. **댓글 항목 클릭** → `targetId`로 그 이력의 상세/댓글창으로 이동
3. **개별 확인 처리**(`POST /api/alarms/:id/check?projectId=`) — 댓글/대댓글은 `id`를 `comment-42`(comment_id) 형식으로 호출 (이력은 기존과 동일하게 `page-39`/`inst-101`)
4. **전체 확인**(`POST /api/alarms/check-all?projectId=`) — 호출 방식 그대로, 백엔드가 이력+댓글 한 번에 같이 처리함
5. **본인이 쓴 댓글도 예외 없이 "안 읽음"으로 뜹니다** — 본인이 편집한 이력도 본인 알람에 뜨는 기존 규칙과 동일하게 맞춘 것 (의도된 동작)

### 참고
- `tb_history_comment`가 아직 설치 안 된 프로젝트에서는 `comments`가 항상 빈 배열(`[]`)로 옵니다 — 에러 안 남
