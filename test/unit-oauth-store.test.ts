import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  saveOAuthCredentials,
  deleteOAuthCredentials,
  listAuthorizedConnectorIdsAllUsers,
} from '../packages/core/dist/connectors/oauth-store.js';

describe('unit-oauth-store: authorized connector ids', () => {
  test('跨用户授权按 connector_id 去重', () => {
    const c1 = `ut_oauth_${Date.now()}_a`;
    const c2 = `ut_oauth_${Date.now()}_b`;

    saveOAuthCredentials(c1, { access_token: 'tok-a' }, 'u1');
    saveOAuthCredentials(c1, { access_token: 'tok-b' }, 'u2');
    saveOAuthCredentials(c2, { access_token: 'tok-c' }, 'u2');

    const ids = listAuthorizedConnectorIdsAllUsers();
    assert.ok(ids.includes(c1), '应包含 c1');
    assert.ok(ids.includes(c2), '应包含 c2');
    assert.equal(ids.filter(id => id === c1).length, 1, 'c1 只应出现一次');

    deleteOAuthCredentials(c1, 'u1');
    deleteOAuthCredentials(c1, 'u2');
    deleteOAuthCredentials(c2, 'u2');
  });
});
