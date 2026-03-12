import { randomUUID } from 'crypto';

export type AppMode = 'personal' | 'team';

export interface ModeState {
  mode: AppMode;
  localUserId: string;
  cloudUserId?: string;
  teamId?: string;
  teamName?: string;
}

/**
 * Manages Personal/Team mode state.
 * Personal mode: no login required, local user ID auto-generated.
 * Team mode: requires cloud auth, uses cloud user ID + team context.
 */
export class ModeManager {
  private state: ModeState;
  private getSetting: (key: string) => string | null;
  private setSetting: (key: string, value: string) => void;

  constructor(
    getSetting: (key: string) => string | null,
    setSetting: (key: string, value: string) => void,
  ) {
    this.getSetting = getSetting;
    this.setSetting = setSetting;

    // Initialize from stored settings
    let localUserId = this.getSetting('local_user_id');
    if (!localUserId) {
      localUserId = `local_${randomUUID()}`;
      this.setSetting('local_user_id', localUserId);
    }

    this.state = {
      mode: (this.getSetting('app_mode') as AppMode) || 'personal',
      localUserId,
      cloudUserId: this.getSetting('cloud_user_id') || undefined,
      teamId: this.getSetting('team_id') || undefined,
      teamName: this.getSetting('team_name') || undefined,
    };
  }

  getState(): ModeState {
    return { ...this.state };
  }

  getEffectiveUserId(): string {
    return this.state.cloudUserId || this.state.localUserId;
  }

  isPersonal(): boolean {
    return this.state.mode === 'personal';
  }

  isTeam(): boolean {
    return this.state.mode === 'team';
  }

  isLoggedIn(): boolean {
    return !!this.state.cloudUserId;
  }

  switchToPersonal(): void {
    this.state.mode = 'personal';
    this.state.teamId = undefined;
    this.state.teamName = undefined;
    this.setSetting('app_mode', 'personal');
  }

  switchToTeam(teamId: string, teamName: string): void {
    if (!this.state.cloudUserId) {
      throw new Error('Must be logged in to use Team mode');
    }
    this.state.mode = 'team';
    this.state.teamId = teamId;
    this.state.teamName = teamName;
    this.setSetting('app_mode', 'team');
    this.setSetting('team_id', teamId);
    this.setSetting('team_name', teamName);
  }

  setCloudUser(userId: string): void {
    this.state.cloudUserId = userId;
    this.setSetting('cloud_user_id', userId);
  }

  clearCloudUser(): void {
    this.state.cloudUserId = undefined;
    this.setSetting('cloud_user_id', '');
    if (this.state.mode === 'team') {
      this.switchToPersonal();
    }
  }
}
