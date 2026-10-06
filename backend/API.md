# RHH 백엔드 API 문서

프론트엔드 개발용 참고 문서입니다. 실제 구현은 `src/server.js` 참고 — 이 문서는 요청/응답
모양과 화면별 사용처를 정리한 것이고, SQL 등 구현 detail은 코드 쪽 주석에 있습니다.

## 공통 사항

- **Base URL**: dev 환경에서는 Vite가 `/api` 경로를 백엔드(`localhost:4000`)로 프록시합니다.
- **인증**: "필요"인 API는 요청 헤더에 로그인 시 받은 토큰을 실어 보내야 합니다. 없거나
  틀리면 `401`이 납니다.
  ```
  Authorization: Bearer <token>
  ```
- **에러 응답**: 전부 아래 모양입니다.
  ```json
  { "error": "사람이 읽을 수 있는 메시지" }
  ```
- 요청/응답 바디는 전부 JSON (`Content-Type: application/json`)
- `/api/history*`, `/api/alarms*` 는 인증 외에 **`?projectId=` 쿼리 파라미터도 필수**입니다 —
  어느 프로젝트(=대상 RENOBIT DB)의 이력/알람인지를 이걸로 정하고, 내(토큰 주인) 프로젝트가
  맞는지 확인한 뒤에만 응답합니다. 프로젝트를 하나도 안 골랐으면 애초에 호출할 수 없습니다.

## REST API 요약표

| 도메인 | Method | Path | 인증 | 프론트 호출 위치 |
|---|---|---|---|---|
| 인증/계정 | POST | `/api/rhh/users` | 불필요 | SignupPage.jsx |
| 인증/계정 | POST | `/api/rhh/login` | 불필요 | LoginPage.jsx, SignupPage.jsx(가입 후 자동 로그인) |
| 인증/계정 | PUT | `/api/rhh/users/me/nickname` | 필요 | AccountSettingsPage.jsx |
| 인증/계정 | PUT | `/api/rhh/users/me/email` | 필요 | *(미구현 화면 — 계정정보 수정의 이메일 수정 예정)* |
| 인증/계정 | PUT | `/api/rhh/users/me/password` | 필요 | AccountSettingsPage.jsx |
| 인증/계정 | DELETE | `/api/rhh/users/me` | 필요 | AccountSettingsPage.jsx |
| 인증/계정 | PUT | `/api/rhh/users/password-reset` | 불필요 | *(미구현 화면 — 로그인 화면의 "패스워드 찾기" 페이지 예정)* |
| 프로젝트 | GET | `/api/rhh/projects` | 필요 | LoginPage.jsx, ProjectContext.jsx(전역 목록) |
| 프로젝트 | POST | `/api/rhh/projects/test-connection` | 필요 | ProjectConnectPage.jsx |
| 프로젝트 | POST | `/api/rhh/projects/install-schema` | 필요 | *(미구현 화면 — 자동 설치 버튼 예정)* |
| 프로젝트 | POST | `/api/rhh/projects` | 필요 | ProjectConnectPage.jsx (ProjectContext.jsx 경유) |
| 프로젝트 | PUT | `/api/rhh/projects/:projectId/name` | 필요 | ProjectConnectPage.jsx (ProjectContext.jsx 경유) |
| 프로젝트 | DELETE | `/api/rhh/projects/:projectId` | 필요 | ProjectConnectPage.jsx, ProjectSwitcher.jsx (ProjectContext.jsx 경유) |
| 프로젝트 | PUT | `/api/rhh/users/me/recent-project` | 필요 | ProjectConnectPage.jsx, ProjectSwitcher.jsx (프로젝트 선택 시 자동 호출) |
| 이력 | GET | `/api/history` | 필요 | HistoryListPage.jsx (HistoryContext.jsx 경유) |
| 이력 | GET | `/api/history/:id` | 필요 | *(미사용 — 목록에서 id로 직접 찾아 씀)* |
| 이력 | GET | `/api/history/compare` | 필요 | *(미사용 — 목록에서 두 항목 직접 찾아 씀)* |
| 이력 | PUT | `/api/history/:id/metadata` | 필요 | HistoryListPage.jsx, HistoryDetailPage.jsx (HistoryContext.jsx 경유) |
| 이력 | PUT | `/api/history/:id/important` | 필요 | *(미구현 화면 — 중요 표시(⭐) 예정)* |
| 이력 | GET | `/api/history/:id/comments` | 필요 | *(미구현 화면 — 댓글창 예정)* |
| 이력 | POST | `/api/history/:id/comments` | 필요 | *(미구현 화면 — 댓글창 예정)* |
| 이력 | PUT | `/api/history/comments/:commentId` | 필요 | *(미구현 화면 — 댓글창 예정)* |
| 이력 | DELETE | `/api/history/comments/:commentId` | 필요 | *(미구현 화면 — 댓글창 예정)* |
| 이력 | GET | `/api/history/trash` | 필요 | *(미구현 화면 — 휴지통 화면 예정)* |
| 이력 | DELETE | `/api/history/:id` | 필요 | *(미구현 화면 — 휴지통 화면의 개별 삭제 예정)* |
| 이력 | DELETE | `/api/history/trash` | 필요 | *(미구현 화면 — 휴지통 비우기 예정)* |
| 알람 | GET | `/api/alarms` | 필요 | *(미사용 — 아직 화면 없음)* |
| 알람 | POST | `/api/alarms/check-all` | 필요 | *(미사용 — 아직 화면 없음)* |
| 알람 | POST | `/api/alarms/:id/check` | 필요 | *(미사용 — 아직 화면 없음)* |
| (헬스체크) | GET | `/api/health` | 불필요 | *(프론트 미호출 — 서버/DB 살아있는지 확인용)* |

> **인증 열 설명**: "필요"는 `Authorization: Bearer <token>` 헤더가 없으면 `401`, "불필요"는
> 헤더 없이 그냥 호출 가능(로그인 전에도 써야 하는 API들). `/api/history*`, `/api/alarms*`는
> 토큰 검사와 별개로 `?projectId=`도 항상 같이 보내야 합니다(위 공통 사항 참고).

---

## 인증/계정

### 회원가입
`POST /api/rhh/users` — 인증 불필요

**요청**
```json
{ "userId": "string", "password": "string (4자 이상)" }
```

**성공 (201)**
```json
{ "userId": "string" }
```

**에러**: `400` 형식 오류 · `409` 이미 존재하는 아이디

---

### 로그인
`POST /api/rhh/login` — 인증 불필요

**요청**
```json
{ "userId": "string", "password": "string" }
```

**성공 (200)**
```json
{
  "token": "JWT 문자열 — 이후 요청에 계속 사용",
  "userId": "string",
  "projectRecent": "string | null",
  "userName": "string | null (닉네임, 안 정했으면 null)",
  "userEmail": "string | null (안 정했으면 null)"
}
```

**에러**: `400` 형식 오류 · `401` 아이디 또는 비밀번호 틀림(둘 중 뭐가 틀렸는지는 구분 안 줌, 의도된 동작) · `403` 정지된 계정(`"사용이 중지된 계정입니다"`)

---

### 닉네임 변경
`PUT /api/rhh/users/me/nickname` — 인증 필요

계정정보 수정 화면에서 사용합니다. 빈 문자열을 보내면 닉네임을 지웁니다(DB엔 `null`로 저장).

**요청**
```json
{ "userName": "string (최대 100자, 빈 문자열이면 삭제)" }
```

**성공 (200)**
```json
{ "userName": "string | null" }
```

**에러**: `400` 형식/길이 오류 · `404` 계정 없음

---

### 이메일 변경
`PUT /api/rhh/users/me/email` — 인증 필요

계정정보 수정 화면에서 사용합니다. 빈 문자열을 보내면 이메일을 지웁니다(DB엔 `null`로
저장) — 비어있으면 알람 이메일도 발송되지 않습니다(예정 기능).

**요청**
```json
{ "userEmail": "string (최대 320자, 빈 문자열이면 삭제)" }
```

**성공 (200)**
```json
{ "userEmail": "string | null" }
```

**에러**: `400` 형식/길이 오류 · `404` 계정 없음

---

### 비밀번호 변경
`PUT /api/rhh/users/me/password` — 인증 필요

**요청**
```json
{ "currentPassword": "string", "newPassword": "string (4자 이상)" }
```

**성공 (200)**
```json
{ "ok": true }
```

**에러**: `400` 형식/길이 오류 · `401` 현재 비밀번호 틀림 · `404` 계정 없음

---

### 회원 탈퇴
`DELETE /api/rhh/users/me` — 인증 필요

**실제로 삭제하지 않고 비활성 처리**되며, 보유 중이던 활성 프로젝트도 같이 비활성
처리됩니다. 탈퇴 후 재로그인하면 로그인 API가 `403`(정지된 계정)으로 막습니다.

**요청**
```json
{ "password": "string (탈퇴 확인용)" }
```

**성공 (200)**
```json
{ "ok": true }
```

**에러**: `400` 비밀번호 미입력 · `401` 비밀번호 틀림 · `404` 계정 없음

---

### 패스워드 찾기(재설정) ⚠️ 화면 미구현
`PUT /api/rhh/users/password-reset` — 인증 불필요

로그인 화면 하단 "패스워드 찾기" 페이지용 API입니다. 로그인 자체가 안 되는
상황(비밀번호를 잊음, 또는 탈퇴)에서 쓰는 거라 인증도, 현재 비밀번호 확인도
요구하지 않습니다 — 아이디만 맞으면 바로 바뀝니다.

**요청**
```json
{ "userId": "string", "newPassword": "string (4자 이상)" }
```

**성공 (200)**
```json
{ "ok": true }
```

**성공 시 부수 효과**: 비밀번호만 바뀌는 게 아니라 **탈퇴(`use=false`)한 계정도
자동으로 재활성화**됩니다(`use=true`로 바뀜). 탈퇴한 아이디도 이 API로 비밀번호를
다시 설정하면 바로 로그인할 수 있게 됩니다.

**에러**: `400` 아이디 미입력/비밀번호 4자 미만 · `404` 존재하지 않는 아이디

---

## 프로젝트

### 목록 조회
`GET /api/rhh/projects` — 인증 필요

로그인 화면도 로그인 직후 "프로젝트 있으면 이력 화면, 없으면 연결 화면"을 판단하려고
한 번 호출합니다.

**요청**: 없음

**성공 (200)**
```json
[
  {
    "projectId": "string",
    "projectName": "string",
    "host": "string",
    "port": 5434,
    "dbName": "string",
    "account": "string",
    "createdAt": "timestamp",
    "updatedAt": "timestamp"
  }
]
```
> `password` 필드는 응답에 절대 포함되지 않습니다.

---

### 연결 테스트
`POST /api/rhh/projects/test-connection` — 인증 필요

프로젝트 등록 폼의 [연결 테스트] 버튼에서 호출합니다. 등록 API도 같은 검증을 다시 하므로,
이 호출을 건너뛰어도 잘못된 접속 정보로는 등록되지 않습니다.

**요청**
```json
{ "host": "string", "port": "string|number (1~65535)", "dbName": "string", "account": "string", "password": "string" }
```

**응답 (성공/실패 모두 200)**
```json
{
  "ok": true,
  "schema": {
    "base":       { "tb_page": true, "tb_instance": true },
    "required":   { "tb_page_hist": true, "tb_instance_hist": true, "trg_tb_page_hist": true, "trg_tb_instance_hist": true },
    "optional":   { "tb_history_starred": false, "tb_alarm_check": false, "tb_history_comment": false, "tb_alarm_mail_log": false },
    "management": { "tb_user_rhh": false, "tb_project_list": false }
  }
}
```
```json
{ "ok": false, "error": "실패 사유" }
```
- `schema`가 `null`일 수도 있음 = "확인 자체에 실패"(예: 권한 문제) → **"없음"과 다르게 취급**해야 함(아래 화면 표시 규칙 참고)
- `management`(`tb_user_rhh`/`tb_project_list`)는 화면에 굳이 안 보여줘도 됨 — 자동 설치 대상에는 포함되지만 사용자에게 중요한 정보는 아님

**에러(요청 자체가 잘못된 경우만)**: `400` 필수 필드 누락, port 범위 오류

#### 경우의 수별 화면 표시 규칙

| # | `tb_page`/`tb_instance` | `tb_page_hist`/트리거 | 화면에 보여줄 것 | `[프로젝트 연결]` 버튼 |
|---|---|---|---|---|
| 1 | **없음** | (확인 안 해도 됨) | ⚠️ "RENOBIT이 설치되지 않은 DB입니다" | **비활성화** |
| 2 | 있음 | **없음** | ⚠️ "이력 저장 기능이 아직 설치되지 않았습니다" + `[자동 설치]` 버튼 | 활성화(경고만, 안 막음) |
| 3 | 있음 | 있음 | ✅ 정상 | 활성화 |
| — | `schema === null`(확인 실패) | — | 경고 없이 그냥 통과 | 활성화(막지 않음) |

**부가 기능**(`optional`: `tb_history_starred`/`tb_alarm_check`/`tb_history_comment`/`tb_alarm_mail_log`)은 위 표와 무관하게 항상 정보성으로만 보여주면 되고, 없어도 경고·차단 없음.

---

### 자동 설치
`POST /api/rhh/projects/install-schema` — 인증 필요

[연결 테스트] 결과 표의 #2 상태일 때 노출되는 `[자동 설치]` 버튼에서 호출합니다.
**연결 테스트와 별개의, 사용자가 한 번 더 눌러야 하는 액션**입니다 — 연결 테스트
버튼 하나로 설치까지 자동으로 넘어가면 안 됩니다(안전장치). 아직 프로젝트로
등록되지 않은 상태(연결 테스트 단계)에서도 써야 해서, `projectId`가 아니라
연결 테스트와 같은 접속 정보를 그대로 받습니다.

**요청**
```json
{ "host": "string", "port": "number", "dbName": "string", "account": "string", "password": "string", "dryRun": "boolean" }
```
- `dryRun: true` → 아무것도 설치 안 하고 **"뭘 설치할지" 계획만** 반환(설치 확인창에 SQL 미리 보여주는 용도)
- `dryRun: false`(또는 생략) → 실제로 설치 실행

**dryRun 응답 (200)**
```json
{ "ok": true, "dryRun": true, "plan": [{ "key": "tb_page_hist", "label": "테이블 tb_page_hist", "sql": "CREATE TABLE ..." }], "schema": { "...": "설치 전 상태" } }
```

**실제 설치 응답 (200)**
```json
{ "ok": true, "dryRun": false, "installed": ["테이블 tb_page_hist", "함수·트리거 trg_tb_page_hist"], "schema": { "...": "설치 후 최신 상태" } }
```

**실패 (400)** — 둘 다 `{ "ok": false, "error": "..." }` 모양
- `tb_page`/`tb_instance` 자체가 없음: `"RENOBIT이 설치되지 않은 DB입니다 (tb_page/tb_instance 없음) — 자동 설치할 수 없습니다"`
- DDL 권한 없는 계정으로 시도: `"테이블/트리거를 생성할 권한이 없는 계정입니다 (DDL 권한이 있는 계정으로 다시 시도해 주세요)"`

#### 화면 흐름
```
[연결 테스트] 클릭
  └─ schema.base 확인
       ├─ tb_page/tb_instance 없음 → 표의 #1, 버튼 비활성화, 끝
       └─ 있음 → schema.required 확인
            ├─ 다 있음 → 표의 #3, 버튼 활성화
            └─ 없는 게 있음 → 표의 #2, 버튼 활성화 + [자동 설치] 버튼 노출
                 └─ [자동 설치] 클릭
                      └─ install-schema(dryRun:true) → plan의 SQL을 확인창에 표시
                           └─ 사용자가 "실행" 확인
                                └─ install-schema(dryRun:false) → 성공 시 화면 상태를 응답의 schema로 갱신(표의 #3로 전환)
```

---

### 등록
`POST /api/rhh/projects` — 인증 필요

[프로젝트 연결] 버튼에서 호출합니다. **연결 테스트를 통과해야만 등록됩니다** — 접속
불가능한 정보로는 등록 자체가 거부됩니다. 내가 이미 같은 host+port+dbName 조합을
등록해뒀으면 중복 등록도 막습니다(다른 사용자가 같은 대상 DB를 등록하는 건 허용).

**요청**
```json
{ "projectName": "string", "host": "string", "port": "string|number", "dbName": "string", "account": "string", "password": "string" }
```

**성공 (201)**: 목록 조회와 같은 모양의 항목 하나

**에러**: `400` 필드 누락/길이 초과/port 범위 오류 · `409` 이미 등록한 프로젝트(같은 host/port/DB 이름 조합) · `400` 연결 실패 시 `"대상 DB에 연결할 수 없습니다: (사유)"`

---

### 이름 변경
`PUT /api/rhh/projects/:projectId/name` — 인증 필요

프로젝트 이름만 바꿉니다 — host/port/계정/비밀번호 등 접속 정보는 이 API로 못 바꿉니다
(접속 정보를 바꾸려면 삭제 후 재등록).

**요청**
```json
{ "projectName": "string" }
```

**성공 (200)**: 목록 조회와 같은 모양의 항목 하나 (수정 반영된 상태)

**에러**: `400` 형식/길이 오류 · `404` 해당 프로젝트 없음 또는 내 프로젝트가 아님

---

### 삭제
`DELETE /api/rhh/projects/:projectId` — 인증 필요

프로젝트별 삭제(휴지통) 버튼에서 호출합니다. **실제로 삭제하지 않고 비활성 처리**되어
목록 조회 시 더 이상 보이지 않게 됩니다.

**요청**: 없음 (`projectId`는 URL 경로에)

**성공 (200)**
```json
{ "projectId": "string" }
```

**에러**: `404` 해당 프로젝트 없음 또는 내 프로젝트가 아님

---

### 최근 접속 프로젝트 기록
`PUT /api/rhh/users/me/recent-project` — 인증 필요

프로젝트 목록의 [접속] 버튼을 누를 때, 그리고 새 프로젝트를 등록해서 바로 선택될 때도
같이 호출됩니다.

**요청**
```json
{ "projectId": "string" }
```

**성공 (200)**
```json
{ "projectRecent": "string" }
```

**에러**: `400` projectId 누락 · `404` 내 프로젝트가 아님

---

## 이력

이 섹션의 API는 전부 `?projectId=<내 프로젝트 id>` 를 같이 보내야 합니다 (공통 사항 참고).

### 전체 목록 조회
`GET /api/history?projectId=` — 인증 필요

전체 이력 보기 화면이 열릴 때(그리고 프로젝트를 바꿀 때마다) 한 번 호출합니다. 이력
상세/Diff(버전 비교) 화면은 이때 받은 목록을 그대로 재사용하고 별도로 호출하지 않습니다.

**요청**: 없음

**성공 (200)**: 이력 항목 배열. 항목 하나의 주요 필드:
```json
{
  "id": "page-39 | inst-101",
  "kind": "page | 2D | 3D",
  "targetId": "페이지/컴포넌트 id",
  "targetLabel": "[Page] 이름 형태의 표시용 라벨",
  "targetName": "이름",
  "title": "#번호 제목 (제목 없으면 #번호만)",
  "hidden": false,
  "important": false,
  "author": "작성자 (page만 있음, 2D/3D는 null)",
  "version": "버전 (page만 있음, 2D/3D는 null)",
  "savedAt": "저장 시각",
  "comment": "비고(마크다운)",
  "primaryTabs": "탭 정보 배열",
  "lifecycles": "생명주기별 코드 배열",
  "cssCode": "...",
  "htmlCode": "...",
  "additions": 0,
  "deletions": 0
}
```
실제 필드는 이보다 많습니다 — 정확한 모양은 `src/entries.js`의 `buildPageEntry`/`buildInstanceEntry` 참고.

`important` 필드는 요청한 사용자가 이 이력을 중요 표시(⭐)해뒀는지입니다 — 아래
"중요 표시 켜기/끄기" API 참고. 그 프로젝트 DB에 `tb_history_starred` 테이블이
아직 없으면 에러 없이 그냥 전부 `false`로 내려갑니다.

**에러**: `400` projectId 누락 · `404` 내 프로젝트가 아님

---

### 제목/비고/숨김 수정
`PUT /api/history/:id/metadata?projectId=` — 인증 필요

- 전체 이력 화면(카드 인라인 수정)은 `title`만 보냄
- 이력 상세 화면은 `title`/`comment`를 각각 따로 보냄
- "숨기기" 버튼은 `hidden`만 보냄 (실제 데이터는 삭제하지 않고 이 플래그만 바꿈)
- `title`은 화면에 `#번호 제목` 형태로 보이는데, 그 `#번호` 접두사가 섞여 들어와도
  백엔드가 저장 전에 떼어내므로 프론트는 신경 쓸 필요 없음

**요청** (아래 중 하나 이상)
```json
{ "title": "string", "comment": "string", "hidden": true }
```

**성공 (200)**: 위 이력 항목과 같은 모양 (수정 반영된 상태)

**에러**: `400` id 형식 오류/셋 다 안 보냄/글자수 초과 · `404` 프로젝트 또는 이력 없음

---

### 중요 표시 켜기/끄기 ⚠️ 화면 미구현
`PUT /api/history/:id/important?projectId=` — 인증 필요

`title`/`comment`/`hidden`(=metadata)과 다르게 **요청한 사용자 한 명만의 값**입니다 —
내가 중요 표시해도 같은 프로젝트를 보는 다른 사용자 화면에는 영향이 없습니다. 그래서
공용 값인 metadata API와 분리했습니다.

**DB 준비 필요**: 프로젝트가 가리키는 대상 DB에 `tb_history_starred` 테이블이 있어야
저장이 됩니다(테이블이 없으면 `GET /api/history`는 정상 응답하되 `important`가 항상
`false`로 나오고, 이 PUT은 `500`이 납니다). 테이블 정의:
```sql
CREATE TABLE tb_history_starred (
  user_id    VARCHAR(1000) NOT NULL,
  hist_type  VARCHAR(10) NOT NULL,   -- 'page' | 'inst' (아래 id 접두사와 동일)
  hist_id    INTEGER NOT NULL,
  PRIMARY KEY (user_id, hist_type, hist_id)
);
```

**요청**
```json
{ "important": true }
```

**성공 (200)**
```json
{ "id": "page-39", "important": true }
```

**에러**: `400` id 형식 오류/`important`가 boolean 아님 · `404` 내 프로젝트가 아님

---

### 댓글 목록 조회
`GET /api/history/:id/comments?projectId=` — 인증 필요

`id`에 달린 댓글/대댓글 전체를 오래된순(대화창처럼 아래로 쌓이는 순서)으로 돌려줍니다.
모두가 보는 공용 값이라 작성자 구분 없이 그대로 내려갑니다.

**DB 준비 필요**: 대상 DB에 `tb_history_comment` 테이블이 있어야 합니다(없으면 `500`).

**요청**: 없음

**성공 (200)**
```json
[
  {
    "commentId": 42,
    "id": "page-39",
    "parentCommentId": null,
    "userId": "hjjo2",
    "userName": "현진",
    "content": "댓글 내용",
    "createdAt": "timestamp",
    "updatedAt": "timestamp"
  }
]
```
- `parentCommentId`: `null`이면 원댓글, 값이 있으면 그 댓글(comment_id)의 대댓글
- `userName`은 RHH 관리 DB에서 따로 조회해 붙인 값 — 그 조회가 실패해도 댓글 자체는
  내려가며, 이때 `userName`은 `null`

**에러**: `400` id 형식 오류 · `404` 내 프로젝트가 아님

---

### 댓글 작성
`POST /api/history/:id/comments?projectId=` — 인증 필요

작성자는 요청 본문이 아니라 항상 토큰 주인(로그인한 본인)입니다. `parentCommentId`를
보내면 그 댓글의 대댓글로, 안 보내거나 `null`이면 원댓글로 저장됩니다.

**요청**
```json
{ "content": "string (최대 1000자)", "parentCommentId": "number | null (생략 가능)" }
```

**성공 (201)**: 댓글 목록 조회와 같은 모양의 댓글 객체 하나

**에러**:
- `400` id 형식 오류 · 댓글 내용 미입력/길이 초과 · `parentCommentId` 형식 오류 ·
  대댓글 대상이 다른 이력에 달린 댓글인 경우(`"다른 이력에 달린 댓글에는 답글을 달 수 없습니다"`)
- `404` 내 프로젝트가 아님 · 대댓글을 달려는 원댓글을 찾을 수 없음

---

### 댓글 수정
`PUT /api/history/comments/:commentId?projectId=` — 인증 필요

**작성자 본인만** 수정할 수 있습니다.

**요청**
```json
{ "content": "string (최대 1000자)" }
```

**성공 (200)**: 댓글 목록 조회와 같은 모양의 댓글 객체

**에러**: `400` 내용 미입력/길이 초과 · `403` 본인이 작성한 댓글이 아님 · `404` 댓글을 찾을 수 없음

---

### 댓글 삭제
`DELETE /api/history/comments/:commentId?projectId=` — 인증 필요

**작성자 본인만** 삭제할 수 있습니다. 대댓글이 달린 원댓글을 지우면 그 대댓글도
`ON DELETE CASCADE`로 같이 지워집니다.

**요청**: 없음

**성공 (200)**
```json
{ "ok": true }
```

**에러**: `403` 본인이 작성한 댓글이 아님 · `404` 댓글을 찾을 수 없음

---

## 휴지통

이 섹션의 API는 전부 `?projectId=`가 필요합니다. `PUT .../metadata`로 `hidden: true`
처리한(=소프트 삭제된) 이력을 다루는 화면용입니다. 여기서 하는 삭제는 **소프트
삭제와 다르게 실제로 DB row를 지우는 영구 삭제**라 되돌릴 수 없습니다.

⚠️ **주의**: 여러 "프로젝트"가 실수로 같은 물리 DB를 가리키고 있으면(예: 테스트용으로
같은 DB를 다른 이름으로 여러 번 등록한 경우), 아래 "휴지통 비우기"는 그 DB를 쓰는
**다른 프로젝트의 숨김 이력까지 같이 지웁니다** — `projectId`로 걸러지는 게 아니라
그 DB 전체의 `hidden=true`를 지우기 때문입니다. 실제 운영 환경(프로젝트마다 완전히
분리된 DB)에서는 문제되지 않습니다.

### 휴지통 목록 조회 ⚠️ 화면 미구현
`GET /api/history/trash?projectId=` — 인증 필요

`hidden=true`로 표시된 이력만 모아서 돌려줍니다. 응답 항목 모양은 `GET /api/history`와
동일합니다(그중 숨김 처리된 것만 걸러진 부분집합).

**요청**: 없음

**성공 (200)**: `GET /api/history`와 같은 모양의 이력 항목 배열

**에러**: `400` projectId 누락 · `404` 내 프로젝트가 아님

---

### 이력 개별 영구 삭제 ⚠️ 화면 미구현
`DELETE /api/history/:id?projectId=` — 인증 필요

`hidden=true`(휴지통에 있는 것)인 경우에만 지워집니다 — 아직 숨김 처리 안 된(=화면에
정상 노출 중인) 이력은 이 API로 못 지웁니다(먼저 `PUT .../metadata`로 `hidden: true`
처리해야 함).

**요청**: 없음

**성공 (200)**
```json
{ "id": "page-39" }
```

**에러**: `400` id 형식 오류 · `404` 휴지통에서 못 찾음(안 숨겨진 이력이거나 이미 삭제됨) 또는 내 프로젝트가 아님

---

### 휴지통 비우기 ⚠️ 화면 미구현
`DELETE /api/history/trash?projectId=` — 인증 필요

`hidden=true`인 이력을 전부 한 번에 영구 삭제합니다. 위 "주의" 참고.

**요청**: 없음

**성공 (200)**
```json
{ "deleted": 3 }
```
`deleted`는 이번 호출로 실제 삭제된 건수입니다(원래 없었으면 `0`).

**에러**: `404` 내 프로젝트가 아님

---

## 알람 ⚠️ 화면 미구현

미확인 알람 관련 API 3개입니다. 아직 이걸 호출하는 화면이 없습니다.

**DB 준비 필요**: 이 API들은 프로젝트가 가리키는 대상 DB에 `tb_alarm_check` 테이블이
있어야 동작합니다(없는 프로젝트에서 호출하면 `500`). 테이블 정의:
```sql
CREATE TABLE tb_alarm_check (
  user_id    VARCHAR(1000) NOT NULL,
  hist_type  VARCHAR(10) NOT NULL,   -- 'page' | 'inst' (아래 id 접두사와 동일)
  hist_id    INTEGER NOT NULL,
  checked_at TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, hist_type, hist_id)
);
```
> ⚠️ `user_id`는 `tb_user_rhh.user_id`(로그인 아이디)와 같은 문자열입니다 —
> `INTEGER`로 만들면 숫자가 아닌 아이디에서 전부 에러가 납니다(실제로 한 번
> 겪었던 문제입니다). 이미 `INTEGER`로 만드셨다면
> `ALTER TABLE tb_alarm_check ALTER COLUMN user_id TYPE VARCHAR(1000);`로 바꿔주세요.

### 미확인 목록 조회
`GET /api/alarms?projectId=` — 인증 필요

로그인한 사용자가 이 프로젝트에서 아직 "확인" 처리하지 않은 **이력**과 **댓글/대댓글**을
각각 따로 돌려줍니다. **본인이 쓴 댓글/대댓글은 본인에게는 뜨지 않고(작성자 제외),
다른 사용자에게는 그대로 보입니다** — 이력 쪽(본인이 편집한 것도 포함되는 방식)과는
다른 규칙이니 헷갈리지 않게 주의해주세요.

**요청**: 없음

**성공 (200)**
```json
{
  "entries": [ /* GET /api/history 와 같은 모양의 이력 항목 배열 */ ],
  "comments": [
    {
      "id": "comment-42",
      "targetId": "page-39 (이 댓글이 달린 이력의 id)",
      "parentCommentId": "number | null (대댓글이면 부모 comment_id)",
      "userId": "string (작성자)",
      "content": "string",
      "createdAt": "timestamp"
    }
  ]
}
```

**에러**: `400` projectId 누락 · `404` 내 프로젝트가 아님

---

### 개별 확인
`POST /api/alarms/:id/check?projectId=` — 인증 필요

이력 또는 댓글 하나를 "확인함"으로 표시합니다. `id`는 이력이면 `page-39`/`inst-101`,
댓글/대댓글이면 `comment-42`(comment_id) 형식입니다. 이미 확인한 것을 또 호출해도
에러 없이 그냥 무시됩니다.

**요청**: 없음

**성공 (200)**
```json
{ "ok": true }
```

**에러**: `400` id 형식 오류 · `404` 내 프로젝트가 아님

---

### 전체 확인
`POST /api/alarms/check-all?projectId=` — 인증 필요

"전체알림확인" 버튼용 — 지금 시점 기준 미확인 전체(이력 + 댓글/대댓글)를 한 번에 확인 처리합니다.

**요청**: 없음

**성공 (200)**
```json
{ "checked": 3 }
```
`checked`는 이번 호출로 새로 확인 처리된 건수입니다(이미 다 확인한 상태면 `0`).

**에러**: `404` 내 프로젝트가 아님
