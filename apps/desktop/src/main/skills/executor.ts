import type { Skill } from './types';
import type { EngineManager } from '../engine/manager';

/**
 * Executes skills by sending prompts to the active engine.
 */
export class SkillExecutor {
  constructor(private engineManager: EngineManager) {}

  /**
   * Execute a simple skill: interpolate variables into template and send to engine.
   */
  async *executeSimple(
    skill: Skill,
    vars: Record<string, string>,
    sessionId?: string,
  ): AsyncGenerator<unknown> {
    if (!skill.promptTemplate) {
      throw new Error(`Skill ${skill.id} has no prompt template`);
    }

    const prompt = this.interpolate(skill.promptTemplate, vars);

    for await (const event of this.engineManager.chat({
      message: prompt,
      sessionId,
    })) {
      yield event;
    }
  }

  /**
   * Execute a workflow skill: run steps sequentially.
   */
  async *executeWorkflow(
    skill: Skill,
    vars: Record<string, string>,
    sessionId?: string,
  ): AsyncGenerator<unknown> {
    if (!skill.steps?.length) {
      throw new Error(`Skill ${skill.id} has no steps`);
    }

    const context = { ...vars };

    for (const step of skill.steps) {
      // Check condition
      if (step.condition && !this.evaluateCondition(step.condition, context)) {
        continue;
      }

      const prompt = this.interpolate(step.prompt, context);
      let result = '';

      for await (const event of this.engineManager.chat({
        message: prompt,
        sessionId,
      })) {
        yield event;
        // Collect result text for variable binding
        const e = event as { type: string; content?: string };
        if (e.type === 'text' && e.content) {
          result += e.content;
        }
      }

      // Bind output to variable for next steps
      if (step.outputVar) {
        context[step.outputVar] = result;
      }
    }
  }

  private interpolate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}|\$([A-Z_]+)/g, (_, braceVar, dollarVar) => {
      const key = braceVar || dollarVar;
      return vars[key] ?? `{{${key}}}`;
    });
  }

  private evaluateCondition(condition: string, context: Record<string, string>): boolean {
    // Simple truthy check: "varName" → check if context[varName] is truthy
    return !!context[condition];
  }
}
