/**
 * Jowork Connect Protocol (JCP)
 *
 * 通用连接器协议接口，扩展了基础 Connector 接口，支持：
 * - Manifest 元数据（名称、版本、认证方式、能力声明）
 * - 增量同步（cursor-based pagination）
 * - 写入操作（可选）
 * - 热加载（initialize/shutdown 生命周期）
 */

import type { DataObject, Role } from '../types.js';

// ─── Manifest ────────────────────────────────────────────────────────────────

export type AuthType = 'oauth2' | 'api_token' | 'api_key' | 'mcp' | 'none';
export type CapabilityName = 'discover' | 'fetch' | 'write' | 'subscribe';

export interface ConnectorManifest {
  /** 唯一标识，如 "github" */
  id: string;
  /** 显示名称，如 "GitHub" */
  name: string;
  version: string;
  description: string;
  /** SVG 图标内容或图标名 */
  icon?: string;

  /** 认证方式 */
  auth: {
    type: AuthType;
    /** OAuth2 授权 URL（auth.type === 'oauth2' 时必填） */
    authorize_url?: string;
    /** OAuth2 token 换取 URL */
    token_url?: string;
    /** OAuth2 scope 列表 */
    scopes?: string[];
    /** Token 输入框提示文字（api_token / api_key 时使用） */
    token_label?: string;
    /** 配置说明文档 URL */
    docs_url?: string;
  };

  /** 支持的能力列表 */
  capabilities: CapabilityName[];

  /** 返回的数据类型（用于 UI 展示） */
  data_types?: string[];

  /** 用户可配置的额外参数（JSON Schema 格式） */
  config_schema?: Record<string, unknown>;

  /** 入口文件（相对路径，供动态加载使用） */
  entry?: string;
}

// ─── 配置与凭证 ───────────────────────────────────────────────────────────────

export interface ConnectorConfig {
  /** 用户自定义参数（来自 config_schema） */
  [key: string]: unknown;
}

/** 加密后的凭证（在数据库中以 AES-256-GCM 存储） */
export interface EncryptedCredentials {
  /** access_token / api_token / api_key 等 */
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  [key: string]: unknown;
}

// ─── 数据发现结果 ─────────────────────────────────────────────────────────────

export interface DiscoverResult {
  objects: DataObject[];
  /** 下次增量同步的游标（null 表示已全量） */
  next_cursor?: string;
}

// ─── 事件订阅 ─────────────────────────────────────────────────────────────────

export interface ConnectorEvent {
  type: string;
  uri: string;
  payload?: unknown;
  timestamp: number;
}

export interface Subscription {
  unsubscribe(): Promise<void>;
}

// ─── JoworkConnector 运行时接口 ───────────────────────────────────────────────

/**
 * 完整的 JCP 连接器接口。
 * 简单连接器只需实现 discover + fetch + health。
 * 高级连接器可额外实现 write 和 subscribe。
 */
export interface JoworkConnector {
  // === 元数据 ===
  readonly manifest: ConnectorManifest;
  /** 简写：同 manifest.id */
  readonly id: string;

  // === 生命周期 ===
  initialize(config: ConnectorConfig, credentials: EncryptedCredentials): Promise<void>;
  shutdown(): Promise<void>;
  health(): Promise<{ ok: boolean; latency_ms: number; error?: string }>;

  // === 数据发现（必须） ===
  discover(cursor?: string): Promise<DiscoverResult>;

  // === 数据获取（必须） ===
  fetch(uri: string, userContext: { user_id: string; role: Role }): Promise<{
    content: string;
    content_type: string;
    cached: boolean;
  }>;

  // === 写入（可选） ===
  write?(uri: string, content: string, userContext: { user_id: string; role: Role }): Promise<{
    success: boolean;
    new_uri?: string;
  }>;

  // === 事件订阅（可选，Premium） ===
  subscribe?(event_type: string, callback: (event: ConnectorEvent) => void): Promise<Subscription>;
}

// ─── OAuth 连接器扩展接口 ─────────────────────────────────────────────────────

/**
 * OAuth 连接器需额外实现的方法。
 * 用 `supportsOAuth(connector)` 类型守卫判断是否支持 OAuth。
 */
export interface OAuthConnector extends JoworkConnector {
  /**
   * 生成 OAuth 授权 URL。
   * @param state      CSRF 防御随机串（由路由层生成并校验）
   * @param redirectUri 回调地址
   */
  buildOAuthUrl(state: string, redirectUri: string): string;

  /**
   * 用授权码换取 access_token，并自行调用 saveOAuthCredentials 持久化。
   * @param code       授权码
   * @param redirectUri 必须与授权时一致
   * @param credentialUserId 凭证归属用户（缺省为 system）
   */
  exchangeToken(code: string, redirectUri: string, credentialUserId?: string): Promise<void>;
}

export function supportsOAuth(c: JoworkConnector): c is OAuthConnector {
  return typeof (c as OAuthConnector).buildOAuthUrl === 'function';
}

// ─── 适配层：将 JoworkConnector 包装为旧版 Connector 接口 ────────────────────

import type { Connector, DataSource } from '../types.js';

/**
 * 将 JoworkConnector 适配为核心 Connector 接口，
 * 使新协议连接器可直接注册到现有 registry。
 */
export function adaptToConnector(jcp: JoworkConnector, source: DataSource): Connector {
  return {
    id: jcp.id,
    source,
    async discover() {
      const result = await jcp.discover();
      return result.objects;
    },
    fetch: jcp.fetch.bind(jcp),
    health: jcp.health.bind(jcp),
  };
}
