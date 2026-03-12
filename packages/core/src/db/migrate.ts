/**
 * Core migration runner — no-op for @jowork/core.
 * Desktop app handles migrations inline via ensureTable().
 * Cloud app uses Drizzle Kit migrations.
 */
export async function runMigrations(_dbPath: string): Promise<void> {
  // No-op: desktop creates tables inline, cloud uses drizzle-kit
}
