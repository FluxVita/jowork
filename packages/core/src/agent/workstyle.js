/**
 * agent/workstyle.ts
 * 用户工作方式文档 — 每个用户一个 Markdown 文件，Agent 对话时自动读取
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const WORKSTYLE_DIR = resolve('data', 'workstyles');
function ensureDir() {
    if (!existsSync(WORKSTYLE_DIR)) {
        mkdirSync(WORKSTYLE_DIR, { recursive: true });
    }
}
function getPath(userId) {
    // 安全：只允许字母数字和连字符
    const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return resolve(WORKSTYLE_DIR, `${safe}.md`);
}
/** 读取用户的工作方式文档 */
export function getWorkstyle(userId) {
    const path = getPath(userId);
    if (!existsSync(path))
        return null;
    return readFileSync(path, 'utf-8');
}
/** 保存用户的工作方式文档 */
export function saveWorkstyle(userId, content) {
    ensureDir();
    writeFileSync(getPath(userId), content, 'utf-8');
}
/** 获取工作方式的 prompt 片段（为空则返回空字符串） */
export function getWorkstylePrompt(userId) {
    const content = getWorkstyle(userId);
    if (!content?.trim())
        return '';
    return `## 用户工作方式\n\n以下是用户自定义的工作方式说明，请据此调整你的回答风格和行为：\n\n${content.trim()}`;
}
//# sourceMappingURL=workstyle.js.map