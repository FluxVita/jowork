/**
 * 过滤模型输出中的 <internal>...</internal> 标签。
 * 内部推理内容不应暴露给终端用户。
 */
/** 移除所有 <internal> 标签及其内容，返回清洁文本 */
export declare function stripInternal(text: string): string;
/** 提取所有 <internal> 标签内容（用于日志/调试） */
export declare function extractInternal(text: string): string[];
/** 检测文本是否包含 <internal> 标签 */
export declare function hasInternal(text: string): boolean;
//# sourceMappingURL=internal-filter.d.ts.map