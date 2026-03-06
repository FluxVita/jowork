/** 读取 cursor（不存在返回 null） */
export declare function getCursor(connectorId: string, cursorKey: string): string | null;
/** 保存 cursor */
export declare function setCursor(connectorId: string, cursorKey: string, value: string): void;
/** 删除 cursor（重置为全量同步） */
export declare function resetCursor(connectorId: string, cursorKey?: string): void;
/** 列出某 connector 的所有 cursor */
export declare function listCursors(connectorId: string): Record<string, string>;
//# sourceMappingURL=sync-state.d.ts.map