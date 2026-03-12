import type { SyncRecord, SyncPushResponse, SyncPullResponse, SyncStatus } from '@jowork/core';
import { OfflineQueue } from './offline-queue';
import { ConflictResolver } from './conflict-resolver';
import type Database from 'better-sqlite3';

interface SyncManagerOpts {
  sqlite: Database.Database;
  cloudUrl: string;
  getToken: () => string | null;
  mode: 'personal' | 'team';
  deviceId: string;
  onSyncComplete?: (pulled: number, pushed: number) => void;
  onConflict?: (conflicts: number) => void;
  onOffline?: () => void;
  onOnline?: () => void;
}

/**
 * SyncManager orchestrates push/pull sync between local SQLite and cloud.
 *
 * Architecture:
 * - Push: local changes → cloud (via POST /sync/push)
 * - Pull: cloud changes → local (via POST /sync/pull)
 * - Offline: queue changes locally, flush on reconnect
 * - Fast path: WebSocket for real-time sync (handled by RemoteChannel)
 * - Fallback: 30s polling interval
 */
export class SyncManager {
  private queue: OfflineQueue;
  private resolver: ConflictResolver;
  private cloudUrl: string;
  private getToken: () => string | null;
  private deviceId: string;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastSyncVersion = 0;
  private online = true;
  private syncing = false;
  private opts: SyncManagerOpts;

  constructor(opts: SyncManagerOpts) {
    this.opts = opts;
    this.queue = new OfflineQueue(opts.sqlite);
    this.resolver = new ConflictResolver(opts.mode);
    this.cloudUrl = opts.cloudUrl;
    this.getToken = opts.getToken;
    this.deviceId = opts.deviceId;
  }

  /** Start background sync polling. */
  start(intervalMs = 30000): void {
    this.stop();
    // Initial sync
    this.sync();
    // Periodic fallback
    this.pollTimer = setInterval(() => this.sync(), intervalMs);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  setMode(mode: 'personal' | 'team'): void {
    this.resolver.setMode(mode);
  }

  /** Queue a change for sync. Pushed immediately if online, queued if offline. */
  trackChange(record: SyncRecord): void {
    this.queue.enqueue(record);
    if (this.online) {
      // Push immediately for critical operations
      this.push();
    }
  }

  /** Get current sync status. */
  getStatus(): { pendingCount: number; lastSyncVersion: number; online: boolean } {
    return {
      pendingCount: this.queue.count(),
      lastSyncVersion: this.lastSyncVersion,
      online: this.online,
    };
  }

  /** Full sync cycle: push pending → pull new. */
  async sync(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;

    try {
      const token = this.getToken();
      if (!token) {
        this.syncing = false;
        return;
      }

      // Push pending changes
      const pushed = await this.push();

      // Pull server changes
      const pulled = await this.pull();

      this.setOnline(true);
      this.opts.onSyncComplete?.(pulled, pushed);
    } catch (err) {
      const msg = String(err);
      if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED') || msg.includes('NetworkError')) {
        this.setOnline(false);
      }
    } finally {
      this.syncing = false;
    }
  }

  /** Push pending records to server. */
  private async push(): Promise<number> {
    const changes = this.queue.drain(100);
    if (changes.length === 0) return 0;

    const token = this.getToken();
    if (!token) return 0;

    const res = await fetch(`${this.cloudUrl}/sync/push`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ changes, deviceId: this.deviceId }),
    });

    if (!res.ok) {
      // Keep in queue for retry
      return 0;
    }

    const data = await res.json() as SyncPushResponse;

    // Remove successfully pushed records
    const pushedIds = changes
      .filter((c) => !data.conflicts.some((cf) => cf.id === c.id))
      .map((c) => c.id);
    this.queue.remove(pushedIds);

    // Handle conflicts
    if (data.conflicts.length > 0) {
      const serverWinIds = this.resolver.processConflicts(data.conflicts);
      // Remove conflicted records that server won
      this.queue.remove(serverWinIds);
      this.opts.onConflict?.(data.conflicts.length);
    }

    this.lastSyncVersion = Math.max(this.lastSyncVersion, data.serverVersion);
    return data.accepted;
  }

  /** Pull changes from server. */
  private async pull(): Promise<number> {
    const token = this.getToken();
    if (!token) return 0;

    const res = await fetch(`${this.cloudUrl}/sync/pull`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ since: this.lastSyncVersion }),
    });

    if (!res.ok) return 0;

    const data = await res.json() as SyncPullResponse;

    // Apply changes locally
    // TODO: write pulled records to local SQLite tables
    // For now, just update the version watermark

    this.lastSyncVersion = Math.max(this.lastSyncVersion, data.serverVersion);
    return data.changes.length;
  }

  private setOnline(online: boolean): void {
    if (this.online !== online) {
      this.online = online;
      if (online) {
        this.opts.onOnline?.();
        // Flush queue on reconnect
        this.push();
      } else {
        this.opts.onOffline?.();
      }
    }
  }
}
