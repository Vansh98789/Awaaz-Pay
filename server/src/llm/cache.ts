import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const CACHE_FILE = path.resolve(process.cwd(), 'llm_demo_cache.json');

function load(): Record<string, unknown> {
  if (!fs.existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save(data: Record<string, unknown>): void {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

export function cacheKey(systemPrompt: string, userText: string): string {
  return crypto
    .createHash('sha256')
    .update(systemPrompt + '\x00' + userText)
    .digest('hex')
    .slice(0, 16);
}

export function getFromCache(key: string): unknown | null {
  const data = load();
  return data[key] ?? null;
}

export function putInCache(key: string, value: unknown): void {
  const data = load();
  data[key] = value;
  save(data);
}
