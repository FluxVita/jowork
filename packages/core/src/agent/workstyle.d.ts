/** 读取用户的工作方式文档 */
export declare function getWorkstyle(userId: string): string | null;
/** 保存用户的工作方式文档 */
export declare function saveWorkstyle(userId: string, content: string): void;
/** 获取工作方式的 prompt 片段（为空则返回空字符串） */
export declare function getWorkstylePrompt(userId: string): string;
//# sourceMappingURL=workstyle.d.ts.map