import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

import { z } from 'zod';
import { callGemini } from './providers/gemini.js';
import { callGroq } from './providers/groq.js';

const PING_PROMPT = 'Reply with JSON: {"ok":true}';
const schema = z.object({ ok: z.literal(true) });

async function ping(name: string, fn: () => Promise<string>) {
  const start = Date.now();
  try {
    const raw = await fn();
    const parsed = JSON.parse(raw);
    schema.parse(parsed);
    console.log(`[ping] ${name} OK (${Date.now() - start}ms)`);
  } catch (err) {
    console.error(`[ping] ${name} FAILED (${Date.now() - start}ms): ${(err as Error).message}`);
  }
}

const geminiKey = process.env['GEMINI_API_KEY'];
const geminiModel = process.env['GEMINI_MODEL'] ?? 'gemini-1.5-flash';
const groqKey = process.env['GROQ_API_KEY'];
const groqModel = process.env['GROQ_MODEL'] ?? 'llama3-8b-8192';

if (geminiKey) {
  await ping('gemini', () => callGemini(geminiKey, geminiModel, PING_PROMPT, PING_PROMPT));
} else {
  console.log('[ping] gemini skipped (no GEMINI_API_KEY)');
}

if (groqKey) {
  await ping('groq', () => callGroq(groqKey, groqModel, PING_PROMPT, PING_PROMPT));
} else {
  console.log('[ping] groq skipped (no GROQ_API_KEY)');
}
