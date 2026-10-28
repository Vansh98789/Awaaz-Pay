import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let defaultDb: Database.Database | null = null;

// Resolve default database path in server/data directory
export function getDefaultDbPath(): string {
  if (config.DATABASE_PATH) {
    return config.DATABASE_PATH;
  }
  return path.resolve(__dirname, '../../data/awaaz_pay.db');
}

// Factory function supporting both persistent disk database and in-memory test databases
export function createDb(dbPath?: string): Database.Database {
  const targetPath = dbPath || getDefaultDbPath();

  if (targetPath !== ':memory:') {
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
      // Ensure the storage directory exists before SQLite attempts to create the file
      fs.mkdirSync(parentDir, { recursive: true });
    }
  }

  const db = new Database(targetPath);

  // Enforce foreign key constraints
  db.pragma('foreign_keys = ON');

  // WAL mode improves concurrent read/write performance for file-based databases
  if (targetPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }

  return db;
}

// Global database accessor for request lifecycle
export function getDb(): Database.Database {
  if (!defaultDb) {
    defaultDb = createDb();
  }
  return defaultDb;
}

// Reset singleton instance for testing or reconnection
export function closeDb(): void {
  if (defaultDb) {
    defaultDb.close();
    defaultDb = null;
  }
}
