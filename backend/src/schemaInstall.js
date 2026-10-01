// [프로젝트 연결 화면] "자동 설치" 기능 — 대상 DB에 RHH가 쓰는 테이블/함수/트리거를
// 직접 생성합니다.
//
// tb_page / tb_instance(RENOBIT 자체 테이블)는 여기서 다루지 않습니다 — RHH가 만드는
// 게 아니라 이미 있어야만 트리거를 붙일 수 있는 대상이라, 호출부(projectPool.js)가
// 이 둘이 이미 있는 것을 먼저 확인한 뒤에만 이 모듈을 씁니다.
//
// ⚠️ tb_user_rhh / tb_project_list는 원래 RHH 관리용 고정 DB(.env, db.js)에만 있어야
// 하는 테이블입니다. 여기 설치 목록에 있는 건 요청에 따른 것이고, 이 대상 DB에
// 만들어져도 백엔드는 항상 db.js의 고정 연결만 사용하므로 여기서 생성된 사본은
// 실제로 읽고 쓰이지 않습니다 — 그대로 안 쓰이는 채로 남는다는 걸 알고 유지합니다.
//
// 중복 실행 안전(멱등성):
//   - 테이블: CREATE TABLE IF NOT EXISTS
//   - 함수:   CREATE OR REPLACE FUNCTION (원래 항상 안전)
//   - 트리거: DROP TRIGGER IF EXISTS 로 먼저 지우고 CREATE TRIGGER
// 그리고 호출부가 checkSchema() 결과로 "이미 없는 것"만 골라서 이 모듈에 넘기므로,
// 이미 있는 건 애초에 SQL 자체가 안 날아갑니다.

const SQL_TB_USER_RHH = `
CREATE TABLE IF NOT EXISTS tb_user_rhh (
  user_id        VARCHAR(1000) PRIMARY KEY,
  password       VARCHAR(1000) NOT NULL,
  project_recent VARCHAR(1000),
  use            BOOLEAN NOT NULL DEFAULT true,
  user_name      VARCHAR(100)
)`;

const SQL_TB_PROJECT_LIST = `
CREATE TABLE IF NOT EXISTS tb_project_list (
  project_id   VARCHAR(1000) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_name VARCHAR(1000) NOT NULL,
  host         VARCHAR(1000) NOT NULL,
  port         INTEGER NOT NULL,
  db_name      VARCHAR(1000) NOT NULL,
  account      VARCHAR(1000) NOT NULL,
  password     VARCHAR(1000) NOT NULL,
  user_id      VARCHAR(1000) NOT NULL REFERENCES tb_user_rhh(user_id),
  created_at   TIMESTAMP NOT NULL DEFAULT now(),
  updated_at   TIMESTAMP NOT NULL DEFAULT now(),
  use          BOOLEAN NOT NULL DEFAULT true
)`;
const SQL_IDX_PROJECT_LIST = `CREATE INDEX IF NOT EXISTS idx_tb_project_list_user_id ON tb_project_list(user_id)`;

const SQL_TB_PAGE_HIST = `
CREATE TABLE IF NOT EXISTS public.tb_page_hist (
  page_id varchar(36) NOT NULL,
  "name" varchar(100) NOT NULL,
  page_type varchar(20) NOT NULL,
  "version" varchar(20) NULL,
  secret bpchar(1) DEFAULT 'N'::bpchar NULL,
  update_dt timestamp NULL,
  props text NULL,
  reg_dt timestamp DEFAULT CURRENT_TIMESTAMP NULL,
  parent_id varchar(36) NULL,
  prev_id varchar(36) NULL,
  last_user varchar(20) NULL,
  locked_yn bpchar(1) DEFAULT 'N'::bpchar NOT NULL,
  "comment" varchar(1000) NOT NULL,
  hist_id bigserial NOT NULL,
  css_code text NULL,
  lc_before_load text NULL,
  lc_loaded text NULL,
  lc_before_unload text NULL,
  title varchar(1000) NULL,
  hidden bool DEFAULT false NOT NULL,
  CONSTRAINT tb_page_hist_pkey PRIMARY KEY (hist_id)
)`;

const SQL_TB_INSTANCE_HIST = `
CREATE TABLE IF NOT EXISTS public.tb_instance_hist (
  inst_id varchar(36) NOT NULL,
  layer_name varchar(20) NOT NULL,
  category varchar(20) NULL,
  page_id varchar(36) NULL,
  comp_name varchar(100) NOT NULL,
  "name" varchar(255) NULL,
  group_id varchar(36) NULL,
  props text NULL,
  asset_id varchar(36) NULL,
  reg_dt timestamp DEFAULT CURRENT_TIMESTAMP NULL,
  "comment" varchar(1000) NOT NULL,
  hist_id bigserial NOT NULL,
  html_code text NULL,
  css_code text NULL,
  lc_register text NULL,
  lc_complete text NULL,
  lc_before_destroy text NULL,
  lc_destroy text NULL,
  lc_completed text NULL,
  lc_preview text NULL,
  title varchar(1000) NULL,
  hidden bool DEFAULT false NOT NULL,
  CONSTRAINT tb_instance_hist_pkey PRIMARY KEY (hist_id)
)`;

const SQL_TB_HISTORY_STARRED = `
CREATE TABLE IF NOT EXISTS tb_history_starred (
  user_id    VARCHAR(1000) NOT NULL,
  hist_type  VARCHAR(10) NOT NULL,
  hist_id    INTEGER NOT NULL,
  PRIMARY KEY (user_id, hist_type, hist_id)
)`;

const SQL_TB_ALARM_CHECK = `
CREATE TABLE IF NOT EXISTS tb_alarm_check (
  user_id    VARCHAR(1000) NOT NULL,
  hist_type  VARCHAR(10) NOT NULL,
  hist_id    INTEGER NOT NULL,
  checked_at TIMESTAMP NOT NULL DEFAULT now(),
  entry_saved_at VARCHAR(20) NULL,
  PRIMARY KEY (user_id, hist_type, hist_id)
)`;
// CREATE TABLE IF NOT EXISTS 는 테이블이 이미 있으면 건너뛰므로, hist_id 재사용(DB
// 리셋) 버그 수정 전에 이미 tb_alarm_check를 설치해둔 프로젝트는 이 컬럼이 없을 수
// 있습니다. tb_history_comment_reply와 같은 패턴으로 별도 컬럼 체크/항목을 둡니다.
const SQL_ALTER_ALARM_CHECK_ENTRY_SAVED_AT = `
ALTER TABLE tb_alarm_check
  ADD COLUMN IF NOT EXISTS entry_saved_at VARCHAR(20)`;

const SQL_TB_ALARM_MAIL_LOG = `
CREATE TABLE IF NOT EXISTS tb_alarm_mail_log (
  log_id     BIGSERIAL PRIMARY KEY,
  hist_type  VARCHAR(10) NOT NULL,
  hist_id    INTEGER NOT NULL,
  sent_at    TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (hist_type, hist_id)
)`;

const SQL_TB_HISTORY_COMMENT = `
CREATE TABLE IF NOT EXISTS tb_history_comment (
  comment_id        BIGSERIAL PRIMARY KEY,
  hist_type         VARCHAR(10)   NOT NULL,
  hist_id           INTEGER       NOT NULL,
  parent_comment_id BIGINT NULL REFERENCES tb_history_comment(comment_id) ON DELETE CASCADE,
  user_id           VARCHAR(1000) NOT NULL,
  content           TEXT          NOT NULL,
  created_at        TIMESTAMP     NOT NULL DEFAULT now(),
  updated_at        TIMESTAMP     NOT NULL DEFAULT now()
)`;
// CREATE TABLE IF NOT EXISTS 는 테이블이 이미 있으면 통째로 건너뛰기 때문에, 대댓글
// 기능 추가 전에 이미 tb_history_comment를 설치해둔 프로젝트는 이 컬럼이 없을 수
// 있습니다. ADD COLUMN IF NOT EXISTS 로 그런 기존 설치도 같이 맞춰줍니다(새로 만든
// 경우엔 이미 있으므로 아무 일도 안 함).
const SQL_ALTER_HISTORY_COMMENT_PARENT = `
ALTER TABLE tb_history_comment
  ADD COLUMN IF NOT EXISTS parent_comment_id BIGINT REFERENCES tb_history_comment(comment_id) ON DELETE CASCADE`;
const SQL_IDX_HISTORY_COMMENT = `CREATE INDEX IF NOT EXISTS idx_tb_history_comment_hist ON tb_history_comment (hist_type, hist_id, created_at)`;
const SQL_IDX_HISTORY_COMMENT_PARENT = `CREATE INDEX IF NOT EXISTS idx_tb_history_comment_parent ON tb_history_comment (parent_comment_id)`;

const SQL_FN_TB_PAGE_HIST = `
CREATE OR REPLACE FUNCTION public.fn_tb_page_hist() RETURNS trigger LANGUAGE plpgsql
AS $function$
DECLARE
    v_props jsonb := NEW.props::jsonb;
    v_last_props text;
BEGIN
    IF NEW.page_id = 'master' THEN
        RETURN NEW;
    END IF;

    SELECT props INTO v_last_props
      FROM tb_page_hist
     WHERE page_id = NEW.page_id
     ORDER BY hist_id DESC
     LIMIT 1;

    IF v_last_props IS NOT DISTINCT FROM NEW.props THEN
        RETURN NEW;
    END IF;

    INSERT INTO tb_page_hist (
        page_id, name, page_type, version, secret,
        update_dt, props, reg_dt, parent_id, prev_id,
        last_user, locked_yn, comment,
        css_code, lc_before_load, lc_loaded, lc_before_unload
    )
    VALUES (
        NEW.page_id, NEW.name, NEW.page_type, NEW.version, NEW.secret,
        NEW.update_dt, NEW.props, NEW.reg_dt, NEW.parent_id, NEW.prev_id,
        NEW.last_user, NEW.locked_yn, '',
        v_props #>> '{publishCode,cssCode}',
        v_props #>> '{events,beforeLoad}',
        v_props #>> '{events,loaded}',
        v_props #>> '{events,beforeUnLoad}'
    );
    RETURN NEW;
END;
$function$`;

const SQL_DROP_TRG_PAGE = `DROP TRIGGER IF EXISTS trg_tb_page_hist ON tb_page`;
const SQL_CREATE_TRG_PAGE = `
CREATE TRIGGER trg_tb_page_hist
AFTER INSERT OR UPDATE ON tb_page
FOR EACH ROW
EXECUTE FUNCTION fn_tb_page_hist()`;

const SQL_FN_TB_INSTANCE_HIST = `
CREATE OR REPLACE FUNCTION public.fn_tb_instance_hist() RETURNS trigger LANGUAGE plpgsql
AS $function$
DECLARE
    v_props jsonb := NEW.props::jsonb;
    v_last_props text;
BEGIN
    SELECT props INTO v_last_props
      FROM tb_instance_hist
     WHERE inst_id = NEW.inst_id
     ORDER BY hist_id DESC
     LIMIT 1;

    IF v_last_props IS NOT DISTINCT FROM NEW.props THEN
        RETURN NEW;
    END IF;

    INSERT INTO tb_instance_hist (
        inst_id, layer_name, category, page_id, comp_name,
        name, group_id, props, asset_id, reg_dt, comment,
        html_code, css_code,
        lc_register, lc_complete, lc_before_destroy, lc_destroy, lc_completed, lc_preview
    )
    VALUES (
        NEW.inst_id, NEW.layer_name, NEW.category, NEW.page_id, NEW.comp_name,
        NEW.name, NEW.group_id, NEW.props, NEW.asset_id, NEW.reg_dt, '',
        v_props #>> '{publishCode,htmlCode}',
        v_props #>> '{publishCode,cssCode}',
        v_props #>> '{events,register}',
        v_props #>> '{events,complete}',
        v_props #>> '{events,beforeDestroy}',
        v_props #>> '{events,destroy}',
        v_props #>> '{events,completed}',
        v_props #>> '{events,preview}'
    );
    RETURN NEW;
END;
$function$`;

const SQL_DROP_TRG_INST = `DROP TRIGGER IF EXISTS trg_tb_instance_hist ON tb_instance`;
const SQL_CREATE_TRG_INST = `
CREATE TRIGGER trg_tb_instance_hist
AFTER INSERT OR UPDATE ON tb_instance
FOR EACH ROW
EXECUTE FUNCTION fn_tb_instance_hist()`;

// 순서가 중요합니다: tb_project_list가 tb_user_rhh를 FK로 참조하므로 그 뒤에 오고,
// 트리거(함수 포함)는 자기가 INSERT할 이력 테이블이 먼저 있어야 합니다. missing[key]가
// true인 항목만 계획에 들어갑니다 — key 이름은 checkSchema()가 쓰는 이름과 동일합니다.
const INSTALL_ITEMS = [
  { key: "tb_user_rhh", label: "테이블 tb_user_rhh", statements: [SQL_TB_USER_RHH] },
  { key: "tb_project_list", label: "테이블 tb_project_list", statements: [SQL_TB_PROJECT_LIST, SQL_IDX_PROJECT_LIST] },
  { key: "tb_page_hist", label: "테이블 tb_page_hist", statements: [SQL_TB_PAGE_HIST] },
  { key: "tb_instance_hist", label: "테이블 tb_instance_hist", statements: [SQL_TB_INSTANCE_HIST] },
  { key: "tb_history_starred", label: "테이블 tb_history_starred", statements: [SQL_TB_HISTORY_STARRED] },
  { key: "tb_alarm_check", label: "테이블 tb_alarm_check", statements: [SQL_TB_ALARM_CHECK] },
  { key: "tb_alarm_mail_log", label: "테이블 tb_alarm_mail_log", statements: [SQL_TB_ALARM_MAIL_LOG] },
  {
    key: "tb_history_comment",
    label: "테이블 tb_history_comment",
    statements: [SQL_TB_HISTORY_COMMENT, SQL_IDX_HISTORY_COMMENT],
  },
  // 테이블 자체는 있는데 대댓글 컬럼만 없는(=예전에 설치된) 경우를 위해 별도 항목으로
  // 뺐습니다. key가 projectPool.js의 COLUMN_CHECKS와 맞물려서, "테이블은 있지만 이
  // 컬럼만 없는" 상태에서도 이 항목만 골라 실행됩니다(위 tb_history_comment 항목은
  // 테이블이 이미 있으면 통째로 건너뛰기 때문에 이 컬럼까지는 못 챙깁니다).
  {
    key: "tb_history_comment_reply",
    label: "컬럼 tb_history_comment.parent_comment_id (대댓글)",
    statements: [SQL_ALTER_HISTORY_COMMENT_PARENT, SQL_IDX_HISTORY_COMMENT_PARENT],
  },
  {
    key: "tb_alarm_check_entry_saved_at",
    label: "컬럼 tb_alarm_check.entry_saved_at (hist_id 재사용 대응)",
    statements: [SQL_ALTER_ALARM_CHECK_ENTRY_SAVED_AT],
  },
  {
    key: "trg_tb_page_hist",
    label: "함수·트리거 trg_tb_page_hist",
    statements: [SQL_FN_TB_PAGE_HIST, SQL_DROP_TRG_PAGE, SQL_CREATE_TRG_PAGE],
  },
  {
    key: "trg_tb_instance_hist",
    label: "함수·트리거 trg_tb_instance_hist",
    statements: [SQL_FN_TB_INSTANCE_HIST, SQL_DROP_TRG_INST, SQL_CREATE_TRG_INST],
  },
];

// missing: checkSchema()의 management/required 결과를 합친 것,
// 예: { tb_user_rhh: true, tb_page_hist: false, trg_tb_page_hist: true, ... }
// (true = 없어서 설치 대상). 반환값은 [{ key, label, sql }, ...] — 미리보기 화면은
// label만 뽑아서 보여주거나 sql을 그대로 보여줄 수 있습니다.
export function buildInstallPlan(missing) {
  const steps = [];
  for (const item of INSTALL_ITEMS) {
    if (!missing[item.key]) continue;
    for (const sql of item.statements) {
      steps.push({ key: item.key, label: item.label, sql: sql.trim() });
    }
  }
  return steps;
}

// plan을 하나의 트랜잭션으로 실행합니다 — 중간에 하나라도 실패하면 전부 롤백되어
// 어중간한 상태(테이블만 생기고 트리거는 실패한 상태 등)가 안 남습니다.
export async function runInstallPlan(client, plan) {
  if (plan.length === 0) return [];

  await client.query("BEGIN");
  try {
    for (const step of plan) {
      await client.query(step.sql);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
  return [...new Set(plan.map((step) => step.label))];
}
