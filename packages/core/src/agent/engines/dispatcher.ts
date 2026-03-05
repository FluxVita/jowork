/**
 * agent/engines/dispatcher.ts
 * 引擎工厂 + 用户偏好管理
 * Free tier: 仅内置 builtin engine
 * Premium 通过 registerEngineFactory() 注入额外引擎
 */
import { getUserSetting, setUserSetting } from '../../auth/settings.js';
import type { AgentEngine, EngineType } from '../types.js';
import { BuiltinEngine } from './builtin.js';

type EngineFactory = () => Promise<AgentEngine>;
type EngineInfo = { type: EngineType; name: string; description: string; available: boolean };

const _factories = new Map<EngineType, EngineFactory>();
const _engineInfos = new Map<EngineType, Omit<EngineInfo, 'type'>>();

// 内置引擎始终注册
_factories.set('builtin', async () => new BuiltinEngine());
_engineInfos.set('builtin', {
  name: '自建引擎',
  description: '内置 25 轮 tool-calling loop，连接内部数据源',
  available: true,
});

/** Premium 调用此函数注册额外引擎 */
export function registerEngineFactory(
  type: EngineType,
  factory: EngineFactory,
  info: Omit<EngineInfo, 'type'>,
) {
  _factories.set(type, factory);
  _engineInfos.set(type, info);
}

export async function createEngine(type: EngineType): Promise<AgentEngine> {
  const factory = _factories.get(type);
  if (!factory) throw new Error(`引擎 "${type}" 不可用（可能需要 Premium）`);
  return factory();
}

export function getDefaultEngine(userId: string): EngineType {
  const val = getUserSetting(userId, 'default_agent_engine');
  if (val === 'builtin' || val === 'claude_agent') return val;
  return 'builtin';
}

export function setDefaultEngine(userId: string, engine: EngineType) {
  setUserSetting(userId, 'default_agent_engine', engine);
}

export function listEngines(): EngineInfo[] {
  const result: EngineInfo[] = [];
  for (const [type, info] of _engineInfos) {
    result.push({ type, ...info });
  }
  // 在列表末尾追加未注册的 claude_agent 作为不可用提示
  if (!_factories.has('claude_agent')) {
    result.push({
      type: 'claude_agent',
      name: 'Claude Code',
      description: '基于 Claude Agent SDK（Premium 功能）',
      available: false,
    });
  }
  return result;
}
