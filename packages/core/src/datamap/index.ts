// @jowork/core/datamap — public API

export { openDb, closeDb, getDb } from './db.js';
export { initSchema } from './init.js';
export { runMaintenance } from './maintenance.js';
export type { MaintenanceOptions, MaintenanceResult } from './maintenance.js';
export { migrate, backupDb, listMigrations } from './migrator.js';
export type { MigrateOptions, MigrateResult } from './migrator.js';
export {
  buildExportZip,
  buildExportJson,
  buildExportCsv,
  buildExportMarkdown,
  restoreFromZip,
  isValidTableName,
} from './export.js';
export type { ExportTableName, RestoreResult } from './export.js';
export {
  USAGE_SCHEMA,
  recordUsage,
  queryUsageSummary,
  queryDailySpend,
  upsertBudgetConfig,
  getBudgetConfig,
  checkBudgetStatus,
  estimateCost,
  recommendModel,
} from './usage.js';
export type { UsageRecord, UsageSummary, BudgetConfig, BudgetStatus, BudgetAlertLevel, TaskComplexity } from './usage.js';
