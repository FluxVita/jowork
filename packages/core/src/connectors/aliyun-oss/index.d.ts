/**
 * 阿里云 OSS Connector — 会话日志索引
 *
 * 目录结构（可通过 ALIYUN_OSS_PREFIX 环境变量配置前缀）：
 *   {prefix}/monitor/{user_uid}/{session_type}/{date}/{run_id}.json
 *
 * Discover：索引所有用户目录（每个用户一个 DataObject）
 * Fetch：下载并解析具体会话文件
 */
import type { Connector, DataObject, DataSource, Role } from '../../types.js';
declare const MONITOR_PREFIX: string;
interface OSSClient {
    list(query: Record<string, unknown>, options?: Record<string, unknown>): Promise<{
        objects?: Array<{
            name: string;
            size: number;
            lastModified: string;
        }>;
        prefixes?: string[];
        nextMarker?: string;
        isTruncated?: boolean;
    }>;
    get(name: string): Promise<{
        content: Buffer;
    }>;
}
declare function getClient(): OSSClient;
/** 分页列出所有对象/前缀（自动处理 nextMarker） */
declare function listAll(prefix: string, delimiter?: string): Promise<{
    objects: string[];
    prefixes: string[];
}>;
/** 从路径前缀解析 user_uid */
declare function uidFromPrefix(prefix: string): string;
export declare class AliyunOSSConnector implements Connector {
    readonly id = "aliyun_oss_v1";
    readonly source: DataSource;
    discover(): Promise<DataObject[]>;
    fetch(uri: string, _userContext: {
        user_id: string;
        role: Role;
    }): Promise<{
        content: string;
        content_type: string;
        cached: boolean;
    }>;
    health(): Promise<{
        ok: boolean;
        latency_ms: number;
        error?: string;
    }>;
    private fetchUserOverview;
    private fetchDateSessions;
    private fetchSessionFile;
}
interface SessionFile {
    run_id: string;
    user_id: number;
    entrance: string;
    stop_reason?: string;
    model_loops?: Array<{
        contents?: Array<{
            role: string;
            vertex_content?: {
                parts?: Array<{
                    text?: string;
                }>;
            };
        }>;
        settings?: {
            agent_name?: string;
        };
    }>;
}
declare function formatSession(json: SessionFile, path: string): string;
export { getClient, listAll, MONITOR_PREFIX, uidFromPrefix, formatSession };
export type { SessionFile };
//# sourceMappingURL=index.d.ts.map