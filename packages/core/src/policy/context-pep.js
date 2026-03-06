/**
 * Context PEP (Policy Enforcement Point)
 *
 * 防止敏感数据通过 Agent 上下文泄露。三道防线：
 *
 * 1. sanitizeToolResult — 工具返回结果进入 LLM 上下文前脱敏
 * 2. sanitizeOutput    — Agent 最终输出到渠道前检查
 * 3. getSensitivityCeiling — 根据渠道+用户确定最大可见级别
 *
 * 与 policy/engine.ts 的 checkAccess/filterByAccess 互补：
 * - engine.ts 决定"能不能看到这条数据"（对象级）
 * - context-pep.ts 决定"这段内容能不能进入 LLM / 输出到特定渠道"（内容级）
 */
import { createLogger } from '../utils/logger.js';
const log = createLogger('context-pep');
// ─── 敏感级别天花板 ───
const SENSITIVITY_ORDER = {
    public: 0,
    internal: 1,
    restricted: 2,
    secret: 3,
};
/**
 * 计算渠道+用户组合下的最大可见敏感级别。
 *
 * 规则：
 * - 飞书群聊：最多 internal（群里有多人，不能泄露 restricted）
 * - 飞书私聊：跟随用户角色
 * - Web 客户端：跟随用户角色
 * - CLI：跟随用户角色（本地操作，信任度高）
 */
export function getSensitivityCeiling(opts) {
    const { role, channelType, isGroupChat } = opts;
    // 飞书群聊：硬限制 internal（无论角色）
    if (channelType === 'feishu' && isGroupChat) {
        return 'internal';
    }
    // 按角色确定天花板
    switch (role) {
        case 'owner':
            return 'secret';
        case 'admin':
            return 'restricted';
        case 'member':
            return 'internal';
        case 'guest':
            return 'public';
        default:
            return 'public';
    }
}
/** 检查某敏感级别是否在天花板以内 */
export function isWithinCeiling(sensitivity, ceiling) {
    return SENSITIVITY_ORDER[sensitivity] <= SENSITIVITY_ORDER[ceiling];
}
// ─── 敏感模式匹配 ───
/** 可能包含敏感信息的正则模式 */
const SENSITIVE_PATTERNS = [
    // 金额（薪资、融资等）
    { pattern: /(?:薪资|工资|月薪|年薪|base|salary|compensation|offer)\s*[:：]?\s*[\d,.]+\s*(?:k|K|万|元|美元|USD|RMB)?/gi, label: 'salary', replacement: '[薪资信息已隐藏]' },
    // 银行账号
    { pattern: /(?:账[号户]|bank\s*account)\s*[:：]?\s*[\d\s-]{10,}/gi, label: 'bank_account', replacement: '[银行信息已隐藏]' },
    // 身份证号
    { pattern: /\b\d{17}[\dXx]\b/g, label: 'id_card', replacement: '[证件号已隐藏]' },
    // 手机号（中国）
    { pattern: /\b1[3-9]\d{9}\b/g, label: 'phone', replacement: '[手机号已隐藏]' },
    // API Key / Secret 模式
    { pattern: /(?:api[_-]?key|secret|token|password|密[码钥])\s*[:=：]\s*\S{8,}/gi, label: 'credential', replacement: '[凭证已隐藏]' },
    // 融资金额
    { pattern: /(?:融资|估值|valuation|funding|round)\s*[:：]?\s*\$?[\d,.]+\s*(?:万|亿|M|B|million|billion)?/gi, label: 'funding', replacement: '[融资信息已隐藏]' },
];
/**
 * 对工具返回的内容进行脱敏处理，再传入 LLM 上下文。
 *
 * 两级处理：
 * 1. 如果工具结果带有 sensitivity 标记且超过天花板 → 整体拒绝
 * 2. 正则匹配敏感模式 → 局部替换
 */
export function sanitizeToolResult(content, opts, 
/** 这条工具结果关联的数据对象敏感级别（如有） */
dataSensitivity) {
    const ceiling = getSensitivityCeiling(opts);
    const redactedLabels = [];
    // 第一道：整体敏感级别检查
    if (dataSensitivity && !isWithinCeiling(dataSensitivity, ceiling)) {
        log.info(`Blocked tool result: sensitivity ${dataSensitivity} exceeds ceiling ${ceiling} for user ${opts.userId}`);
        return {
            content: `[数据访问受限] 此内容的敏感级别（${dataSensitivity}）超出当前渠道允许范围（${ceiling}），无法显示。`,
            redacted: true,
            redactedLabels: ['sensitivity_blocked'],
        };
    }
    // 第二道：模式匹配脱敏（仅对非 owner 执行）
    let sanitized = content;
    if (opts.role !== 'owner') {
        for (const { pattern, label, replacement } of SENSITIVE_PATTERNS) {
            // 重置 regex lastIndex（全局模式）
            pattern.lastIndex = 0;
            if (pattern.test(sanitized)) {
                pattern.lastIndex = 0;
                sanitized = sanitized.replace(pattern, replacement);
                redactedLabels.push(label);
            }
        }
    }
    if (redactedLabels.length > 0) {
        log.info(`Redacted ${redactedLabels.length} sensitive patterns from tool result`, redactedLabels);
    }
    return { content: sanitized, redacted: redactedLabels.length > 0, redactedLabels };
}
/**
 * 对 Agent 最终输出内容进行渠道安全检查。
 *
 * 与 sanitizeToolResult 不同：这里不做模式替换（内容已经过 LLM 加工），
 * 而是做最后一道检查，确保输出不包含明显的敏感模式。
 */
export function sanitizeOutput(content, opts) {
    const warnings = [];
    // owner 不过滤输出
    if (opts.role === 'owner') {
        return { content, warnings };
    }
    let sanitized = content;
    // 群聊中额外严格：脱敏所有模式
    if (opts.channelType === 'feishu' && opts.isGroupChat) {
        for (const { pattern, label, replacement } of SENSITIVE_PATTERNS) {
            pattern.lastIndex = 0;
            if (pattern.test(sanitized)) {
                pattern.lastIndex = 0;
                sanitized = sanitized.replace(pattern, replacement);
                warnings.push(`output_redacted:${label}`);
            }
        }
    }
    // 所有渠道：检查凭证泄露（最严格的类型，不分角色）
    const credentialPattern = SENSITIVE_PATTERNS.find(p => p.label === 'credential');
    if (credentialPattern) {
        credentialPattern.pattern.lastIndex = 0;
        if (credentialPattern.pattern.test(sanitized)) {
            credentialPattern.pattern.lastIndex = 0;
            sanitized = sanitized.replace(credentialPattern.pattern, credentialPattern.replacement);
            if (!warnings.includes('output_redacted:credential')) {
                warnings.push('output_redacted:credential');
            }
        }
    }
    if (warnings.length > 0) {
        log.warn(`Sanitized output for channel ${opts.channelType}`, warnings);
    }
    return { content: sanitized, warnings };
}
/**
 * 生成带有安全上下文的 system prompt 补充段。
 * 告诉模型当前用户的数据访问范围，避免模型主动引用超权限数据。
 */
export function getSecurityPromptSegment(opts) {
    const ceiling = getSensitivityCeiling(opts);
    const channelDesc = opts.channelType === 'feishu' && opts.isGroupChat
        ? '飞书群聊（多人可见）'
        : opts.channelType === 'feishu'
            ? '飞书私聊'
            : opts.channelType === 'web'
                ? 'Web 客户端'
                : opts.channelType;
    return [
        `[安全上下文]`,
        `- 当前用户角色: ${opts.role}`,
        `- 当前渠道: ${channelDesc}`,
        `- 最大可见数据级别: ${ceiling}`,
        `- 禁止在回复中包含: API密钥、密码、银行账号、身份证号等凭证信息`,
        ceiling === 'public' ? '- 仅可引用公开数据，不可引用任何内部或受限数据' : '',
        ceiling === 'internal' ? '- 可引用内部数据，但不可引用受限(restricted)或机密(secret)数据' : '',
        opts.isGroupChat ? '- 群聊场景：回复内容所有群成员可见，注意信息脱敏' : '',
    ].filter(Boolean).join('\n');
}
//# sourceMappingURL=context-pep.js.map