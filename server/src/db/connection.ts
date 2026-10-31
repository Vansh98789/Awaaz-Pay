import { getNeonSql } from './neon.js';

/** The application database is PostgreSQL on Neon. Queries are asynchronous. */
export interface AppDatabase {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<T[]>;
}

let defaultDb: AppDatabase | null = null;

export function getDb(): AppDatabase {
  if (defaultDb) return defaultDb;

  const sql = getNeonSql();
  if (!sql) {
    throw new Error('DATABASE_URL is required. Configure the Neon PostgreSQL connection before starting the server.');
  }
  defaultDb = sql as unknown as AppDatabase;
  return defaultDb;
}

export function closeDb(): void {
  // Neon HTTP queries do not keep a persistent socket pool open.
  defaultDb = null;
}
