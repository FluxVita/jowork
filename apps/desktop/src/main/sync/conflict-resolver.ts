import type { SyncRecord, SyncConflict, SyncEntity } from '@jowork/core';

type Resolution = 'server_wins' | 'client_wins';

/**
 * Conflict resolution strategy per entity type.
 *
 * - Team data → server wins (cloud is truth)
 * - Personal data → client wins (local is truth)
 * - Messages → append-only (always accept both)
 * - Settings → last-writer-wins (higher updatedAt)
 */
export class ConflictResolver {
  private mode: 'personal' | 'team';

  constructor(mode: 'personal' | 'team' = 'personal') {
    this.mode = mode;
  }

  setMode(mode: 'personal' | 'team'): void {
    this.mode = mode;
  }

  /**
   * Resolve a single conflict.
   * Returns 'server_wins' if server record should be used,
   * or 'client_wins' if local record should be kept.
   */
  resolve(
    entity: SyncEntity,
    local: SyncRecord,
    server: SyncRecord,
  ): Resolution {
    // Messages are append-only — both should coexist
    if (entity === 'message') {
      return 'server_wins'; // Accept server copy, local copy already saved
    }

    // Settings: last-writer-wins
    if (entity === 'setting') {
      return local.updatedAt >= server.updatedAt ? 'client_wins' : 'server_wins';
    }

    // Team mode: server is source of truth
    if (this.mode === 'team') {
      return 'server_wins';
    }

    // Personal mode: local is source of truth
    return 'client_wins';
  }

  /**
   * Process a batch of conflicts from a push response.
   * Returns records that need to be applied locally (server wins).
   */
  processConflicts(conflicts: SyncConflict[]): string[] {
    // Return IDs where server wins — caller should pull these records
    return conflicts
      .filter((c) => c.resolution === 'server_wins')
      .map((c) => c.id);
  }
}
