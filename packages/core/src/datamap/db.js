import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';
const log = createLogger('db');
let _db = null;
export function getDb() {
    if (_db)
        return _db;
    mkdirSync(dirname(config.db_path), { recursive: true });
    _db = new Database(config.db_path);
    _db.pragma('journal_mode = WAL');
    _db.pragma('busy_timeout = 5000'); // 高并发写冲突时等待最多 5s，而非立即报错
    _db.pragma('wal_autocheckpoint = 1000'); // 每 1000 页自动合并 WAL，防止 WAL 无限膨胀
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
    }
    catch { /* 列已存在 */ }
    try {
        db.exec(`ALTER TABLE objects ADD COLUMN content_length INTEGER`);
        log.info('Migration: added content_length to objects');
    }
    catch { /* 列已存在 */ }
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
    }
    catch { /* 列已存在 */ }
    try {
        db.exec(`ALTER TABLE session_messages ADD COLUMN tool_status TEXT`);
        log.info('Migration: added tool_status to session_messages');
    }
    catch { /* 列已存在 */ }
    try {
        db.exec(`ALTER TABLE session_messages ADD COLUMN duration_ms INTEGER`);
        log.info('Migration: added duration_ms to session_messages');
    }
    catch { /* 列已存在 */ }
    // ── 数据分类迁移 ──
    // services 表加 data_scope 列
    try {
        db.exec(`ALTER TABLE services ADD COLUMN data_scope TEXT NOT NULL DEFAULT 'public'`);
        log.info('Migration: added data_scope to services');
    }
    catch { /* 列已存在 */ }
    // objects 表加 data_scope 列
    try {
        db.exec(`ALTER TABLE objects ADD COLUMN data_scope TEXT NOT NULL DEFAULT 'public'`);
        log.info('Migration: added data_scope to objects');
    }
    catch { /* 列已存在 */ }
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
    }
    catch { /* 列已存在 */ }
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
    const hasOldRoles = db.prepare("SELECT COUNT(*) as n FROM users WHERE role IN ('super_admin','developer','product','operations','designer','viewer')").get();
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
    // ── user_settings 'system' → scoped_settings 'org' 迁移 ──
    // 注意：user_settings 表由 settings/ 模块创建，可能尚未存在
    try {
        const hasSystemSettings = db.prepare("SELECT COUNT(*) as n FROM user_settings WHERE user_id = 'system'").get();
        if (hasSystemSettings.n > 0) {
            db.exec(`
        INSERT OR IGNORE INTO scoped_settings (scope, scope_id, key, value_enc)
        SELECT 'org', 'default', key, value_encrypted FROM user_settings WHERE user_id = 'system'
      `);
            log.info('Migration: user_settings system → scoped_settings org/default');
        }
    }
    catch { /* user_settings 表尚未创建，跳过此迁移 */ }
    log.info('Schema initialized');
    seedDefaultPolicies(db);
}
function seedDefaultPolicies(db) {
    const count = db.prepare('SELECT COUNT(*) as n FROM policies').get();
    if (count.n > 0)
        return;
    const insert = db.prepare(`
    INSERT INTO policies (policy_id, name, effect, roles_json, sensitivity, actions_json, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
    const seed = db.transaction(() => {
        // 全员可读 public
        insert.run('pol_public_read', '全员读取公共数据', 'allow', '["owner","admin","member","guest"]', 'public', '["read"]', 10);
        // member+ 可读 internal
        insert.run('pol_internal_read', '成员读取内部数据', 'allow', '["owner","admin","member"]', 'internal', '["read"]', 20);
        // member 可编辑 internal
        insert.run('pol_internal_member_edit', '成员编辑内部数据', 'allow', '["member"]', 'internal', '["read","write"]', 25);
        // owner 全权限所有级别
        insert.run('pol_owner_all', 'Owner 全权限', 'allow', '["owner"]', null, '["read","write","delete","admin"]', 100);
        // admin 管理 public + internal
        insert.run('pol_admin_manage', '管理员管理公共和内部', 'allow', '["admin"]', null, '["read","write","admin"]', 90);
        // restricted 仅 owner 和 admin
        insert.run('pol_restricted_access', '受限数据访问', 'allow', '["owner","admin"]', 'restricted', '["read","write"]', 50);
    });
    seed();
    log.info('Default policies seeded');
}
//# sourceMappingURL=db.js.map
