import type { Connector, DataSource } from '../types.js';
export declare function registerConnector(connector: Connector): void;
export declare function getConnector(id: string): Connector | undefined;
export declare function getConnectorBySource(source: DataSource): Connector | undefined;
export declare function getConnectors(): Connector[];
export declare function listConnectors(): {
    id: string;
    source: DataSource;
}[];
/** 所有连接器健康检查 */
export declare function healthCheckAll(): Promise<Record<string, {
    ok: boolean;
    latency_ms: number;
    error?: string;
}>>;
//# sourceMappingURL=registry.d.ts.map