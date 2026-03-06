import type { AgentEvent, AgentEngine, AgentEngineOpts } from '../types.js';
export declare class BuiltinEngine implements AgentEngine {
    readonly type: "builtin";
    run(opts: AgentEngineOpts): AsyncGenerator<AgentEvent>;
}
//# sourceMappingURL=builtin.d.ts.map