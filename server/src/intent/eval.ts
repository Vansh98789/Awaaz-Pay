import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

const { parseIntent } = await import('./parseIntent.js');

interface Fixture {
  utterance: string;
  contacts: string[];
  state: string;
  expected_intent: string;
}

const fixturesPath = path.resolve(__dirname, '../../test/intent-fixtures.json');
const fixtures: Fixture[] = JSON.parse(readFileSync(fixturesPath, 'utf8'));

const byIntent: Record<string, { total: number; correct: number }> = {};
let totalCorrect = 0;

for (const f of fixtures) {
  const result = await parseIntent(f.utterance, f.contacts, f.state);
  const expected = f.expected_intent;

  if (!byIntent[expected]) byIntent[expected] = { total: 0, correct: 0 };
  byIntent[expected].total++;

  if (result.intent === expected) {
    byIntent[expected].correct++;
    totalCorrect++;
  } else {
    console.log(`  MISS [${expected}] got [${result.intent}] — "${f.utterance}"`);
  }
}

const pct = ((totalCorrect / fixtures.length) * 100).toFixed(1);
console.log(`\nOverall: ${totalCorrect}/${fixtures.length} = ${pct}%\n`);
console.log('By intent:');
for (const [intent, s] of Object.entries(byIntent).sort()) {
  const p = ((s.correct / s.total) * 100).toFixed(0);
  console.log(`  ${intent.padEnd(22)} ${s.correct}/${s.total}  ${p}%`);
}
