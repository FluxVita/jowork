const CROSS_USER_PATTERNS: RegExp[] = [
  /(他人|别人|其他用户|其他同事|another user|other user|someone else).*(对话|会话|聊天|消息|session|chat|message)/i,
  /(对话|会话|聊天|消息|session|chat|message).*(他人|别人|其他用户|其他同事|another user|other user|someone else)/i,
  /(查询|查看|读取|导出|get|show|read|fetch|list).*(user_id|uid).*(对话|会话|聊天|消息|session|chat|message)/i,
];

export const CROSS_USER_QUERY_DENIED_MESSAGE = '拒绝执行：禁止查询其他用户的对话或会话内容。请仅查询你自己的数据或团队聚合信息。';

export function isCrossUserConversationQuery(input: string | null | undefined): boolean {
  const text = String(input ?? '').trim();
  if (!text) return false;
  return CROSS_USER_PATTERNS.some(p => p.test(text));
}
