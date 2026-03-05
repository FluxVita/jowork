// ─── 数据分级 ───
export type Sensitivity = 'public' | 'internal' | 'restricted' | 'secret';

// ─── 数据分类范围 ───
export type DataScope = 'public' | 'dev' | 'group' | 'personal';

// ─── 权限等级 ───
export type AccessLevel = 'admin' | 'edit' | 'read' | 'none';

// ─── 角色 ───
export type Role = 'owner' | 'admin' | 'member' | 'guest';

// ─── 数据源类型 ───
export type DataSource =
  | 'feishu' | 'gitlab' | 'figma' | 'linear' | 'posthog' | 'email' | 'aliyun_oss'
  | 'github' | 'notion' | 'slack' | 'google_drive'
  | 'jira' | 'confluence' | 'discord' | 'google_calendar' | 'google_docs';

// ─── 数据对象类型 ───
export type SourceType =
  | 'document' | 'wiki' | 'message' | 'calendar'
  | 'repository' | 'merge_request' | 'issue' | 'pipeline' | 'pull_request'
  | 'design_file' | 'component'
  | 'project' | 'cycle'
  | 'dashboard' | 'insight'
  | 'feedback' | 'complaint'
  | 'page'
  | 'email' | 'channel';

// ─── 统一数据对象 ───
export interface DataObject {
  object_id: string;
  source: DataSource;
  source_type: SourceType;
  uri: string;
  external_url?: string;
  title: string;
  summary?: string;
  sensitivity: Sensitivity;
  acl: ACL;
  tags: string[];
  etag?: string;
  owner?: string;
  content_type?: string;
  size_bytes?: number;
  created_at: string;
  updated_at: string;
  last_indexed_at: string;
  ttl_seconds: number;
  connector_id: string;
  data_scope?: DataScope;
  content_path?: string;
  content_length?: number;
  metadata?: Record<string, unknown>;
}

// ─── 访问控制列表 ───
export interface ACL {
  read: string[];   // e.g. ["role:all_staff", "user:aiden"]
  write?: string[];
  admin?: string[];
}

// ─── 用户 ───
export interface User {
  user_id: string;
  feishu_open_id: string;
  name: string;
  email?: string;
  role: Role;
  department?: string;
  avatar_url?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── 审计日志 ───
export interface AuditEntry {
  audit_id: string;
  timestamp: string;
  actor_id: string;
  actor_role: Role;
  channel: string;
  action: 'read' | 'write' | 'delete' | 'search' | 'download' | 'admin' | 'auto_discover' | 'auto_discover_all' | 'agent_chat' | 'chat_sync' | 'org_sync' | 'oss_query';
  object_id?: string;
  object_title?: string;
  sensitivity?: Sensitivity;
  result: 'allowed' | 'denied';
  matched_rule?: string;
  response_sources?: string[];
}

// ─── 配额记录 ───
export interface QuotaUsage {
  source: DataSource | 'model';
  category: string;
  count: number;
  date: string; // YYYY-MM-DD
}

// ─── 统一消息 ───
export interface UnifiedMessage {
  channel: 'feishu' | 'telegram' | 'web' | 'cli';
  sender: {
    user_id: string;
    channel_id: string;
    name: string;
    role: Role;
  };
  content: {
    type: 'text' | 'file' | 'image' | 'command';
    text?: string;
    attachments?: { name: string; url: string; type: string }[];
  };
  context: {
    session_id: string;
    reply_to?: string;
    group_id?: string;
    is_mention?: boolean;
  };
  timestamp: number;
}

// ─── Connector 统一接口 ───
export interface Connector {
  readonly id: string;
  readonly source: DataSource;

  /** 发现数据对象，返回元数据列表 */
  discover(): Promise<DataObject[]>;

  /** 按需拉取对象原文 */
  fetch(uri: string, userContext: { user_id: string; role: Role }): Promise<{
    content: string;
    content_type: string;
    cached: boolean;
  }>;

  /** 健康检查 */
  health(): Promise<{ ok: boolean; latency_ms: number; error?: string }>;
}

// ─── 服务类型 ───
export type ServiceType = 'model' | 'connector' | 'tool' | 'page' | 'mcp' | 'internal';
export type ServiceStatus = 'active' | 'inactive' | 'deprecated';
export type GrantType = 'role' | 'user' | 'group';

export interface Service {
  service_id: string;
  name: string;
  type: ServiceType;
  category?: string;
  description?: string;
  endpoint?: string;
  config: Record<string, unknown>;
  status: ServiceStatus;
  icon?: string;
  default_roles: Role[];
  requires_config: boolean;
  sort_order: number;
  data_scope?: DataScope;
  created_at: string;
  updated_at: string;
}

export interface ServiceGrant {
  grant_id: string;
  service_id: string;
  grant_type: GrantType;
  grant_target: string;
  granted_by: string;
  expires_at?: string;
  created_at: string;
}

export interface UserGroup {
  id: number;
  user_id: string;
  group_id: string;
  group_name?: string;
  synced_at: string;
}

// ─── Gateway 配置 ───
export interface GatewayConfig {
  port: number;
  host: string;
  jwt_secret: string;
  db_path: string;
  cache_dir: string;
  gateway_public_url?: string;
  /** localStorage 中 token 的 key 名（通过 TOKEN_STORAGE_KEY 环境变量配置，默认 jowork_token） */
  token_storage_key: string;
  feishu: {
    app_id: string;
    app_secret: string;
    bot_open_id?: string;
    verification_token?: string;
    encrypt_key?: string;
  };
  gitlab: {
    url: string;
    token: string;
    client_id: string;
    client_secret: string;
    webhook_secret?: string;
  };
  linear: {
    api_key: string;
    client_id: string;
    client_secret: string;
  };
  figma: {
    client_id: string;
    client_secret: string;
  };
  github: {
    client_id: string;
    client_secret: string;
  };
  notion: {
    client_id: string;
    client_secret: string;
  };
  google: {
    client_id: string;
    client_secret: string;
  };
  microsoft: {
    client_id: string;
    client_secret: string;
    tenant_id: string;
  };
  slack: {
    client_id: string;
    client_secret: string;
  };
  atlassian: {
    client_id: string;
    client_secret: string;
    cloud_id: string;
  };
  discord: {
    client_id: string;
    client_secret: string;
  };
  posthog: {
    api_key: string;
  };
  stripe?: {
    secret_key: string;
    webhook_secret: string;
    /** 客户端 publishable key（可在前端使用） */
    publishable_key: string;
  };
  tailscale: {
    enabled: boolean;
  };
  email: {
    accounts: {
      id: string;
      host: string;
      port: number;
      user: string;
      pass: string;
      tls: boolean;
      acl_roles: string[];  // 可见角色列表，如 ['role:admin', 'role:product']
    }[];
    sla: {
      urgent_minutes: number;
      complaint_minutes: number;
      feedback_minutes: number;
    };
  };
}
