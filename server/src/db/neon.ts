import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

let sqlClient: NeonQueryFunction<false, false> | null = null;

export function isNeonConfigured(): boolean {
  const url = process.env['DATABASE_URL'];
  return !!(url && (url.startsWith('postgres://') || url.startsWith('postgresql://')));
}

export function getNeonSql(): NeonQueryFunction<false, false> | null {
  if (!isNeonConfigured()) return null;
  if (!sqlClient) sqlClient = neon(process.env['DATABASE_URL']!);
  return sqlClient;
}
