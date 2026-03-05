import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  mkdirSync(dirname(config.db_path), { recursive: true });
  _db = new Database(config.db_path);
  _db.pragma('journal_mode = WAL');
  _db.pragma('busy_timeout = 5000');  // 高并发写冲突时等待最多 5s，而非立即报错
  _db.pragma('wal_autocheckpoint = 1000');  // 每 1000 页自动合并 WAL，防止 WAL 无限膨胀
  _db.pragma('foreign_keys = ON');

  log.info('Database opened', config.db_path);
  return _db;
}

export function initSchema() {
  const db = getDb();

  db.exec(`
    -- 用户表
    CREATE TABLE IF NOT EXISTS users (
      user_id       TEXT PRIMARY KEY,
      feishu_open_id TEXT UNIQUE,
      name          TEXT NOT NULL,
      email         TEXT,
      role          TEXT NOT NULL DEFAULT 'member',
      department    TEXT,
      avatar_url    TEXT,
      is_active     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 数据对象索引
    CREATE TABLE IF NOT EXISTS objects (
      object_id      TEXT PRIMARY KEY,
      source         TEXT NOT NULL,
      source_type    TEXT NOT NULL,
      uri            TEXT NOT NULL UNIQUE,
      external_url   TEXT,
      title          TEXT NOT NULL,
      summary        TEXT,
      sensitivity    TEXT NOT NULL DEFAULT 'public',
      acl_json       TEXT NOT NULL DEFAULT '{"read":["role:all_staff"]}',
      tags_json      TEXT NOT NULL DEFAULT '[]',
      etag           TEXT,
      owner          TEXT,
      content_type   TEXT,
      size_bytes     INTEGER,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
      last_indexed_at TEXT NOT NULL DEFAULT (datetime('now')),
      ttl_seconds    INTEGER NOT NULL DEFAULT 900,
      connector_id   TEXT NOT NULL,
      metadata_json  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_objects_source ON objects(source);
    CREATE INDEX IF NOT EXISTS idx_objects_sensitivity ON objects(sensitivity);
    CREATE INDEX IF NOT EXISTS idx_objects_source_type ON objects(source_type);

    -- 审计日志
    CREATE TABLE IF NOT EXISTS audit_logs (
      audit_id       TEXT PRIMARY KEY,
      timestamp      TEXT NOT NULL DEFAULT (datetime('now')),
      actor_id       TEXT NOT NULL,
      actor_role     TEXT NOT NULL,
      channel        TEXT,
      action         TEXT NOT NULL,
      object_id      TEXT,
      object_title   TEXT,
      sensitivity    TEXT,
      result         TEXT NOT NULL,
      matched_rule   TEXT,
      sources_json   TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);

    -- 配额使用记录
    CREATE TABLE IF NOT EXISTS quota_usage (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      source    TEXT NOT NULL,
      category  TEXT NOT NULL,
      count     INTEGER NOT NULL DEFAULT 1,
      date      TEXT NOT NULL DEFAULT (date('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_quota_source_date ON quota_usage(source, date);

    -- 权限策略（可扩展 ABAC）
    CREATE TABLE IF NOT EXISTS policies (
      policy_id   TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      effect      TEXT NOT NULL DEFAULT 'allow',
      roles_json  TEXT NOT NULL,
      sensitivity TEXT,
      actions_json TEXT NOT NULL DEFAULT '["read"]',
      conditions_json TEXT,
      priority    INTEGER NOT NULL DEFAULT 0,
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Cron 任务
    CREATE TABLE IF NOT EXISTS cron_tasks (
      task_id     TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      cron_expr   TEXT NOT NULL,
      action_type TEXT NOT NULL,
      action_config_json TEXT NOT NULL DEFAULT '{}',
      created_by  TEXT NOT NULL,
      approved    INTEGER NOT NULL DEFAULT 0,
      enabled     INTEGER NOT NULL DEFAULT 0,
      last_run_at TEXT,
      next_run_at TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Agent 会话
    CREATE TABLE IF NOT EXISTS sessions (
      session_id    TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      title         TEXT DEFAULT '新对话',
      message_count INTEGER DEFAULT 0,
      total_tokens  INTEGER DEFAULT 0,
      total_cost    REAL DEFAULT 0,
      summary       TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      archived_at   TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);

    -- Agent 会话消息
    CREATE TABLE IF NOT EXISTS session_messages (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    TEXT NOT NULL REFERENCES sessions(session_id),
      role          TEXT NOT NULL,
      content       TEXT NOT NULL,
      tool_name     TEXT,
      tool_call_id  TEXT,
      tokens        INTEGER DEFAULT 0,
      model         TEXT,
      provider      TEXT,
      cost_usd      REAL DEFAULT 0,
      metadata_json TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_session_messages_session ON session_messages(session_id);

    -- 消息反馈
    CREATE TABLE IF NOT EXISTS message_feedback (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      rating     INTEGER NOT NULL,
      comment    TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(message_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_message_feedback_session ON message_feedback(session_id);

    -- 服务注册表
    CREATE TABLE IF NOT EXISTS services (
      service_id        TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      type              TEXT NOT NULL,
      category          TEXT,
      description       TEXT,
      endpoint          TEXT,
      config_json       TEXT DEFAULT '{}',
      status            TEXT NOT NULL DEFAULT 'active',
      icon              TEXT,
      default_roles_json TEXT DEFAULT '[]',
      requires_config   INTEGER DEFAULT 0,
      sort_order        INTEGER DEFAULT 0,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 服务授权表
    CREATE TABLE IF NOT EXISTS service_grants (
      grant_id      TEXT PRIMARY KEY,
      service_id    TEXT NOT NULL REFERENCES services(service_id),
      grant_type    TEXT NOT NULL,
      grant_target  TEXT NOT NULL,
      granted_by    TEXT NOT NULL,
      expires_at    TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(service_id, grant_type, grant_target)
    );

    -- 用户-群组映射
    CREATE TABLE IF NOT EXISTS user_groups (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT NOT NULL,
      group_id   TEXT NOT NULL,
      group_name TEXT,
      synced_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, group_id)
    );

    -- 登录挑战码（防暴力破解）
    CREATE TABLE IF NOT EXISTS auth_challenges (
      challenge_id    TEXT PRIMARY KEY,
      purpose         TEXT NOT NULL DEFAULT 'dev_login',
      feishu_open_id  TEXT NOT NULL,
      payload_json    TEXT NOT NULL DEFAULT '{}',
      code_hash       TEXT NOT NULL,
      salt            TEXT NOT NULL,
      attempts        INTEGER NOT NULL DEFAULT 0,
      max_attempts    INTEGER NOT NULL DEFAULT 6,
      expires_at      TEXT NOT NULL,
      consumed_at     TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_challenges_expires ON auth_challenges(expires_at);

    -- 用户记忆库
    CREATE TABLE IF NOT EXISTS user_memories (
      memory_id    TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      title        TEXT NOT NULL,
      content      TEXT NOT NULL,
      tags_json    TEXT NOT NULL DEFAULT '[]',
      scope        TEXT NOT NULL DEFAULT 'personal',
      pinned       INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_memories_user ON user_memories(user_id);

    -- Onboarding 进度
    CREATE TABLE IF NOT EXISTS onboarding_progress (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      TEXT NOT NULL,
      step_key     TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'done',
      completed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, step_key)
    );

    -- 用户偏好
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id    TEXT PRIMARY KEY,
      prefs_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── 全文内容字段迁移 ──
  try {
    db.exec(`ALTER TABLE objects ADD COLUMN content_path TEXT`);
    log.info('Migration: added content_path to objects');
  } catch { /* 列已存在 */ }

  try {
    db.exec(`ALTER TABLE objects ADD COLUMN content_length INTEGER`);
    log.info('Migration: added content_length to objects');
  } catch { /* 列已存在 */ }

  // ── FTS5 全文搜索 ──
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS objects_fts USING fts5(
      title,
      summary,
      content,
      content='',
      tokenize='unicode61'
    )
  `);

  // ── 群消息表 ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id      TEXT UNIQUE NOT NULL,
      chat_id         TEXT NOT NULL,
      chat_type       TEXT NOT NULL DEFAULT 'group',
      sender_id       TEXT,
      sender_name     TEXT,
      msg_type        TEXT NOT NULL DEFAULT 'text',
      content_text    TEXT,
      content_json    TEXT,
      parent_id       TEXT,
      doc_links_json  TEXT,
      created_at      TEXT NOT NULL,
      synced_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_chat_msg_chat ON chat_messages(chat_id);
    CREATE INDEX IF NOT EXISTS idx_chat_msg_created ON chat_messages(created_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_attachments (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id      TEXT NOT NULL,
      file_key        TEXT NOT NULL,
      file_name       TEXT,
      file_size       INTEGER,
      content_type    TEXT,
      downloaded      INTEGER NOT NULL DEFAULT 0,
      local_path      TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ── 群消息 FTS ──
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chat_fts USING fts5(
      sender_name,
      content_text,
      content='',
      tokenize='unicode61'
    )
  `);

  // ── Agent 双引擎迁移 ──
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN engine TEXT NOT NULL DEFAULT 'builtin'`);
    log.info('Migration: added engine to sessions');
  } catch { /* 列已存在 */ }

  try {
    db.exec(`ALTER TABLE session_messages ADD COLUMN tool_status TEXT`);
    log.info('Migration: added tool_status to session_messages');
  } catch { /* 列已存在 */ }

  try {
    db.exec(`ALTER TABLE session_messages ADD COLUMN duration_ms INTEGER`);
    log.info('Migration: added duration_ms to session_messages');
  } catch { /* 列已存在 */ }

  // ── 数据分类迁移 ──
  // services 表加 data_scope 列
  try {
    db.exec(`ALTER TABLE services ADD COLUMN data_scope TEXT NOT NULL DEFAULT 'public'`);
    log.info('Migration: added data_scope to services');
  } catch { /* 列已存在 */ }

  // objects 表加 data_scope 列
  try {
    db.exec(`ALTER TABLE objects ADD COLUMN data_scope TEXT NOT NULL DEFAULT 'public'`);
    log.info('Migration: added data_scope to objects');
  } catch { /* 列已存在 */ }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_objects_data_scope ON objects(data_scope)`);

  // 群组与数据源实例绑定表（v2: 实例级绑定）
  db.exec(`DROP TABLE IF EXISTS group_source_bindings`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS group_source_bindings (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id              TEXT NOT NULL,
      group_name            TEXT,
      source_type           TEXT NOT NULL,
      source_instance_id    TEXT NOT NULL,
      source_instance_name  TEXT,
      created_by            TEXT NOT NULL,
      created_at            TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(group_id, source_type, source_instance_id)
    )
  `);

  // 回填已有服务的 data_scope
  db.exec(`
    UPDATE services SET data_scope = 'dev' WHERE service_id = 'svc_gitlab' AND data_scope = 'public';
    UPDATE services SET data_scope = 'group' WHERE service_id IN ('svc_feishu', 'svc_email') AND data_scope = 'public';
    UPDATE services SET data_scope = 'personal' WHERE service_id = 'svc_figma' AND data_scope = 'public';
  `);

  // 回填已有 objects 的 data_scope
  db.exec(`
    UPDATE objects SET data_scope = 'dev' WHERE connector_id = 'gitlab_v1' AND data_scope = 'public';
    UPDATE objects SET data_scope = 'group' WHERE connector_id IN ('feishu_v1', 'email_v1') AND data_scope = 'public';
    UPDATE objects SET data_scope = 'personal' WHERE connector_id = 'figma_v1' AND data_scope = 'public';
  `);

  // ── sensitivity 收敛：未标记或异常值统一回填为 public ──
  db.exec(`
    UPDATE objects
    SET sensitivity = 'public'
    WHERE sensitivity IS NULL
       OR trim(sensitivity) = ''
       OR sensitivity NOT IN ('public','internal','restricted','secret');
  `);

  // ── 记忆向量嵌入迁移 ──
  try {
    db.exec(`ALTER TABLE user_memories ADD COLUMN embedding BLOB`);
    log.info('Migration: added embedding to user_memories');
  } catch { /* 列已存在 */ }

  // ── 群组表 ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      group_id       TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      feishu_dept_id TEXT,
      parent_id      TEXT,
      created_by     TEXT,
      created_at     TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── 三层配置表（org / group / user） ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS scoped_settings (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      scope      TEXT NOT NULL,
      scope_id   TEXT NOT NULL,
      key        TEXT NOT NULL,
      value_enc  TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(scope, scope_id, key)
    )
  `);

  // ── 角色系统迁移 v2：owner/admin/member/guest ──
  const hasOldRoles = db.prepare(
    "SELECT COUNT(*) as n FROM users WHERE role IN ('super_admin','developer','product','operations','designer','viewer')"
  ).get() as { n: number };
  if (hasOldRoles.n > 0) {
    db.exec(`
      UPDATE users SET role = 'owner'  WHERE role = 'super_admin';
      UPDATE users SET role = 'member' WHERE role IN ('developer','product','operations','designer');
      UPDATE users SET role = 'guest'  WHERE role = 'viewer';
    `);
    // 迁移 services 表 default_roles_json
    db.exec(`
      UPDATE services SET default_roles_json =
        replace(replace(replace(replace(replace(replace(
          default_roles_json,
          '"super_admin"', '"owner"'),
          '"developer"', '"member"'),
          '"product"', '"member"'),
          '"operations"', '"member"'),
          '"designer"', '"member"'),
          '"viewer"', '"guest"'
        );
    `);
    // 清空默认策略，让 seedDefaultPolicies 重新填充新角色名
    db.exec(`DELETE FROM policies WHERE policy_id LIKE 'pol_%'`);
    log.info('Migration v2: roles renamed to owner/admin/member/guest');
  }

  // 旧 ACL 角色引用迁移：objects.acl_json 中旧角色映射到 v2 角色
  db.exec(`
    UPDATE objects SET acl_json =
      replace(replace(replace(replace(replace(replace(
        acl_json,
        '"role:super_admin"', '"role:owner"'),
        '"role:developer"', '"role:member"'),
        '"role:product"', '"role:member"'),
        '"role:operations"', '"role:member"'),
        '"role:designer"', '"role:member"'),
        '"role:viewer"', '"role:guest"'
      )
    WHERE acl_json LIKE '%role:super_admin%'
       OR acl_json LIKE '%role:developer%'
       OR acl_json LIKE '%role:product%'
       OR acl_json LIKE '%role:operations%'
       OR acl_json LIKE '%role:designer%'
       OR acl_json LIKE '%role:viewer%';
  `);

  // ── user_settings 'system' → scoped_settings 'org' 迁移 ──
  // 注意：user_settings 表由 settings/ 模块创建，可能尚未存在
  try {
    const hasSystemSettings = db.prepare(
      "SELECT COUNT(*) as n FROM user_settings WHERE user_id = 'system'"
    ).get() as { n: number };
    if (hasSystemSettings.n > 0) {
      db.exec(`
        INSERT OR IGNORE INTO scoped_settings (scope, scope_id, key, value_enc)
        SELECT 'org', 'default', key, value_encrypted FROM user_settings WHERE user_id = 'system'
      `);
      log.info('Migration: user_settings system → scoped_settings org/default');
    }
  } catch { /* user_settings 表尚未创建，跳过此迁移 */ }

  // ── 三层上下文文档（Phase 6） ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS context_docs (
      id          TEXT PRIMARY KEY,
      layer       TEXT NOT NULL CHECK(layer IN ('company','team','personal')),
      scope_id    TEXT NOT NULL,
      title       TEXT NOT NULL,
      content     TEXT NOT NULL,
      doc_type    TEXT NOT NULL CHECK(doc_type IN ('manual','rule','workstyle','learned')),
      is_forced   INTEGER NOT NULL DEFAULT 0,
      created_by  TEXT NOT NULL,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ctx_docs_layer_scope ON context_docs(layer, scope_id)`);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS context_docs_fts USING fts5(
      title, content,
      content='context_docs',
      content_rowid='rowid',
      tokenize='unicode61'
    )
  `);

  // ── connector_oauth：OAuth 令牌存储（system 级或 per-user） ──────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS connector_oauth (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      connector_id TEXT NOT NULL,
      user_id      TEXT NOT NULL DEFAULT 'system',
      access_token_enc  TEXT NOT NULL,
      refresh_token_enc TEXT,
      expires_at   INTEGER,
      scope        TEXT,
      extra_enc    TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(connector_id, user_id)
    )
  `);

  // ── model_costs behavior/tool_name 字段迁移 ──
  try {
    db.exec(`ALTER TABLE model_costs ADD COLUMN behavior TEXT DEFAULT 'untagged'`);
  } catch { /* 列已存在 */ }
  try {
    db.exec(`ALTER TABLE model_costs ADD COLUMN tool_name TEXT`);
  } catch { /* 列已存在 */ }

  // ── 积分追踪表 ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_credits (
      user_id        TEXT NOT NULL,
      billing_month  TEXT NOT NULL,
      credits_total  INTEGER NOT NULL DEFAULT 0,
      credits_used   INTEGER NOT NULL DEFAULT 0,
      extra_credits  INTEGER NOT NULL DEFAULT 0,
      updated_at     TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, billing_month)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       TEXT NOT NULL,
      billing_month TEXT NOT NULL,
      credits       INTEGER NOT NULL,
      source        TEXT NOT NULL,
      model_cost_id INTEGER,
      created_at    TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Stripe 订阅表 ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_subscriptions (
      user_id              TEXT PRIMARY KEY,
      stripe_customer_id   TEXT UNIQUE,
      stripe_subscription_id TEXT,
      plan                 TEXT NOT NULL DEFAULT 'free',
      seat_level           TEXT NOT NULL DEFAULT 'basic',
      status               TEXT NOT NULL DEFAULT 'active',
      current_period_start TEXT,
      current_period_end   TEXT,
      cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
      created_at           TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS billing_prices (
      id              TEXT PRIMARY KEY,
      plan            TEXT NOT NULL,
      seat_level      TEXT,
      billing_cycle   TEXT NOT NULL DEFAULT 'monthly',
      stripe_price_id TEXT,
      amount_cents    INTEGER NOT NULL DEFAULT 0,
      currency        TEXT NOT NULL DEFAULT 'usd',
      active          INTEGER NOT NULL DEFAULT 1,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // 初始化默认价格（仅当表为空时填充，金额 TBD）
  const priceCount = (db.prepare('SELECT COUNT(*) as n FROM billing_prices').get() as { n: number }).n;
  if (priceCount === 0) {
    const insertPrice = db.prepare(`
      INSERT OR IGNORE INTO billing_prices (id, plan, seat_level, billing_cycle, amount_cents)
      VALUES (?, ?, ?, ?, ?)
    `);
    // 个人版月付价格（TBD，定价引擎跑完后填入）
    insertPrice.run('price_free',              'free',           null,    'monthly', 0);
    insertPrice.run('price_basic_m',           'personal_basic', null,    'monthly', 900);   // $9/月
    insertPrice.run('price_pro_m',             'personal_pro',   null,    'monthly', 1900);  // $19/月
    insertPrice.run('price_max_m',             'personal_max',   null,    'monthly', 4900);  // $49/月
    // 年付 = 月付 × 12 × 70%（四舍五入）
    insertPrice.run('price_basic_y',           'personal_basic', null,    'annual',  7560);  // $75.6/年
    insertPrice.run('price_pro_y',             'personal_pro',   null,    'annual',  15960); // $159.6/年
    insertPrice.run('price_max_y',             'personal_max',   null,    'annual',  41160); // $411.6/年
    // Team 版席位月付
    insertPrice.run('price_team_starter_basic_m', 'team_starter', 'basic', 'monthly', 800);
    insertPrice.run('price_team_starter_pro_m',   'team_starter', 'pro',   'monthly', 1500);
    insertPrice.run('price_team_starter_max_m',   'team_starter', 'max',   'monthly', 3000);
    insertPrice.run('price_team_pro_basic_m',     'team_pro',     'basic', 'monthly', 1200);
    insertPrice.run('price_team_pro_pro_m',       'team_pro',     'pro',   'monthly', 2500);
    insertPrice.run('price_team_pro_max_m',       'team_pro',     'max',   'monthly', 5000);
    insertPrice.run('price_team_biz_basic_m',     'team_business','basic', 'monthly', 2000);
    insertPrice.run('price_team_biz_pro_m',       'team_business','pro',   'monthly', 4000);
    insertPrice.run('price_team_biz_max_m',       'team_business','max',   'monthly', 8000);
    log.info('Billing prices seeded');
  }

  // ── 持久化应用日志（warn/error 自动落库，重启不丢失）──
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_logs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      ts           TEXT NOT NULL DEFAULT (datetime('now')),
      level        TEXT NOT NULL,
      component    TEXT NOT NULL,
      message      TEXT NOT NULL,
      user_id      TEXT,
      session_id   TEXT,
      request_path TEXT,
      duration_ms  INTEGER,
      context_json TEXT
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_app_logs_ts        ON app_logs(ts)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_app_logs_level     ON app_logs(level)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_app_logs_user      ON app_logs(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_app_logs_component ON app_logs(component)`);

  log.info('Schema initialized');
  seedDefaultPolicies(db);
}

function seedDefaultPolicies(db: Database.Database) {
  const count = db.prepare('SELECT COUNT(*) as n FROM policies').get() as { n: number };
  if (count.n > 0) return;

  const insert = db.prepare(`
    INSERT INTO policies (policy_id, name, effect, roles_json, sensitivity, actions_json, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const seed = db.transaction(() => {
    // 全员可读 public
    insert.run('pol_public_read', '全员读取公共数据', 'allow',
      '["owner","admin","member","guest"]',
      'public', '["read"]', 10);

    // member+ 可读 internal
    insert.run('pol_internal_read', '成员读取内部数据', 'allow',
      '["owner","admin","member"]',
      'internal', '["read"]', 20);

    // member 可编辑 internal
    insert.run('pol_internal_member_edit', '成员编辑内部数据', 'allow',
      '["member"]', 'internal', '["read","write"]', 25);

    // owner 全权限所有级别
    insert.run('pol_owner_all', 'Owner 全权限', 'allow',
      '["owner"]', null, '["read","write","delete","admin"]', 100);

    // admin 管理 public + internal
    insert.run('pol_admin_manage', '管理员管理公共和内部', 'allow',
      '["admin"]', null, '["read","write","admin"]', 90);

    // restricted 仅 owner 和 admin
    insert.run('pol_restricted_access', '受限数据访问', 'allow',
      '["owner","admin"]', 'restricted', '["read","write"]', 50);
  });

  seed();
  log.info('Default policies seeded');
}
