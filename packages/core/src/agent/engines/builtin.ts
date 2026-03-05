import { createLogger } from '../../utils/logger.js';
import { registerFileToken } from '../../gateway/routes/agent.js';
import {
  routeModel,
  routeModelWithTools,
  streamModelWithTools,
  recordModelCost,
  getKlaudeInfo,
  type ToolUseRequest,
  type StreamDelta,
} from '../../models/router.js';
import { checkCreditSufficient, deductCredits, getCreditsBalance, getUpgradeTo } from '../../billing/credits.js';
import { hasFeature, featureGateMessage, checkFeatureAccess, type FeatureKey } from '../../billing/features.js';
import { createSession, getSession, appendMessage, getMessages, updateSessionTitle } from '../session.js';
import { buildContextWindow, maybeArchiveAndSummarize } from '../context.js';
import { getTool, getToolDefinitions, getBuiltinTool, initTools } from '../tools/registry.js';
import { resolveServicesForUser } from '../../services/resolver.js';
import { getUserById } from '../../auth/users.js';
import { stripInternal, extractInternal, hasInternal } from '../internal-filter.js';
import { getWorkstylePrompt } from '../workstyle.js';
import { detectLearnSuggestion } from '../learn-detector.js';
import {
  sanitizeToolResult,
  sanitizeOutput,
  getSecurityPromptSegment,
  type ContextPepOpts,
  type ChannelType,
} from '../../policy/context-pep.js';
import { getUserPreferences, formatPrefsForPrompt } from '../../preferences/user-preferences.js';
import type { AgentEvent, AgentEngine, AgentEngineOpts, ToolContext, AnthropicToolDef, StructuredResult, ImageAttachment } from '../types.js';

const log = createLogger('builtin-engine');

const MAX_TOOL_ROUNDS = 25;
const MODEL_RETRY_MAX = 2;
const MODEL_RETRY_BASE_MS = 2000;

const SYSTEM_PROMPT = `You are an AI assistant connected to your organization's data systems, including documents, code repositories, project management, and email.

When the user asks a question:
1. Use search_data to search for relevant data
2. Use fetch_content to retrieve full content when needed
3. Answer based on the data you find

## Available Tools

- **search_data**: Search the data index by keyword, source, or type
- **list_chat_messages**: List recent group/channel messages (by time, no keyword needed)
- **fetch_content**: Retrieve full content by URI
- **list_sources**: List connected data sources
- **run_query**: Query by exact filters (source, type, sensitivity level)
- **read_memory**: Search the user's personal memory store
- **write_memory**: Save important info to memory (preferences, decisions, key facts)
- **query_posthog**: Query PostHog user behavior data (profiles / events / analytics / HogQL)
- **query_oss_sessions**: Query raw AI conversation logs (use only when analyzing specific user conversations)
- **create_gitlab_mr**: Create a branch, commit file changes, and open an MR for code fixes
- **run_command**: Run a whitelisted shell command on the Gateway server (npm test, tsc, git status, etc.)
- **manage_workspace**: Manage a temporary workspace — clone, apply fixes, commit+push to a new branch
- **lark_list_chats**: Find a chat ID for message delivery (not for reading messages)
- **lark_send_message**: Send a Lark/Feishu message to a group or user
- **lark_create_calendar_event**: Create an event in the user's primary calendar

## Tool Selection Rules
- Recent messages (no keyword) → list_chat_messages
- Keyword search in messages → search_data (include_chat=true)
- lark_* tools are for actions only (send message, create event), not for querying local data

## Output Rules
- "Send to me", "show me", "convert to markdown" → reply directly in chat, do NOT call lark_send_message
- Only call lark_send_message when the user explicitly says "send to Lark/Feishu" or "notify in the group"

## Decision Rules
- Decide how many tool rounds to use based on task complexity
- Simple queries: 1-2 rounds
- Complex analysis: up to 5-10 rounds (search → fetch details → cross-verify)
- Expand search if first results are insufficient
- Use write_memory proactively when the user mentions preferences or key decisions

## Data Reading Strategy
- Overview: use search_data for summaries ("what are", "list", "overview")
- Full read: use fetch_content for detail ("analyze", "read through", "explain")
- Pagination: fetch_content supports offset/limit for large documents
  - First call: omit offset → gets first 30,000 chars
  - If response says "truncated", continue with offset
- Freshness: fetch_content reads local cache by default; pass fresh=true when the user needs the latest version

## Code Fix Workflow (for confirmed bugs)

**Trigger**: A P0/P1 bug is confirmed in analysis AND the user explicitly requests a fix.

### Path A — Quick fix (no local test)
For simple, targeted changes:
1. Read the relevant code with fetch_content
2. Confirm fix with the user
3. Use create_gitlab_mr(get_projects) to confirm the project ID
4. Use create_gitlab_mr(create_branch) to create an ai/fix-xxx branch
5. Use create_gitlab_mr(write_file) to commit the fix (multiple files supported)
6. Use create_gitlab_mr(create_mr) — include analysis evidence in the description
7. Return the MR link

### Path B — Local verify then MR (strict mode)
For complex, multi-file, or logic-sensitive changes:
1. Read relevant code, confirm root cause
2. Confirm fix plan with the user
3. Use manage_workspace(create) to create a local workspace
4. Use manage_workspace(apply_file) to write fixes
5. Use run_command("tsc --noEmit") and run_command("npm test") to verify
6. On success, use manage_workspace(commit_push) to push the branch
7. Use create_gitlab_mr(create_mr) — include test evidence
8. Use manage_workspace(clean) to clean up
9. Return the MR link

**Constraints**:
- Always read the original file before writing fixes
- Always get user confirmation before write operations
- MR description must cite evidence from the analysis`;

let toolsInitialized = false;

function ensureTools() {
  if (!toolsInitialized) {
    initTools();
    toolsInitialized = true;
  }
}

function is4xxError(err: unknown): boolean {
  const msg = String(err);
  return /\b4\d{2}\b/.test(msg) && !/\b429\b/.test(msg);
}

function isConnectionError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('connect etimedout')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function* callModelStreamWithRetry(
  params: ToolUseRequest,
  maxRetries = MODEL_RETRY_MAX,
): AsyncGenerator<StreamDelta> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      yield* streamModelWithTools(params);
      return;
    } catch (err: unknown) {
      if (attempt === maxRetries || is4xxError(err) || isConnectionError(err)) throw err;
      const delay = MODEL_RETRY_BASE_MS * Math.pow(2, attempt);
      log.warn(`Stream call failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms`, String(err));
      await sleep(delay);
    }
  }
}

/** 根据工具名和输入参数生成人类可读的执行进度描述 */
function getToolProgressMessage(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'search_data': {
      const q = (input['query'] as string | undefined)?.slice(0, 40);
      const src = input['source'] as string | undefined;
      const parts: string[] = [];
      if (q) parts.push(`"${q}"`);
      if (src) parts.push(`来源: ${src}`);
      return `正在搜索 ${parts.join(' ')}...`;
    }
    case 'fetch_content': {
      const uri = (input['uri'] as string | undefined)?.slice(0, 60);
      const fresh = input['fresh'] === true;
      if (uri) return fresh ? `正在拉取最新版: ${uri}` : `正在读取: ${uri}`;
      return '正在读取内容...';
    }
    case 'run_query': {
      const src = input['source'] as string | undefined;
      const type = input['source_type'] as string | undefined;
      const parts = [src, type].filter(Boolean).join('/');
      return `正在查询 ${parts || '数据'}...`;
    }
    case 'read_memory': {
      const q = (input['query'] as string | undefined)?.slice(0, 40);
      return q ? `正在搜索记忆: "${q}"` : '正在读取记忆库...';
    }
    case 'write_memory': {
      const t = (input['title'] as string | undefined)?.slice(0, 40);
      return t ? `正在保存记忆: "${t}"` : '正在写入记忆...';
    }
    case 'list_sources':
      return '正在列出数据源...';
    case 'query_posthog': {
      const action = input['action'] as string | undefined;
      const distinct = (input['distinct_id'] as string | undefined)?.slice(0, 30)
        ?? (input['person_id'] as string | undefined)?.slice(0, 30);
      const actionLabel: Record<string, string> = {
        get_person: '查询用户信息',
        get_events: '拉取事件列表',
        get_event_stats: '统计事件分布',
        hogql: '执行 HogQL 查询',
      };
      const label = action ? (actionLabel[action] ?? action) : 'PostHog 查询';
      return distinct ? `正在 ${label}: ${distinct}` : `正在${label}...`;
    }
    case 'query_oss_sessions': {
      const action = input['action'] as string | undefined;
      const uid = (input['uid'] as string | undefined)?.slice(0, 20);
      const actionLabel: Record<string, string> = {
        get_user_summary: '查看用户会话概览',
        list_sessions: '列出会话文件',
        get_session: '读取会话内容',
        get_recent: '读取最近会话',
      };
      const label = action ? (actionLabel[action] ?? action) : 'OSS 查询';
      return uid ? `正在 ${label}: uid=${uid}` : `正在${label}...`;
    }
    case 'create_gitlab_mr': {
      const action = input['action'] as string | undefined;
      const actionLabel: Record<string, string> = {
        get_projects: '列出项目',
        create_branch: '创建分支',
        write_file: '提交代码',
        create_mr: '创建 MR',
      };
      const label = action ? (actionLabel[action] ?? action) : 'GitLab 操作';
      const branch = (input['branch_name'] as string | undefined) ?? (input['source_branch'] as string | undefined);
      return branch ? `正在 ${label}: ${branch}` : `正在${label}...`;
    }
    case 'lark_list_chats': {
      const query = input['query'] as string | undefined;
      return query ? `正在搜索飞书群聊: "${query}"` : '正在获取飞书群聊列表...';
    }
    case 'list_chat_messages': {
      const chatId = input['chat_id'] as string | undefined;
      return chatId ? `正在获取群 ${chatId} 的消息...` : '正在获取最近群聊消息...';
    }
    case 'lark_send_message': {
      const receiveId = (input['receive_id'] as string | undefined)?.slice(0, 30);
      return receiveId ? `正在发送飞书消息至 ${receiveId}...` : '正在发送飞书消息...';
    }
    case 'lark_create_calendar_event': {
      const summary = (input['summary'] as string | undefined)?.slice(0, 30);
      return summary ? `正在创建日历事件: ${summary}` : '正在创建飞书日历事件...';
    }
    default:
      return '';
  }
}

export class BuiltinEngine implements AgentEngine {
  readonly type = 'builtin' as const;

  async *run(opts: AgentEngineOpts): AsyncGenerator<AgentEvent> {
    ensureTools();

    const { userId, role, message, images, isGroupChat, extraTools, extraPrompts, externalToolExecutor, signal } = opts;
    let sessionId = opts.sessionId;

    // engine_info 事件
    yield { event: 'engine_info', data: { engine: 'builtin' } };

    // Context PEP
    const pepOpts: ContextPepOpts = {
      userId,
      role,
      channelType: (opts.channel?.type ?? 'web') as ChannelType,
      isGroupChat,
    };

    // Session 管理
    let session = sessionId ? getSession(sessionId) : null;
    if (!session) {
      session = createSession(userId, undefined, 'builtin');
      sessionId = session.session_id;
      yield { event: 'session_created', data: { session_id: sessionId } };
    } else {
      sessionId = session.session_id;
    }

    // 自动归档检查
    await maybeArchiveAndSummarize(sessionId, userId);
    session = getSession(sessionId) ?? session;

    // 保存用户消息（图片附件存入 metadata）
    appendMessage({
      session_id: sessionId,
      role: 'user',
      content: message,
      metadata: images && images.length > 0 ? { images } : undefined,
    });

    // 工具上下文
    const toolCtx: ToolContext = { user_id: userId, role, session_id: sessionId };

    let toolDefs = getToolDefinitions();
    const user = getUserById(userId);
    if (user && user.role !== 'owner') {
      const userServices = resolveServicesForUser(user);
      const allowedToolNames = new Set(
        userServices.filter(s => s.type === 'tool').map(s => s.config['tool_name'] as string).filter(Boolean)
      );
      if (allowedToolNames.size > 0) {
        toolDefs = toolDefs.filter(t => allowedToolNames.has(t.name));
      }
    }

    if (extraTools && extraTools.length > 0) {
      toolDefs = [...toolDefs, ...extraTools];
    }

    // system prompt
    const securitySegment = getSecurityPromptSegment(pepOpts);
    const userPrefs = getUserPreferences(userId);
    const prefsSegment = formatPrefsForPrompt(userPrefs);
    let systemPrompt = SYSTEM_PROMPT + '\n\n' + securitySegment;
    if (prefsSegment) systemPrompt += '\n\n' + prefsSegment;
    const workstyleSegment = getWorkstylePrompt(userId);
    if (workstyleSegment) systemPrompt += '\n\n' + workstyleSegment;
    if (extraPrompts && extraPrompts.length > 0) {
      systemPrompt += '\n\n' + extraPrompts.join('\n\n');
    }

    const klaudeInfo = getKlaudeInfo();

    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalCostUsd = 0;

    // 追踪上一轮工具调用名称（用于 behavior 标签）
    let prevRoundToolNames: string[] = [];

    for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
      // 检查中断
      if (signal?.aborted) {
        yield { event: 'stopped', data: {} };
        return;
      }

      // 积分预检（仅云托管）
      if (!checkCreditSufficient(userId, 2000)) {
        const balance = getCreditsBalance(userId);
        yield {
          event: 'credits_exhausted',
          data: { used: balance.used, total: balance.total, upgrade_to: getUpgradeTo(userId) },
        };
        return;
      }

      yield { event: 'activity', data: { message: round === 1 ? '正在思考...' : `正在思考（第 ${round} 轮）...` } };

      const allMessages = getMessages(sessionId);
      const contextMessages = buildContextWindow(allMessages, session.summary);

      const reqParams: ToolUseRequest = {
        system: systemPrompt,
        messages: contextMessages,
        tools: toolDefs,
        userId,
      };

      let fullText = '';
      let stopReason = 'end_turn';
      let tokensIn = 0;
      let tokensOut = 0;
      const toolCalls: { id: string; name: string; inputJson: string }[] = [];
      let currentToolIdx = -1;
      let inToolUse = false;

      try {
        for await (const delta of callModelStreamWithRetry(reqParams)) {
          if (signal?.aborted) {
            yield { event: 'stopped', data: {} };
            return;
          }

          switch (delta.type) {
            case 'message_start':
              tokensIn = delta.tokensIn;
              break;
            case 'text':
              fullText += delta.text;
              yield { event: 'text_delta', data: { delta: delta.text } };
              break;
            case 'tool_use_start':
              inToolUse = true;
              currentToolIdx = toolCalls.length;
              toolCalls.push({ id: delta.id, name: delta.name, inputJson: '' });
              yield { event: 'activity', data: { message: `准备调用 ${delta.name}...` } };
              break;
            case 'tool_input_delta':
              if (currentToolIdx >= 0 && toolCalls[currentToolIdx]) {
                toolCalls[currentToolIdx].inputJson += delta.json;
              }
              break;
            case 'content_block_stop':
              if (inToolUse) inToolUse = false;
              break;
            case 'message_delta':
              tokensOut = delta.tokensOut;
              stopReason = delta.stopReason;
              break;
            case 'done':
              break;
          }
        }
      } catch (err) {
        yield { event: 'error', data: { message: String(err) } };
        return;
      }

      // 成本计算
      const costPer1k = klaudeInfo?.costPer1kToken ?? 0.003;
      const roundCost = ((tokensIn + tokensOut) / 1000) * costPer1k;
      totalTokensIn += tokensIn;
      totalTokensOut += tokensOut;
      totalCostUsd += roundCost;

      // behavior 标签：首轮为对话轮次，后续轮次为工具调用
      const behavior = round === 1 ? 'agent_chat_turn' : 'tool_call';
      const toolNameForCost = round > 1 && prevRoundToolNames.length > 0
        ? prevRoundToolNames[0]
        : undefined;

      let costRecordId: number | undefined;
      if (klaudeInfo) {
        costRecordId = recordModelCost({
          user_id: userId,
          provider: klaudeInfo.provider,
          model: klaudeInfo.model,
          task_type: 'chat',
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          cost_usd: roundCost,
          date: new Date().toISOString().slice(0, 10),
          behavior,
          tool_name: toolNameForCost,
        });
      }

      // 积分扣减
      const totalRoundTokens = tokensIn + tokensOut;
      if (totalRoundTokens > 0) {
        deductCredits(userId, totalRoundTokens, costRecordId);
      }

      // 更新上一轮工具名称（供下一轮使用）
      prevRoundToolNames = toolCalls.map(tc => tc.name);

      yield {
        event: 'usage',
        data: {
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          model: klaudeInfo ? `${klaudeInfo.provider}/${klaudeInfo.model}` : 'unknown',
          cost_usd: roundCost,
        },
      };

      if (stopReason === 'tool_use' && toolCalls.length > 0) {
        if (fullText) {
          const filtered = stripInternal(fullText);
          if (hasInternal(fullText)) {
            log.debug('Stripped internal reasoning', extractInternal(fullText));
          }
          if (filtered) {
            appendMessage({
              session_id: sessionId,
              role: 'assistant',
              content: filtered,
              tokens: tokensOut,
              model: klaudeInfo?.model,
              provider: klaudeInfo?.provider,
              cost_usd: roundCost,
            });
          }
        }

        const parsedCalls = toolCalls.map(tc => {
          let parsedInput: Record<string, unknown> = {};
          try { parsedInput = JSON.parse(tc.inputJson || '{}'); } catch { /* empty */ }
          return { ...tc, parsedInput };
        });

        for (const tc of parsedCalls) {
          yield { event: 'tool_call', data: { id: tc.id, name: tc.name, input: tc.parsedInput, status: 'running' } };
          appendMessage({
            session_id: sessionId,
            role: 'tool_call',
            content: JSON.stringify(tc.parsedInput),
            tool_name: tc.name,
            tool_call_id: tc.id,
          });
          // 立即发送工具进度描述（在 await 前，用户能看到"正在做什么"）
          const progressMsg = getToolProgressMessage(tc.name, tc.parsedInput);
          if (progressMsg) {
            yield { event: 'tool_update', data: { id: tc.id, status: 'running', message: progressMsg } };
          }
        }

        if (parsedCalls.length > 1) {
          yield { event: 'activity', data: { message: `并行执行 ${parsedCalls.length} 个工具...` } };
        } else {
          yield { event: 'activity', data: { message: `正在执行 ${parsedCalls[0].name}...` } };
        }

        // Feature Gate：受限工具对应的 FeatureKey
        const TOOL_FEATURE_MAP: Record<string, FeatureKey> = {
          run_command:      'run_command',
          manage_workspace: 'manage_workspace',
          create_gitlab_mr: 'create_gitlab_mr',
        };

        const executeOne = async (tc: typeof parsedCalls[0]): Promise<{ result: string; duration_ms: number; structured?: StructuredResult }> => {
          const startMs = Date.now();

          // Feature Gate 检查（cloud 托管 + 非 owner 用户）
          const featureKey = TOOL_FEATURE_MAP[tc.name];
          if (featureKey && user) {
            const gateResult = checkFeatureAccess(user.user_id, featureKey, user.role);
            if (!gateResult.allowed) {
              const msg = featureGateMessage(featureKey, gateResult.current_plan, gateResult.required_plan);
              return { result: `[feature_gate] ${msg}`, duration_ms: 0 };
            }
          }

          const builtinTool = getBuiltinTool(tc.name);
          let result: string;
          let structured: StructuredResult | undefined;
          if (builtinTool) {
            try {
              if (builtinTool.executeStructured) {
                const sr = await builtinTool.executeStructured(tc.parsedInput, toolCtx);
                result = sr.text;
                structured = sr.structured;
              } else {
                result = await builtinTool.execute(tc.parsedInput, toolCtx);
              }
            } catch (err) {
              result = `[tool_error] 工具执行失败 — ${String(err)}`;
            }
          } else if (externalToolExecutor) {
            try {
              result = await externalToolExecutor(tc.name, tc.parsedInput);
            } catch (err) {
              result = `[tool_error] 外部工具执行失败 — ${String(err)}`;
            }
          } else {
            result = `[tool_error] 未知工具 "${tc.name}"`;
          }
          return { result, duration_ms: Date.now() - startMs, structured };
        };

        const rawResults = await Promise.all(parsedCalls.map(executeOne));

        for (let i = 0; i < parsedCalls.length; i++) {
          const tc = parsedCalls[i];
          const { result: rawToolResult, duration_ms, structured } = rawResults[i];

          const sanitized = sanitizeToolResult(rawToolResult, pepOpts);
          const toolResult = sanitized.content;
          if (sanitized.redacted) {
            log.info(`Tool result sanitized for ${tc.name}`, sanitized.redactedLabels);
          }

          const isError = toolResult.startsWith('[tool_error]');
          const preview = toolResult.length > 200 ? toolResult.slice(0, 200) + '...' : toolResult;

          // file 类型：注册 token 并生成 file_attachment 事件
          if (!isError && structured?.type === 'file' && structured.file_path && structured.file_name) {
            try {
              const { statSync } = await import('node:fs');
              const stat = statSync(structured.file_path);
              const dlToken = registerFileToken(structured.file_path, structured.file_name);
              yield {
                event: 'file_attachment',
                data: { filename: structured.file_name, download_token: dlToken, size_bytes: stat.size },
              };
            } catch { /* 文件不存在，继续走普通 tool_result */ }
          }

          yield {
            event: 'tool_result',
            data: {
              id: tc.id, name: tc.name, result_preview: preview,
              status: isError ? 'error' : 'success', duration_ms,
              result_type: structured?.type,
              structured: isError ? undefined : structured,
            },
          };

          appendMessage({
            session_id: sessionId,
            role: 'tool_result',
            content: toolResult,
            tool_name: tc.name,
            tool_call_id: tc.id,
            tool_status: isError ? 'error' : 'success',
            duration_ms,
          });
        }

        continue;
      }

      // end_turn
      let finalContent = fullText || '(无回复)';

      if (hasInternal(finalContent)) {
        log.debug('Stripped internal reasoning from final', extractInternal(finalContent));
        finalContent = stripInternal(finalContent) || '(无回复)';
      }

      const outputCheck = sanitizeOutput(finalContent, pepOpts);
      finalContent = outputCheck.content;
      if (outputCheck.warnings.length > 0) {
        log.warn('Output sanitized before delivery', outputCheck.warnings);
      }

      const savedMsgId = appendMessage({
        session_id: sessionId,
        role: 'assistant',
        content: finalContent,
        tokens: totalTokensIn + totalTokensOut,
        model: klaudeInfo?.model,
        provider: klaudeInfo?.provider,
        cost_usd: totalCostUsd,
      });

      yield { event: 'text_done', data: { content: finalContent, message_id: savedMsgId } };

      // §6.3 自学习：检测用户消息中的偏好表达，建议记录
      const learnSuggestion = detectLearnSuggestion(message);
      if (learnSuggestion) {
        yield { event: 'learn_suggestion', data: { ...learnSuggestion, user_id: userId } };
      }

      if (session.message_count <= 1) {
        generateSessionTitle(sessionId, message, finalContent, userId).catch(err => {
          log.warn('Failed to generate session title', String(err));
        });
      }

      return;
    }

    yield { event: 'error', data: { message: '工具调用轮数超限（25轮），请简化问题后重试。' } };
  }
}

/** 用模型生成简短会话标题 */
async function generateSessionTitle(sessionId: string, userMessage: string, assistantReply: string, userId: string) {
  try {
    const result = await routeModel({
      messages: [
        { role: 'system', content: '根据用户消息和助手回复，生成一个简短的中文对话标题（5-15字，不加引号和标点）。只输出标题本身。' },
        { role: 'user', content: `用户：${userMessage.slice(0, 200)}\n助手：${assistantReply.slice(0, 200)}` },
      ],
      taskType: 'chat',
      userId,
      maxTokens: 30,
    });
    const title = result.content.trim().replace(/^["「]|["」]$/g, '').slice(0, 50);
    if (title) {
      updateSessionTitle(sessionId, title);
    }
  } catch {
    const title = userMessage.length > 30 ? userMessage.slice(0, 30) + '...' : userMessage;
    updateSessionTitle(sessionId, title);
  }
}
