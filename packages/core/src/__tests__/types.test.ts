import { describe, it, expect } from 'vitest';
import type { EngineId, EngineType, ChatOpts, EngineEvent } from '../types/engine';
import type { SourceType, DataSource, ConnectorConfig } from '../types/connector';
import type { MemoryScope, Memory } from '../types/memory';
import type { PlanId, Plan, Credits, Subscription } from '../types/billing';
import type { Role, User, Team } from '../types/user';

describe('Type definitions', () => {
  it('EngineId covers expected values', () => {
    const engines: EngineId[] = ['claude-code', 'openclaw', 'codex', 'jowork-cloud'];
    expect(engines).toHaveLength(4);
  });

  it('EngineType covers local and cloud', () => {
    const types: EngineType[] = ['local', 'cloud'];
    expect(types).toHaveLength(2);
  });

  it('ChatOpts has required message field', () => {
    const opts: ChatOpts = { message: 'hello' };
    expect(opts.message).toBe('hello');
    expect(opts.sessionId).toBeUndefined();
  });

  it('SourceType covers all connector types', () => {
    const sources: SourceType[] = ['github', 'gitlab', 'figma', 'feishu', 'local-folder'];
    expect(sources).toHaveLength(5);
  });

  it('MemoryScope covers all scopes', () => {
    const scopes: MemoryScope[] = ['personal', 'team', 'project'];
    expect(scopes).toHaveLength(3);
  });

  it('PlanId covers free/pro/team', () => {
    const plans: PlanId[] = ['free', 'pro', 'team'];
    expect(plans).toHaveLength(3);
  });

  it('Role covers all roles', () => {
    const roles: Role[] = ['owner', 'admin', 'member', 'viewer'];
    expect(roles).toHaveLength(4);
  });

  it('User type structure', () => {
    const user: User = {
      id: 'u1',
      name: 'Test',
      role: 'owner',
      createdAt: new Date(),
    };
    expect(user.id).toBe('u1');
  });

  it('Team type structure', () => {
    const team: Team = {
      id: 't1',
      name: 'Test Team',
      ownerId: 'u1',
      createdAt: new Date(),
    };
    expect(team.ownerId).toBe('u1');
  });

  it('Plan type structure', () => {
    const plan: Plan = {
      id: 'pro',
      name: 'Pro',
      priceMonthly: 1900,
      features: ['Cloud engine'],
    };
    expect(plan.priceMonthly).toBe(1900);
  });

  it('Credits type structure', () => {
    const credits: Credits = { balance: 100 };
    expect(credits.balance).toBe(100);
    expect(credits.lastTopUpAt).toBeUndefined();
  });

  it('Subscription type structure', () => {
    const sub: Subscription = {
      planId: 'pro',
      status: 'active',
      currentPeriodEnd: new Date(),
    };
    expect(sub.status).toBe('active');
  });
});
