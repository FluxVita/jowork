import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

let _db: PostgresJsDatabase | null = null;

export function getDb(): PostgresJsDatabase {
  if (_db) return _db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const sql = postgres(connectionString, { max: 10 });
  _db = drizzle(sql);
  return _db;
}

/** Override the DB instance (for testing). */
export function setDb(db: PostgresJsDatabase | null): void {
  _db = db;
}
