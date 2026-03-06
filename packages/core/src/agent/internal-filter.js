/**
 * 过滤模型输出中的 <internal>...</internal> 标签。
 * 内部推理内容不应暴露给终端用户。
 */
const INTERNAL_RE = /<internal>[\s\S]*?<\/internal>/g;
/** 移除所有 <internal> 标签及其内容，返回清洁文本 */
export function stripInternal(text) {
    return text.replace(INTERNAL_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}
/** 提取所有 <internal> 标签内容（用于日志/调试） */
export function extractInternal(text) {
    const matches = [];
    let match;
    const re = /<internal>([\s\S]*?)<\/internal>/g;
    while ((match = re.exec(text)) !== null) {
        matches.push(match[1].trim());
    }
    return matches;
}
/** 检测文本是否包含 <internal> 标签 */
export function hasInternal(text) {
    return INTERNAL_RE.test(text);
}
//# sourceMappingURL=internal-filter.js.map