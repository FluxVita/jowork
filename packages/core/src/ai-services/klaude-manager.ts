/**
 * ai-services/klaude-manager.ts — Free tier stubs
 * Premium 注入真实实现
 */

export const KLAUDE_PORT = parseInt(process.env['KLAUDE_PORT'] ?? '8899', 10);

export interface KlaudeStatus {
  status: 'stopped' | 'starting' | 'running' | 'error';
  pid: number | null;
  port: number;
  started_at: string | null;
  error: string;
  bin_exists: boolean;
  bin_mtime: string | null;
}

export interface SyncResult {
  updated: boolean;
  message: string;
}

export interface UpdateCheckResult {
  has_update: boolean;
  local_mtime: string | null;
  remote_mtime: string | null;
  message: string;
}

type GetStatusFn = () => KlaudeStatus;
type CheckUpdateFn = () => Promise<UpdateCheckResult>;
type SyncBinFn = () => Promise<SyncResult>;
type StartFn = () => Promise<void>;
type StopFn = () => void;

let _getKlaudeStatus: GetStatusFn = () => ({
  status: 'stopped', pid: null, port: KLAUDE_PORT, started_at: null,
  error: '', bin_exists: false, bin_mtime: null,
});
let _checkUpdate: CheckUpdateFn = async () => ({
  has_update: false, local_mtime: null, remote_mtime: null, message: 'Klaude 管理器需要 Premium 功能',
});
let _syncBin: SyncBinFn = async () => ({ updated: false, message: 'Klaude 管理器需要 Premium 功能' });
let _startKlaude: StartFn = async () => {};
let _stopKlaude: StopFn = () => {};

export function registerKlaudeManager(fns: {
  getKlaudeStatus: GetStatusFn;
  checkUpdate: CheckUpdateFn;
  syncBin: SyncBinFn;
  startKlaude: StartFn;
  stopKlaude: StopFn;
}) {
  _getKlaudeStatus = fns.getKlaudeStatus;
  _checkUpdate = fns.checkUpdate;
  _syncBin = fns.syncBin;
  _startKlaude = fns.startKlaude;
  _stopKlaude = fns.stopKlaude;
}

export const getKlaudeStatus: GetStatusFn = () => _getKlaudeStatus();
export const checkUpdate: CheckUpdateFn = () => _checkUpdate();
export const syncBin: SyncBinFn = () => _syncBin();
export const startKlaude: StartFn = () => _startKlaude();
export const stopKlaude: StopFn = () => _stopKlaude();
