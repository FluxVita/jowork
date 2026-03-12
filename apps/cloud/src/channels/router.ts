/**
 * Channel Router: decides whether a task should be handled cloud-side
 * or forwarded to the user's local JoWork instance.
 */
export type RouteDecision = 'cloud' | 'local' | 'queue';

export interface RouteContext {
  action: string;
  requiresLocalAccess: boolean;
  userOnline: boolean;
}

const LOCAL_ACTIONS = new Set([
  'open_file', 'run_command', 'read_clipboard', 'local_search',
  'terminal', 'file_edit',
]);

export function routeTask(ctx: RouteContext): RouteDecision {
  // Actions requiring local machine access
  if (ctx.requiresLocalAccess || LOCAL_ACTIONS.has(ctx.action)) {
    return ctx.userOnline ? 'local' : 'queue';
  }

  // Cloud-capable actions
  return 'cloud';
}
