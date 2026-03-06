/**
 * 一次性跑飞书组织架构 + 群组同步
 * 运行：npx tsx test/run-feishu-sync.ts
 */

import { syncOrgStructure } from '../src/connectors/feishu/org-sync.js';
import { syncAllUserGroups } from '../src/services/feishu-groups.js';
import { getDb } from '../src/datamap/db.js';

async function main() {
  console.log('=== Step 1: 飞书组织架构同步 ===\n');
  try {
    const orgResult = await syncOrgStructure();
    console.log(`✅ 组织架构同步完成: ${orgResult.synced} 用户, ${orgResult.deactivated} 停用\n`);
  } catch (err) {
    console.error('❌ 组织架构同步失败:', err);
  }

  // 查看同步后的用户
  const db = getDb();
  const users = db.prepare('SELECT user_id, name, role, department, feishu_open_id, is_active FROM users WHERE is_active = 1 ORDER BY role, name').all();
  console.log('=== 同步后用户列表 ===');
  console.table(users);

  console.log('\n=== Step 2: 群组成员同步 ===\n');
  try {
    const groupResult = await syncAllUserGroups();
    console.log(`✅ 群组同步完成: ${groupResult.synced} 条映射\n`);
  } catch (err) {
    console.error('❌ 群组同步失败:', err);
  }

  // 查看群组关系
  const groups = db.prepare(`
    SELECT ug.group_name, COUNT(*) as member_count,
      GROUP_CONCAT(u.name, ', ') as members
    FROM user_groups ug
    JOIN users u ON u.user_id = ug.user_id
    GROUP BY ug.group_id
    ORDER BY member_count DESC
  `).all();
  console.log('=== 群组成员关系 ===');
  console.table(groups);

  // 按角色统计
  const roleStats = db.prepare('SELECT role, COUNT(*) as cnt FROM users WHERE is_active = 1 GROUP BY role ORDER BY cnt DESC').all();
  console.log('\n=== 角色分布 ===');
  console.table(roleStats);
}

main().catch(console.error);
