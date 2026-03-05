import type { Connector, DataSource } from '../types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('connector-registry');
const connectors = new Map<string, Connector>();

export function registerConnector(connector: Connector) {
  connectors.set(connector.id, connector);
  log.info(`Registered connector: ${connector.id} (${connector.source})`);
}

export function getConnector(id: string): Connector | undefined {
  return connectors.get(id);
}

export function getConnectorBySource(source: DataSource): Connector | undefined {
  for (const c of connectors.values()) {
    if (c.source === source) return c;
  }
  return undefined;
}

export function getConnectors(): Connector[] {
  return Array.from(connectors.values());
}

export function listConnectors(): { id: string; source: DataSource }[] {
  return Array.from(connectors.values()).map(c => ({ id: c.id, source: c.source }));
}

/** 所有连接器健康检查 */
export async function healthCheckAll(): Promise<Record<string, { ok: boolean; latency_ms: number; error?: string }>> {
  const results: Record<string, { ok: boolean; latency_ms: number; error?: string }> = {};
  for (const [id, connector] of connectors) {
    try {
      results[id] = await connector.health();
    } catch (err) {
      results[id] = { ok: false, latency_ms: -1, error: String(err) };
    }
  }
  return results;
}
