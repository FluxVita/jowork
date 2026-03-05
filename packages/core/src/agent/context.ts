import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { routeModel } from '../models/router.js';
import { getMessages, updateSessionSummary } from './session.js';
import { getDb } from '../datamap/db.js';
import { createLogger } from '../utils/logger.js';
import { getUserById } from '../auth/users.js';
import { sanitizeToolResult, sanitizeOutput } from '../policy/context-pep.js';
import type { SessionMessage, ImageAttachment } from './types.js';
import type { ToolUseMessage } from '../models/router.js';
import type { ContextPepOpts } from '../policy/context-pep.js';

const log = createLogger('agent-context');

const MAX_CONTEXT_TOKENS = 100_000;
const MAX_TOOL_RESULT_TOKENS = 16_000;

// 归档阈值
const ARCHIVE_MESSAGE_THRESHOLD = 40;
const ARCHIVE_TOKEN_THRESHOLD = 80_000; // 100K 的 80%
const KEEP_RECENT_MESSAGES = 10;

/** 粗略 token 估算：中英混合，length/2 误差 ±20% */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2);
}

/** 截断单条内容到 token 上限 */
function truncateContent(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 2;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n...(内容过长，已截断)';
}

function getArchivePepOpts(userId: string): ContextPepOpts {
  let user = null;
  try {
    user = getUserById(userId);
  } catch {
    user = null;
  }
  return {
    userId,
    role: user?.role ?? 'guest',
    channelType: 'web',
  };
}

export function buildArchiveTextForSummary(messages: SessionMessage[], userId: string): string {
  const pepOpts = getArchivePepOpts(userId);
  const archiveLines: string[] = [];
  for (const m of messages) {
    if (m.role === 'tool_call') {
      const input = sanitizeToolResult(m.content.slice(0, 200), pepOpts).content;
      archiveLines.push(`[工具调用] ${m.tool_name}: ${input}`);
      continue;
    }

    const maxChars = m.role === 'tool_result' ? 300 : 400;
    const label = m.role === 'user' ? '[用户]' : m.role === 'assistant' ? '[助手]' : '[工具结果]';
    const content = sanitizeToolResult(m.content.slice(0, maxChars), pepOpts).content;
    const toolNameSuffix = m.role === 'tool_result' ? ` ${m.tool_name}:` : ':';
    archiveLines.push(`${label}${toolNameSuffix} ${content}`);
  }
  return archiveLines.join('\n');
}

/**
 * 检查并执行自动归档 + 摘要生成。
 * 当消息数超过阈值或 token 超预算时触发。
 */
export async function maybeArchiveAndSummarize(sessionId: string, userId: string): Promise<void> {
  const messages = getMessages(sessionId);
  if (messages.length < ARCHIVE_MESSAGE_THRESHOLD) {
    // 检查 token 量
    const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    if (totalTokens < ARCHIVE_TOKEN_THRESHOLD) return;
  }

  log.info(`Session ${sessionId}: ${messages.length} msgs, triggering archive`);

  // 保留最近 N 条消息，其余归档
  const toArchive = messages.slice(0, messages.length - KEEP_RECENT_MESSAGES);
  if (toArchive.length === 0) return;

  // 1. 写入归档文件
  const archiveDir = resolve(dirname(import.meta.url.replace('file://', '')), '..', '..', 'data', 'archives');
  mkdirSync(archiveDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archivePath = resolve(archiveDir, `${sessionId}_${timestamp}.json`);
  writeFileSync(archivePath, JSON.stringify(toArchive, null, 2), 'utf-8');
  log.info(`Archived ${toArchive.length} messages to ${archivePath}`);

  // 2. 用模型生成结构化摘要
  // 纳入 tool_call/tool_result，保留工具执行上下文
  const archiveText = buildArchiveTextForSummary(toArchive, userId);

  const SUMMARY_PROMPT = `你是对话状态摘要助手。请分析以下对话历史（包含用户消息、助手回复、工具调用和工具结果），输出一份结构化摘要。

严格按照以下 Markdown 格式输出，不得添加其他内容：

## 已确认的关键信息
（列举对话中已明确的事实、数据、URI、代码片段等，每条一行，用 - 开头）

## 已执行并成功的工具调用
（列举完成的工具操作及其关键结果，格式：- [工具名] 简短描述结果）

## 当前任务状态
（一段话说明用户当前在做什么、到了哪一步、有哪些待确认的问题）

## 未解决的问题
（列举还没有答案的问题，若无则写"无"）

注意：绝不省略已确认的数字、URI、代码片段、决策结论。`;

  let summary = '';
  try {
    const result = await routeModel({
      messages: [
        { role: 'user', content: `${SUMMARY_PROMPT}\n\n---对话历史---\n${archiveText.slice(0, 8000)}` },
      ],
      taskType: 'chat',
      userId,
      maxTokens: 600,
    });
    summary = `[COMPACTED_SUMMARY v2]\n${result.content}`;
  } catch (err) {
    log.warn('Failed to generate summary, using fallback', String(err));
    const userTopics = toArchive.filter(m => m.role === 'user').slice(0, 3).map(m => m.content.slice(0, 30)).join('、');
    const toolNames = [...new Set(toArchive.filter(m => m.role === 'tool_call').map(m => m.tool_name).filter(Boolean))].join('、');
    summary = `[COMPACTED_SUMMARY v2]\n## 当前任务状态\n对话包含 ${toArchive.length} 条消息，涉及主题：${userTopics}${toolNames ? `\n## 已执行并成功的工具调用\n- 使用了工具：${toolNames}` : ''}`;
  }

  // 3. 更新 session summary（入库前再次做输出侧脱敏）
  const archivePepOpts = getArchivePepOpts(userId);
  const safeSummary = sanitizeOutput(summary, archivePepOpts).content;
  updateSessionSummary(sessionId, safeSummary);

  // 4. 删除已归档的消息（保留最近 N 条）
  const db = getDb();
  const keepFromId = messages[messages.length - KEEP_RECENT_MESSAGES]?.id;
  if (keepFromId) {
    db.prepare('DELETE FROM session_messages WHERE session_id = ? AND id < ?')
      .run(sessionId, keepFromId);
  }

  // 5. 更新消息计数
  const remaining = db.prepare('SELECT COUNT(*) as n FROM session_messages WHERE session_id = ?')
    .get(sessionId) as { n: number };
  db.prepare('UPDATE sessions SET message_count = ? WHERE session_id = ?')
    .run(remaining.n, sessionId);

  log.info(`Session ${sessionId}: archived, summary generated, ${remaining.n} messages remaining`);
}

/**
 * 将 SessionMessage[] 转换为 Anthropic Messages API 格式。
 *
 * 规则：
 * - tool_call → assistant message 的 { type: 'tool_use' } content block
 * - tool_result → user message 的 { type: 'tool_result' } content block
 * - 连续的同 role 消息会合并成一条
 * - 超出预算时用 session summary 代替早期消息
 */
export function buildContextWindow(
  messages: SessionMessage[],
  sessionSummary: string | null,
): ToolUseMessage[] {
  // 从最新消息向前扫描，估算 token
  let totalTokens = 0;
  let cutoffIdx = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const content = msg.role === 'tool_result'
      ? truncateContent(msg.content, MAX_TOOL_RESULT_TOKENS)
      : msg.content;
    const tokens = estimateTokens(content);
    if (totalTokens + tokens > MAX_CONTEXT_TOKENS) {
      cutoffIdx = i + 1;
      break;
    }
    totalTokens += tokens;
  }

  const windowMessages = messages.slice(cutoffIdx);

  // 如果裁剪了历史且有摘要，在头部插入摘要
  const result: ToolUseMessage[] = [];
  if (cutoffIdx > 0 && sessionSummary) {
    result.push({
      role: 'user',
      content: `[以下是之前对话的摘要]\n${sessionSummary}`,
    });
    result.push({
      role: 'assistant',
      content: '好的，我已了解之前的对话内容。请继续。',
    });
  }

  // 转换消息格式，合并连续同 role 消息
  for (const msg of windowMessages) {
    if (msg.role === 'user') {
      const blocks: ContentBlock[] = [];

      // 如果消息携带图片附件（存在 metadata_json），先插入图片 blocks
      if (msg.metadata_json) {
        try {
          const meta = JSON.parse(msg.metadata_json) as { images?: ImageAttachment[] };
          if (meta.images && meta.images.length > 0) {
            for (const img of meta.images) {
              blocks.push({
                type: 'image',
                source: { type: 'base64', media_type: img.media_type, data: img.data },
              });
            }
          }
        } catch { /* 解析失败静默跳过 */ }
      }

      // 文本 block
      if (msg.content) {
        blocks.push({ type: 'text', text: msg.content });
      }

      if (blocks.length > 0) {
        pushOrMerge(result, 'user', blocks);
      }
    } else if (msg.role === 'assistant') {
      pushOrMerge(result, 'assistant', [{ type: 'text', text: msg.content }]);
    } else if (msg.role === 'tool_call') {
      // tool_call 属于 assistant
      let parsedInput: Record<string, unknown> = {};
      try { parsedInput = JSON.parse(msg.content); } catch { /* empty */ }
      pushOrMerge(result, 'assistant', [{
        type: 'tool_use',
        id: msg.tool_call_id!,
        name: msg.tool_name!,
        input: parsedInput,
      }]);
    } else if (msg.role === 'tool_result') {
      // tool_result 属于 user
      const truncated = truncateContent(msg.content, MAX_TOOL_RESULT_TOKENS);
      pushOrMerge(result, 'user', [{
        type: 'tool_result',
        tool_use_id: msg.tool_call_id!,
        content: truncated,
      }]);
    }
  }

  // 确保第一条消息是 user role（Anthropic 要求）
  if (result.length > 0 && result[0].role !== 'user') {
    result.unshift({ role: 'user', content: '请继续。' });
  }

  return result;
}

type ContentBlock = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  // image block
  source?: { type: 'base64'; media_type: string; data: string };
};

function pushOrMerge(
  result: ToolUseMessage[],
  role: 'user' | 'assistant',
  blocks: ContentBlock[],
) {
  const last = result[result.length - 1];
  if (last && last.role === role) {
    // 合并到上一条
    if (typeof last.content === 'string') {
      last.content = [{ type: 'text', text: last.content }, ...blocks];
    } else {
      (last.content as ContentBlock[]).push(...blocks);
    }
  } else {
    result.push({ role, content: blocks });
  }
}
