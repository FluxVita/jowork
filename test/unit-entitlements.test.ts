import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { checkConnectorQuota, getConnectorEntitlements, getSubscriptionPlan } from '../packages/core/dist/billing/entitlements.js';
import { setScopedValue } from '../packages/core/dist/auth/settings.js';

describe('unit-entitlements: connector quota', () => {
  test('free 计划最多 3 个连接器', () => {
    const denied = checkConnectorQuota('jira_v1', {
      plan: 'free',
      connectedConnectorIds: ['gitlab_v1', 'linear_v1', 'github_v1'],
    });
    assert.equal(denied.allowed, false);
    assert.equal(denied.reason, 'limit_reached');
    assert.equal(denied.connector_limit, 3);
    assert.equal(denied.connected, 3);
    assert.equal(denied.upgrade_to, 'personal_basic');
  });

  test('同一连接器已连接时允许重连（即使已满）', () => {
    const allowed = checkConnectorQuota('github_v1', {
      plan: 'free',
      connectedConnectorIds: ['gitlab_v1', 'linear_v1', 'github_v1'],
    });
    assert.equal(allowed.allowed, true);
    assert.equal(allowed.reason, 'already_connected');
  });

  test('personal_basic 最多 5 个连接器', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const denied = checkConnectorQuota('extra', {
      plan: 'personal_basic',
      connectedConnectorIds: ids,
    });
    assert.equal(denied.allowed, false);
    assert.equal(denied.connector_limit, 5);
    assert.equal(denied.upgrade_to, 'personal_pro');
  });

  test('team_starter 最多 10 个连接器', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `c${i}`);
    const denied = checkConnectorQuota('extra', {
      plan: 'team_starter',
      connectedConnectorIds: ids,
    });
    assert.equal(denied.allowed, false);
    assert.equal(denied.connector_limit, 10);
    assert.equal(denied.upgrade_to, 'team_pro');
  });

  test('personal_pro/max/team_pro/team_business 不限连接器数量', () => {
    const many = Array.from({ length: 50 }, (_, i) => `c${i}`);
    for (const plan of ['personal_pro', 'personal_max', 'team_pro', 'team_business'] as const) {
      const r = checkConnectorQuota('extra', { plan, connectedConnectorIds: many });
      assert.equal(r.allowed, true, `plan ${plan} should be unlimited`);
      assert.equal(r.connector_limit, null, `plan ${plan} connector_limit should be null`);
    }
  });

  test('entitlement summary 返回 remaining', () => {
    const s = getConnectorEntitlements({
      plan: 'free',
      connectedConnectorIds: ['a', 'b'],
    });
    assert.equal(s.plan, 'free');
    assert.equal(s.connector_limit, 3);
    assert.equal(s.connected, 2);
    assert.equal(s.remaining, 1);
  });

  test('旧计划名 pro/team/business 向后兼容', () => {
    // pro → personal_pro (无限制)
    const proR = checkConnectorQuota('x', {
      plan: 'pro' as never,
      connectedConnectorIds: Array.from({ length: 20 }, (_, i) => `c${i}`),
    });
    assert.equal(proR.allowed, true);
    assert.equal(proR.connector_limit, null);

    // team → team_starter (10 限制)
    const teamR = checkConnectorQuota('x', {
      plan: 'team' as never,
      connectedConnectorIds: Array.from({ length: 10 }, (_, i) => `c${i}`),
    });
    assert.equal(teamR.allowed, false);
    assert.equal(teamR.connector_limit, 10);
  });

  test('组织套餐配置优先于环境变量', () => {
    const prev = process.env['JOWORK_PLAN'];
    process.env['JOWORK_PLAN'] = 'free';
    setScopedValue('org', 'default', 'subscription_plan', 'team_starter');
    assert.equal(getSubscriptionPlan(), 'team_starter');
    setScopedValue('org', 'default', 'subscription_plan', 'free');
    if (prev == null) delete process.env['JOWORK_PLAN'];
    else process.env['JOWORK_PLAN'] = prev;
  });
});
