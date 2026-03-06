/**
 * Skill 生命周期管理 — 安装/卸载/启用/禁用 + MCP 服务自动启动。
 */
import { getDb } from '../datamap/db.js';
import { createLogger } from '../utils/logger.js';
import { getOrCreateBridge } from '../agent/mcp-bridge.js';
import { getSkillToolDefs, getSkillPrompt, parseSkillRecord } from './loader.js';
const log = createLogger('skill-manager');
// ─── Schema ───
export function ensureSkillsTable() {
    const db = getDb();
    db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      installed_at TEXT DEFAULT (datetime('now'))
    )
  `);
}
// ─── CRUD ───
export function listSkills() {
    ensureSkillsTable();
    const db = getDb();
    const rows = db.prepare('SELECT * FROM skills ORDER BY installed_at').all();
    return rows.map(rowToRecord).map(parseSkillRecord);
}
export function getActiveSkills() {
    ensureSkillsTable();
    const db = getDb();
    const rows = db.prepare('SELECT * FROM skills WHERE is_active = 1').all();
    return rows.map(rowToRecord).map(parseSkillRecord);
}
export function getSkill(id) {
    ensureSkillsTable();
    const db = getDb();
    const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(id);
    return row ? parseSkillRecord(rowToRecord(row)) : null;
}
export function installSkill(manifest) {
    ensureSkillsTable();
    const db = getDb();
    // 检查是否已安装
    const existing = db.prepare('SELECT id FROM skills WHERE id = ?').get(manifest.id);
    if (existing) {
        // 更新
        db.prepare('UPDATE skills SET name = ?, version = ?, manifest_json = ?, is_active = 1 WHERE id = ?')
            .run(manifest.name, manifest.version, JSON.stringify(manifest), manifest.id);
        log.info(`Updated skill: ${manifest.name} v${manifest.version}`);
    }
    else {
        db.prepare('INSERT INTO skills (id, name, version, manifest_json) VALUES (?, ?, ?, ?)')
            .run(manifest.id, manifest.name, manifest.version, JSON.stringify(manifest));
        log.info(`Installed skill: ${manifest.name} v${manifest.version}`);
    }
    return {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        manifest_json: JSON.stringify(manifest),
        is_active: true,
        installed_at: new Date().toISOString(),
        manifest,
    };
}
export function uninstallSkill(id) {
    ensureSkillsTable();
    const db = getDb();
    const result = db.prepare('DELETE FROM skills WHERE id = ?').run(id);
    if (result.changes > 0) {
        log.info(`Uninstalled skill: ${id}`);
        return true;
    }
    return false;
}
export function setSkillActive(id, active) {
    ensureSkillsTable();
    const db = getDb();
    const result = db.prepare('UPDATE skills SET is_active = ? WHERE id = ?')
        .run(active ? 1 : 0, id);
    return result.changes > 0;
}
// ─── 运行时集成 ───
/** 获取所有活跃 Skill 的工具定义 */
export function getAllSkillToolDefs() {
    const skills = getActiveSkills();
    const defs = [];
    for (const skill of skills) {
        if (skill.manifest) {
            defs.push(...getSkillToolDefs(skill.manifest));
        }
    }
    return defs;
}
/** 获取所有活跃 Skill 的 system prompt 片段 */
export function getAllSkillPrompts() {
    const skills = getActiveSkills();
    const prompts = [];
    for (const skill of skills) {
        if (skill.manifest) {
            const prompt = getSkillPrompt(skill.manifest);
            if (prompt)
                prompts.push(prompt);
        }
    }
    return prompts;
}
/** 启动 Skill 声明的 MCP 服务器 */
export async function startSkillMcpServers(manifest) {
    if (!manifest.mcp_servers || manifest.mcp_servers.length === 0)
        return;
    for (const mcpConfig of manifest.mcp_servers) {
        const config = {
            id: `skill_${manifest.id}_${mcpConfig.name}`,
            name: `${manifest.name}/${mcpConfig.name}`,
            command: mcpConfig.command,
            args: mcpConfig.args ?? [],
            env: mcpConfig.env ?? {},
            is_active: true,
        };
        try {
            await getOrCreateBridge(config);
            log.info(`Started MCP server for skill ${manifest.name}: ${mcpConfig.name}`);
        }
        catch (err) {
            log.error(`Failed to start MCP server for skill ${manifest.name}`, String(err));
        }
    }
}
// ─── Helpers ───
function rowToRecord(row) {
    return {
        id: row['id'],
        name: row['name'],
        version: row['version'],
        manifest_json: row['manifest_json'],
        is_active: row['is_active'] === 1,
        installed_at: row['installed_at'],
    };
}
//# sourceMappingURL=manager.js.map