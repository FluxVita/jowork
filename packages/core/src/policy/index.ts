// @jowork/core/policy — basic permission engine

import type { Role, SensitivityLevel } from '../types.js';
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

// ─── Sensitivity PEP (Policy Enforcement Point) ───────────────────────────────

const SENSITIVITY_LEVELS: SensitivityLevel[] = ['public', 'internal', 'confidential', 'secret'];

function sensitivityLevel(s: SensitivityLevel): number {
  return SENSITIVITY_LEVELS.indexOf(s);
}

/**
 * Returns the maximum sensitivity level a role may access.
 * - guest   → public only
 * - member  → internal and below
 * - admin   → confidential and below
 * - owner   → all (including secret)
 */
export function maxSensitivityFor(role: Role): SensitivityLevel {
  switch (role) {
    case 'guest':  return 'public';
    case 'member': return 'internal';
    case 'admin':  return 'confidential';
    case 'owner':  return 'secret';
  }
}

/**
 * Returns true if a user with `role` is allowed to read a document with `docSensitivity`.
 */
export function canReadSensitivity(role: Role, docSensitivity: SensitivityLevel): boolean {
  return sensitivityLevel(docSensitivity) <= sensitivityLevel(maxSensitivityFor(role));
}

/**
 * Filters an array of objects by sensitivity, keeping only those the role may access.
 */
export function filterBySensitivity<T extends { sensitivity: SensitivityLevel }>(
  items: T[],
  role: Role,
): T[] {
  return items.filter(item => canReadSensitivity(role, item.sensitivity));
}
