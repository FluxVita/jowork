import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

let _db: PostgresJsDatabase | null = null;
let _sql: Sql | null = null;

export function getDb(): PostgresJsDatabase {
  if (_db) return _db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  _sql = postgres(connectionString, { max: 10 });
  _db = drizzle(_sql);
  return _db;
}

/** Close the underlying postgres connection pool. */
export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end({ timeout: 5 });
    _sql = null;
    _db = null;
  }
}

/** Override the DB instance (for testing). */
export function setDb(db: PostgresJsDatabase | null): void {
  _db = db;
}
