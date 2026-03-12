import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

// Mock electron modules that ModeManager imports from
vi.mock('crypto', () => ({
  randomUUID: () => 'test-uuid-1234-5678-9012',
}));

// ModeManager uses crypto.randomUUID but we need to test it in isolation
// since it doesn't depend on Electron
describe('ModeManager', () => {
  let settings: Map<string, string>;
  let getSetting: (key: string) => string | null;
  let setSetting: (key: string, value: string) => void;

  beforeEach(() => {
    settings = new Map();
    getSetting = (key: string) => settings.get(key) ?? null;
    setSetting = (key: string, value: string) => settings.set(key, value);
  });

  // Since ModeManager uses crypto.randomUUID from node's built-in crypto,
  // we can import and test it directly
  it('initializes with personal mode by default', async () => {
    const { ModeManager } = await import('../main/auth/mode');
    const mm = new ModeManager(getSetting, setSetting);
    const state = mm.getState();

    expect(state.mode).toBe('personal');
    expect(state.localUserId).toMatch(/^local_/);
    expect(state.cloudUserId).toBeUndefined();
    expect(state.teamId).toBeUndefined();
  });

  it('persists localUserId across instances', async () => {
    const { ModeManager } = await import('../main/auth/mode');
    const mm1 = new ModeManager(getSetting, setSetting);
    const localId = mm1.getState().localUserId;

    // Create a second instance with same settings
    const mm2 = new ModeManager(getSetting, setSetting);
    expect(mm2.getState().localUserId).toBe(localId);
  });

  it('getEffectiveUserId returns local ID when not logged in', async () => {
    const { ModeManager } = await import('../main/auth/mode');
    const mm = new ModeManager(getSetting, setSetting);
    expect(mm.getEffectiveUserId()).toMatch(/^local_/);
  });

  it('getEffectiveUserId returns cloud ID when logged in', async () => {
    const { ModeManager } = await import('../main/auth/mode');
    const mm = new ModeManager(getSetting, setSetting);
    mm.setCloudUser('cloud_user_123');
    expect(mm.getEffectiveUserId()).toBe('cloud_user_123');
  });

  it('switches to team mode', async () => {
    const { ModeManager } = await import('../main/auth/mode');
    const mm = new ModeManager(getSetting, setSetting);
    mm.setCloudUser('user_1');
    mm.switchToTeam('team_abc', 'My Team');

    const state = mm.getState();
    expect(state.mode).toBe('team');
    expect(state.teamId).toBe('team_abc');
    expect(state.teamName).toBe('My Team');
    expect(mm.isTeam()).toBe(true);
    expect(mm.isPersonal()).toBe(false);
  });

  it('throws when switching to team without login', async () => {
    const { ModeManager } = await import('../main/auth/mode');
    const mm = new ModeManager(getSetting, setSetting);
    expect(() => mm.switchToTeam('team_1', 'Team')).toThrow('Must be logged in');
  });

  it('switches back to personal', async () => {
    const { ModeManager } = await import('../main/auth/mode');
    const mm = new ModeManager(getSetting, setSetting);
    mm.setCloudUser('user_1');
    mm.switchToTeam('team_abc', 'My Team');
    mm.switchToPersonal();

    expect(mm.isPersonal()).toBe(true);
    expect(mm.getState().teamId).toBeUndefined();
  });

  it('clearing cloud user falls back to personal', async () => {
    const { ModeManager } = await import('../main/auth/mode');
    const mm = new ModeManager(getSetting, setSetting);
    mm.setCloudUser('user_1');
    mm.switchToTeam('team_abc', 'Team');
    mm.clearCloudUser();

    expect(mm.isPersonal()).toBe(true);
    expect(mm.isLoggedIn()).toBe(false);
    expect(mm.getEffectiveUserId()).toMatch(/^local_/);
  });

  it('restores mode from saved settings', async () => {
    // Pre-set settings as if they were saved before
    settings.set('app_mode', 'team');
    settings.set('local_user_id', 'local_saved');
    settings.set('cloud_user_id', 'cloud_saved');
    settings.set('team_id', 'team_saved');
    settings.set('team_name', 'Saved Team');

    const { ModeManager } = await import('../main/auth/mode');
    const mm = new ModeManager(getSetting, setSetting);
    const state = mm.getState();

    expect(state.mode).toBe('team');
    expect(state.localUserId).toBe('local_saved');
    expect(state.cloudUserId).toBe('cloud_saved');
    expect(state.teamId).toBe('team_saved');
    expect(state.teamName).toBe('Saved Team');
  });
});
