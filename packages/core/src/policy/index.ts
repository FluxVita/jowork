// @jowork/core/policy — basic permission engine

import type { Role } from '../types.js';
import { ForbiddenError } from '../types.js';

// Role hierarchy (higher index = more privileges)
const ROLE_HIERARCHY: Role[] = ['guest', 'member', 'admin', 'owner'];

function roleLevel(role: Role): number {
  return ROLE_HIERARCHY.indexOf(role);
}

/** Returns true if `userRole` satisfies the minimum required role. */
export function hasRole(userRole: Role, minRole: Role): boolean {
  return roleLevel(userRole) >= roleLevel(minRole);
}

/** Throws ForbiddenError if user does not have the minimum required role. */
export function assertRole(userRole: Role, minRole: Role, action?: string): void {
  if (!hasRole(userRole, minRole)) {
    throw new ForbiddenError(action);
  }
}

/** Personal mode: single owner, all operations allowed for the local user */
export function personalModePolicy(): { role: Role } {
  return { role: 'owner' };
}
