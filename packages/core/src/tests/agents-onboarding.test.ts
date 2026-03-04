// Tests for Phase 28: Agent management functions + Onboarding state machine
//
// Uses in-memory SQLite via openDb/closeDb pattern.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

import { openDb, closeDb } from '../datamap/db.js';
import { initSchema } from '../datamap/init.js';
import { getOnboardingState, advanceOnboarding } from '../onboarding/index.js';
import type { OnboardingStep } from '../onboarding/index.js';

// ─── DB setup ─────────────────────────────────────────────────────────────────

function setupTestDb(): Database.Database {
  closeDb();
  const dir = mkdtempSync(join(tmpdir(), 'jowork-agent-test-'));
  const db = openDb(dir);
  initSchema(db);
  const now = new Date().toISOString();
  // Seed a default user for FK requirements
  db.prepare(`INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run('owner-1', 'Owner', 'owner@test', 'owner', now);
  db.prepare(`INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run('member-1', 'Member', 'member@test', 'member', now);
  return db;
}

// ─── Onboarding state machine ─────────────────────────────────────────────────

describe('Onboarding — getOnboardingState', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('returns "welcome" as the first step for a new user', () => {
    const state = getOnboardingState('owner-1');
    assert.equal(state.currentStep, 'welcome');
    assert.deepEqual(state.completedSteps, []);
    assert.equal(state.userId, 'owner-1');
    assert.ok(state.startedAt);
    assert.equal(state.completedAt, null);
  });

  test('returns the same state on second call (idempotent)', () => {
    const s1 = getOnboardingState('owner-1');
    const s2 = getOnboardingState('owner-1');
    assert.equal(s1.currentStep, s2.currentStep);
    assert.deepEqual(s1.completedSteps, s2.completedSteps);
  });

  test('different users have independent states', () => {
    const s1 = getOnboardingState('owner-1');
    const s2 = getOnboardingState('member-1');
    assert.equal(s1.userId, 'owner-1');
    assert.equal(s2.userId, 'member-1');
  });
});

describe('Onboarding — advanceOnboarding', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('advances from welcome to setup_agent', () => {
    const state = advanceOnboarding('owner-1');
    assert.equal(state.currentStep, 'setup_agent');
    assert.ok(state.completedSteps.includes('welcome'));
  });

  test('advances through all steps to complete', () => {
    const steps: OnboardingStep[] = ['welcome', 'setup_agent', 'add_connector', 'workstyle_doc', 'complete'];
    let state = getOnboardingState('owner-1');
    assert.equal(state.currentStep, steps[0]);

    for (let i = 0; i < steps.length - 1; i++) {
      state = advanceOnboarding('owner-1');
      assert.equal(state.currentStep, steps[i + 1]);
    }
    assert.equal(state.currentStep, 'complete');
    assert.ok(state.completedAt, 'completedAt should be set when complete');
  });

  test('stays at complete when already complete', () => {
    // Advance all the way
    for (let i = 0; i < 4; i++) advanceOnboarding('owner-1');
    const state = advanceOnboarding('owner-1'); // call once more
    assert.equal(state.currentStep, 'complete');
  });

  test('completedSteps accumulates correctly', () => {
    advanceOnboarding('owner-1'); // welcome → setup_agent
    advanceOnboarding('owner-1'); // setup_agent → add_connector
    const state = getOnboardingState('owner-1');
    assert.ok(state.completedSteps.includes('welcome'));
    assert.ok(state.completedSteps.includes('setup_agent'));
    assert.equal(state.completedSteps.length, 2);
  });
});

// ─── Agent CRUD (via DB directly — mirrors what agentsRouter does) ────────────

describe('Agent — DB CRUD via agents table', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('can insert and retrieve an agent', () => {
    const db  = openDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO agents (id, name, owner_id, system_prompt, model, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('agent-a', 'My Agent', 'owner-1', 'Be helpful', 'claude-3-5-sonnet-latest', now);

    const row = db.prepare(`SELECT * FROM agents WHERE id = ?`).get('agent-a') as {
      id: string; name: string; owner_id: string; system_prompt: string; model: string;
    } | undefined;

    assert.ok(row);
    assert.equal(row!.id, 'agent-a');
    assert.equal(row!.name, 'My Agent');
    assert.equal(row!.owner_id, 'owner-1');
    assert.equal(row!.system_prompt, 'Be helpful');
    assert.equal(row!.model, 'claude-3-5-sonnet-latest');
  });

  test('FK constraint: agent owner_id must reference an existing user', () => {
    const db  = openDb();
    const now = new Date().toISOString();
    assert.throws(() => {
      db.prepare(
        `INSERT INTO agents (id, name, owner_id, system_prompt, model, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run('agent-bad', 'Bad Agent', 'nonexistent-user', '', 'gpt-4', now);
    }, /FOREIGN KEY/);
  });

  test('can update agent name', () => {
    const db  = openDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO agents (id, name, owner_id, system_prompt, model, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('agent-b', 'Old Name', 'owner-1', '', 'claude-3-5-sonnet-latest', now);

    db.prepare(`UPDATE agents SET name = ? WHERE id = ?`).run('New Name', 'agent-b');

    const row = db.prepare(`SELECT name FROM agents WHERE id = ?`).get('agent-b') as { name: string };
    assert.equal(row.name, 'New Name');
  });

  test('can delete an agent', () => {
    const db  = openDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO agents (id, name, owner_id, system_prompt, model, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('agent-c', 'Temp', 'owner-1', '', 'claude-3-5-sonnet-latest', now);

    db.prepare(`DELETE FROM agents WHERE id = ?`).run('agent-c');

    const row = db.prepare(`SELECT id FROM agents WHERE id = ?`).get('agent-c');
    assert.equal(row, undefined);
  });

  test('list agents filtered by owner', () => {
    const db  = openDb();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO agents (id, name, owner_id, system_prompt, model, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('ag-1', 'Agent1', 'owner-1',  '', 'claude-3-5-sonnet-latest', now);
    db.prepare(`INSERT INTO agents (id, name, owner_id, system_prompt, model, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('ag-2', 'Agent2', 'owner-1',  '', 'claude-3-5-sonnet-latest', now);
    db.prepare(`INSERT INTO agents (id, name, owner_id, system_prompt, model, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('ag-3', 'Agent3', 'member-1', '', 'claude-3-5-sonnet-latest', now);

    const ownerAgents  = db.prepare(`SELECT * FROM agents WHERE owner_id = ?`).all('owner-1');
    const memberAgents = db.prepare(`SELECT * FROM agents WHERE owner_id = ?`).all('member-1');

    assert.equal(ownerAgents.length,  2);
    assert.equal(memberAgents.length, 1);
  });
});
