// JCP connector integration tests — Phase 22 + Phase 23
// Tests: auto-registration, listAllConnectorTypes, discoverViaConnector bridge

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Importing from index triggers auto-registration of JCP connectors
import {
  listJCPConnectors,
  getJCPConnector,
  listAllConnectorTypes,
  githubConnector,
  notionConnector,
  slackConnector,
  linearConnector,
  gitlabConnector,
  figmaConnector,
} from '../index.js';

describe('JCP connector auto-registration', () => {
  test('GitHub connector is auto-registered', () => {
    const connector = getJCPConnector('github');
    assert.ok(connector, 'GitHub connector should be registered');
    assert.equal(connector?.manifest.id, 'github');
    assert.equal(connector?.manifest.name, 'GitHub');
    assert.deepEqual(connector?.manifest.capabilities, ['discover', 'fetch', 'search']);
  });

  test('Notion connector is auto-registered', () => {
    const connector = getJCPConnector('notion');
    assert.ok(connector, 'Notion connector should be registered');
    assert.equal(connector?.manifest.id, 'notion');
    assert.equal(connector?.manifest.name, 'Notion');
  });

  test('Slack connector is auto-registered', () => {
    const connector = getJCPConnector('slack');
    assert.ok(connector, 'Slack connector should be registered');
    assert.equal(connector?.manifest.id, 'slack');
    assert.equal(connector?.manifest.name, 'Slack');
    assert.deepEqual(connector?.manifest.capabilities, ['discover', 'fetch', 'search']);
  });

  test('Linear connector is auto-registered', () => {
    const connector = getJCPConnector('linear');
    assert.ok(connector, 'Linear connector should be registered');
    assert.equal(connector?.manifest.id, 'linear');
    assert.equal(connector?.manifest.name, 'Linear');
  });

  test('GitLab connector is auto-registered', () => {
    const connector = getJCPConnector('gitlab');
    assert.ok(connector, 'GitLab connector should be registered');
    assert.equal(connector?.manifest.id, 'gitlab');
    assert.equal(connector?.manifest.name, 'GitLab');
  });

  test('Figma connector is auto-registered', () => {
    const connector = getJCPConnector('figma');
    assert.ok(connector, 'Figma connector should be registered');
    assert.equal(connector?.manifest.id, 'figma');
    assert.equal(connector?.manifest.name, 'Figma');
  });

  test('listJCPConnectors returns all 6 built-in connectors', () => {
    const manifests = listJCPConnectors();
    const ids = manifests.map(m => m.id);
    assert.ok(ids.includes('github'), 'Should include github');
    assert.ok(ids.includes('notion'), 'Should include notion');
    assert.ok(ids.includes('slack'),  'Should include slack');
    assert.ok(ids.includes('linear'), 'Should include linear');
    assert.ok(ids.includes('gitlab'), 'Should include gitlab');
    assert.ok(ids.includes('figma'),  'Should include figma');
    assert.ok(manifests.length >= 6, 'Should have at least 6 JCP connectors');
  });
});

describe('listAllConnectorTypes', () => {
  test('includes JCP connectors with system=jcp', () => {
    const types = listAllConnectorTypes();
    const jcpTypes = types.filter(t => t.system === 'jcp');
    const jcpIds   = jcpTypes.map(t => t.id);
    assert.ok(jcpIds.includes('github'), 'Should include github in JCP types');
    assert.ok(jcpIds.includes('notion'), 'Should include notion in JCP types');
    assert.ok(jcpIds.includes('slack'),  'Should include slack in JCP types');
  });

  test('all entries have id, name, system fields', () => {
    const types = listAllConnectorTypes();
    for (const t of types) {
      assert.ok(t.id,   `Entry ${JSON.stringify(t)} should have id`);
      assert.ok(t.name, `Entry ${JSON.stringify(t)} should have name`);
      assert.ok(t.system === 'legacy' || t.system === 'jcp', `System should be 'legacy' or 'jcp'`);
    }
  });
});

describe('Slack connector', () => {
  test('manifest has correct auth type', () => {
    assert.equal(slackConnector.manifest.authType, 'api_token');
  });

  test('defaultSensitivity is internal', () => {
    assert.equal(slackConnector.defaultSensitivity, 'internal');
  });

  test('health returns error without token (no crash)', async () => {
    // initialize with empty credentials — should not throw
    await slackConnector.initialize({}, {});
    const result = await slackConnector.health();
    // Without a real token, health check fails — that's expected
    assert.equal(typeof result.ok, 'boolean');
    assert.equal(typeof result.latencyMs, 'number');
  });
});

describe('GitHub connector', () => {
  test('manifest has correct auth type', () => {
    assert.equal(githubConnector.manifest.authType, 'api_token');
  });

  test('defaultSensitivity is internal', () => {
    assert.equal(githubConnector.defaultSensitivity, 'internal');
  });
});

describe('Notion connector', () => {
  test('defaultSensitivity is confidential', () => {
    assert.equal(notionConnector.defaultSensitivity, 'confidential');
  });

  test('manifest has correct auth type', () => {
    assert.equal(notionConnector.manifest.authType, 'api_token');
  });
});

describe('Linear connector', () => {
  test('manifest has correct auth type', () => {
    assert.equal(linearConnector.manifest.authType, 'api_token');
  });

  test('defaultSensitivity is internal', () => {
    assert.equal(linearConnector.defaultSensitivity, 'internal');
  });

  test('manifest includes search capability', () => {
    assert.ok(linearConnector.manifest.capabilities.includes('search'));
  });

  test('health returns error without token (no crash)', async () => {
    await linearConnector.initialize({}, {});
    const result = await linearConnector.health();
    assert.equal(typeof result.ok, 'boolean');
    assert.equal(typeof result.latencyMs, 'number');
  });
});

describe('GitLab connector', () => {
  test('manifest has correct auth type', () => {
    assert.equal(gitlabConnector.manifest.authType, 'api_token');
  });

  test('defaultSensitivity is internal', () => {
    assert.equal(gitlabConnector.defaultSensitivity, 'internal');
  });

  test('manifest includes search and fetch capabilities', () => {
    assert.ok(gitlabConnector.manifest.capabilities.includes('fetch'));
    assert.ok(gitlabConnector.manifest.capabilities.includes('search'));
  });

  test('configSchema allows custom base URL', () => {
    const schema = gitlabConnector.manifest.configSchema as { properties: { baseUrl: unknown } };
    assert.ok(schema.properties.baseUrl, 'Should have baseUrl in config schema');
  });
});

describe('Figma connector', () => {
  test('manifest has correct auth type', () => {
    assert.equal(figmaConnector.manifest.authType, 'api_token');
  });

  test('defaultSensitivity is internal', () => {
    assert.equal(figmaConnector.defaultSensitivity, 'internal');
  });

  test('configSchema has teamId and fileKeys fields', () => {
    const schema = figmaConnector.manifest.configSchema as { properties: { teamId: unknown; fileKeys: unknown } };
    assert.ok(schema.properties.teamId,   'Should have teamId in config schema');
    assert.ok(schema.properties.fileKeys, 'Should have fileKeys in config schema');
  });

  test('manifest includes search capability', () => {
    assert.ok(figmaConnector.manifest.capabilities.includes('search'));
  });

  test('discover with no config returns empty results (no crash)', async () => {
    await figmaConnector.initialize({}, {});
    const page = await figmaConnector.discover();
    assert.ok(Array.isArray(page.objects));
    assert.equal(page.objects.length, 0);
  });
});

// Phase 50: Connector Schema API
import { getConnectorTypeManifest } from '../index.js';

describe('listAllConnectorTypes — Phase 50 schema enrichment', () => {
  test('JCP connector entries include authType and description', () => {
    const types = listAllConnectorTypes();
    const github = types.find(t => t.id === 'github');
    assert.ok(github, 'github should be in types list');
    assert.equal(github?.authType, 'api_token');
    assert.ok(typeof github?.description === 'string' && github.description.length > 0, 'should have description');
  });

  test('JCP connector entries include configSchema', () => {
    const types = listAllConnectorTypes();
    const gitlab = types.find(t => t.id === 'gitlab');
    assert.ok(gitlab, 'gitlab should be in types list');
    const schema = gitlab?.configSchema as { properties?: { baseUrl?: unknown } } | undefined;
    assert.ok(schema?.properties?.baseUrl, 'gitlab should expose baseUrl in configSchema.properties');
  });
});

describe('getConnectorTypeManifest', () => {
  test('returns full manifest for a known JCP connector', () => {
    const manifest = getConnectorTypeManifest('github');
    assert.ok(manifest, 'Should return manifest for github');
    assert.equal(manifest?.id, 'github');
    assert.equal(manifest?.authType, 'api_token');
    assert.ok(manifest?.configSchema, 'Should include configSchema');
  });

  test('returns undefined for unknown connector id', () => {
    const manifest = getConnectorTypeManifest('nonexistent-connector');
    assert.equal(manifest, undefined);
  });

  test('returned manifest includes configSchema.properties for figma', () => {
    const manifest = getConnectorTypeManifest('figma');
    const props = (manifest?.configSchema as { properties?: Record<string, unknown> })?.properties;
    assert.ok(props?.['teamId'], 'figma manifest should have teamId in configSchema.properties');
  });
});
