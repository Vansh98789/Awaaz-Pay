import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let defaultDb: Database.Database | null = null;

export function getDefaultDbPath(): string {
  return config.DATABASE_PATH || path.resolve(__dirname, '../../data/awaaz_pay.db');
}

export function createDb(dbPath?: string): Database.Database {
  const targetPath = dbPath || getDefaultDbPath();

  if (targetPath !== ':memory:') {
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
  }

  const db = new Database(targetPath);
  db.pragma('foreign_keys = ON');

  if (targetPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }

  return db;
}

export function getDb(): Database.Database {
  if (!defaultDb) {
    defaultDb = createDb();
  }
  return defaultDb;
}

export function closeDb(): void {
  if (defaultDb) {
    defaultDb.close();
    defaultDb = null;
  }
}
