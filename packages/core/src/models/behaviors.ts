export type BehaviorType =
  | 'agent_chat_turn'   // 用户发一条消息的完整 LLM 调用（首轮）
  | 'tool_call'         // 工具执行后 LLM 处理结果的调用（多轮）
  | 'context_build'     // 构建上下文窗口的 LLM 调用
  | 'memory_op'         // 记忆库语义搜索（embedding + LLM）
  | 'connector_sync'    // 后台 Connector 数据同步
  | 'embedding'         // 纯向量计算（Moonshot embedding）
  | 'untagged';         // 兜底：未打标的旧记录

export const BEHAVIOR_LABELS: Record<BehaviorType, string> = {
  agent_chat_turn: '用户对话轮次',
  tool_call: '工具调用',
  context_build: '上下文构建',
  memory_op: '记忆库操作',
  connector_sync: '后台同步',
  embedding: '向量计算',
  untagged: '未分类',
};
