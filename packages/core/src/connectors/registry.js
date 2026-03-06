import { createLogger } from '../utils/logger.js';
const log = createLogger('connector-registry');
const connectors = new Map();
export function registerConnector(connector) {
    connectors.set(connector.id, connector);
    log.info(`Registered connector: ${connector.id} (${connector.source})`);
}
export function getConnector(id) {
    return connectors.get(id);
}
export function getConnectorBySource(source) {
    for (const c of connectors.values()) {
        if (c.source === source)
            return c;
    }
    return undefined;
}
export function getConnectors() {
    return Array.from(connectors.values());
}
export function listConnectors() {
    return Array.from(connectors.values()).map(c => ({ id: c.id, source: c.source }));
}
/** 所有连接器健康检查 */
export async function healthCheckAll() {
    const results = {};
    for (const [id, connector] of connectors) {
        try {
            results[id] = await connector.health();
        }
        catch (err) {
            results[id] = { ok: false, latency_ms: -1, error: String(err) };
        }
    }
    return results;
}
//# sourceMappingURL=registry.js.map