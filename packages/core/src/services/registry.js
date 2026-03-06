import { getDb } from '../datamap/db.js';
import { createLogger } from '../utils/logger.js';
const log = createLogger('svc-registry');
function rowToService(row) {
    return {
        service_id: row.service_id,
        name: row.name,
        type: row.type,
        category: row.category ?? undefined,
        description: row.description ?? undefined,
        endpoint: row.endpoint ?? undefined,
        config: JSON.parse(row.config_json || '{}'),
        status: row.status,
        icon: row.icon ?? undefined,
        default_roles: JSON.parse(row.default_roles_json || '[]'),
        requires_config: row.requires_config === 1,
        sort_order: row.sort_order,
        data_scope: row.data_scope || undefined,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}
/** 注册新服务 */
export function registerService(svc) {
    const db = getDb();
    db.prepare(`
    INSERT INTO services (service_id, name, type, category, description, endpoint, config_json, status, icon, default_roles_json, requires_config, sort_order, data_scope)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(svc.service_id, svc.name, svc.type, svc.category ?? null, svc.description ?? null, svc.endpoint ?? null, JSON.stringify(svc.config ?? {}), svc.status ?? 'active', svc.icon ?? null, JSON.stringify(svc.default_roles ?? []), svc.requires_config ? 1 : 0, svc.sort_order ?? 0, svc.data_scope ?? 'public');
    log.info('Service registered', svc.service_id);
    return getService(svc.service_id);
}
/** 获取单个服务 */
export function getService(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM services WHERE service_id = ?').get(id);
    return row ? rowToService(row) : null;
}
/** 列出服务（支持过滤） */
export function listServices(opts) {
    const db = getDb();
    let sql = 'SELECT * FROM services WHERE 1=1';
    const params = [];
    if (opts?.type) {
        sql += ' AND type = ?';
        params.push(opts.type);
    }
    if (opts?.status) {
        sql += ' AND status = ?';
        params.push(opts.status);
    }
    if (opts?.data_scope) {
        sql += ' AND data_scope = ?';
        params.push(opts.data_scope);
    }
    sql += ' ORDER BY sort_order ASC, created_at ASC';
    const rows = db.prepare(sql).all(...params);
    return rows.map(rowToService);
}
/** 更新服务字段 */
export function updateService(id, fields) {
    const db = getDb();
    const sets = [];
    const params = [];
    if (fields.name !== undefined) {
        sets.push('name = ?');
        params.push(fields.name);
    }
    if (fields.description !== undefined) {
        sets.push('description = ?');
        params.push(fields.description);
    }
    if (fields.category !== undefined) {
        sets.push('category = ?');
        params.push(fields.category);
    }
    if (fields.endpoint !== undefined) {
        sets.push('endpoint = ?');
        params.push(fields.endpoint);
    }
    if (fields.config !== undefined) {
        sets.push('config_json = ?');
        params.push(JSON.stringify(fields.config));
    }
    if (fields.icon !== undefined) {
        sets.push('icon = ?');
        params.push(fields.icon);
    }
    if (fields.default_roles !== undefined) {
        sets.push('default_roles_json = ?');
        params.push(JSON.stringify(fields.default_roles));
    }
    if (fields.requires_config !== undefined) {
        sets.push('requires_config = ?');
        params.push(fields.requires_config ? 1 : 0);
    }
    if (fields.sort_order !== undefined) {
        sets.push('sort_order = ?');
        params.push(fields.sort_order);
    }
    if (fields.data_scope !== undefined) {
        sets.push('data_scope = ?');
        params.push(fields.data_scope);
    }
    if (sets.length === 0)
        return;
    sets.push("updated_at = datetime('now')");
    params.push(id);
    db.prepare(`UPDATE services SET ${sets.join(', ')} WHERE service_id = ?`).run(...params);
    log.info('Service updated', id);
}
/** 更新服务状态 */
export function updateServiceStatus(id, status) {
    const db = getDb();
    db.prepare("UPDATE services SET status = ?, updated_at = datetime('now') WHERE service_id = ?").run(status, id);
    log.info('Service status updated', { id, status });
}
//# sourceMappingURL=registry.js.map