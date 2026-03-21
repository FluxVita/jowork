/** Syncable record interface — every record that participates in sync. */
export interface Syncable {
  syncVersion: number;
  updatedAt: number;
  deletedAt?: number; // soft delete timestamp
}

export type SyncEntity = 'session' | 'message' | 'memory' | 'context_doc' | 'setting' | 'scheduled_task';

export interface SyncRecord {
  id: string;
  entity: SyncEntity;
  data: Record<string, unknown>;
  syncVersion: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface SyncPushRequest {
  changes: SyncRecord[];
  deviceId: string;
  teamId?: string;
}

export interface SyncPushResponse {
  accepted: number;
  conflicts: SyncConflict[];
  serverVersion: number;
}

export interface SyncPullRequest {
  since: number; // syncVersion watermark
  entities?: SyncEntity[];
  limit?: number;
  teamId?: string;
}

export interface SyncPullResponse {
  changes: SyncRecord[];
  serverVersion: number;
  hasMore: boolean;
}

export interface SyncStatus {
  lastSyncAt: number;
  pendingCount: number;
  serverVersion: number;
  connected: boolean;
}

export interface SyncConflict {
  id: string;
  entity: SyncEntity;
  localVersion: number;
  serverVersion: number;
  resolution: 'server_wins' | 'client_wins';
}
