import { getDb } from '../datamap/db.js';
import { config } from '../config.js';
import { feishuApi } from '../connectors/feishu/auth.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('group-bindings');

export interface GroupBinding {
  id: number;
  group_id: string;
  group_name: string | null;
  source_type: 'feishu_chat' | 'email_account';
  source_instance_id: string;
  source_instance_name: string | null;
  created_by: string;
  created_at: string;
}

export interface FeishuChatOption {
  chat_id: string;
  name: string;
  member_count: number;
}

export interface EmailAccountOption {
  account_id: string;
  address: string;
}

/** 创建绑定 */
export function createBinding(
  groupId: string,
  groupName: string | null,
  sourceType: 'feishu_chat' | 'email_account',
  instanceId: string,
  instanceName: string | null,
  createdBy: string,
): GroupBinding {
  const db = getDb();
  const info = db.prepare(`
    INSERT INTO group_source_bindings (group_id, group_name, source_type, source_instance_id, source_instance_name, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(group_id, source_type, source_instance_id) DO UPDATE SET
      group_name = excluded.group_name,
      source_instance_name = excluded.source_instance_name,
      created_by = excluded.created_by
  `).run(groupId, groupName, sourceType, instanceId, instanceName, createdBy);

  log.info('Binding created', { groupId, sourceType, instanceId });
  return getBindingById(Number(info.lastInsertRowid))!;
}

/** 按 ID 删除绑定 */
export function deleteBindingById(id: number): boolean {
  const db = getDb();
  const info = db.prepare('DELETE FROM group_source_bindings WHERE id = ?').run(id);
  return info.changes > 0;
}

/** 按 ID 获取绑定 */
function getBindingById(id: number): GroupBinding | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM group_source_bindings WHERE id = ?').get(id) as GroupBinding | undefined;
  return row ?? null;
}

/** 获取所有绑定 */
export function listAllBindings(): GroupBinding[] {
  const db = getDb();
  return db.prepare('SELECT * FROM group_source_bindings ORDER BY group_id, source_type, created_at DESC')
    .all() as GroupBinding[];
}

/** 获取某用户可见的绑定（联查 user_groups） */
export function getBindingsForUser(userId: string): GroupBinding[] {
  const db = getDb();
  return db.prepare(`
    SELECT gsb.* FROM group_source_bindings gsb
    JOIN user_groups ug ON ug.group_id = gsb.group_id
    WHERE ug.user_id = ?
    ORDER BY gsb.group_id, gsb.source_type, gsb.created_at DESC
  `).all(userId) as GroupBinding[];
}

/** 直接从飞书 API 获取 Bot 所在的群列表（含成员数） */
export async function getAvailableFeishuChats(): Promise<FeishuChatOption[]> {
  const chats: FeishuChatOption[] = [];
  let pageToken = '';

  try {
    do {
      const params: Record<string, string> = { page_size: '50' };
      if (pageToken) params['page_token'] = pageToken;

      const resp = await feishuApi<{
        code: number;
        data: {
          items: { chat_id: string; name: string; member_user_count?: number }[];
          page_token?: string;
          has_more?: boolean;
        };
      }>('/im/v1/chats', { params });

      if (resp.code !== 0) {
        log.error('getAvailableFeishuChats: feishu API error', { code: resp.code });
        break;
      }

      for (const item of resp.data.items || []) {
        chats.push({
          chat_id: item.chat_id,
          name: item.name,
          member_count: item.member_user_count ?? 0,
        });
      }

      pageToken = resp.data.has_more ? (resp.data.page_token ?? '') : '';
    } while (pageToken);
  } catch (err) {
    log.error('getAvailableFeishuChats: exception', err);
  }

  return chats;
}

/** 从 config 返回已配置的邮箱账号列表 */
export function getAvailableEmailAccounts(): EmailAccountOption[] {
  return config.email.accounts.map(a => ({
    account_id: a.id,
    address: a.user,
  }));
}
