import { config } from '../config.js';
import { cacheKey, getFromCache, putInCache } from './cache.js';
import { callGemini } from './providers/gemini.js';
import { callGroq } from './providers/groq.js';
import { LLMUnavailableError } from './types.js';
import type { CompleteJsonOptions } from './types.js';

const DEMO_CACHE = process.env['LLM_DEMO_CACHE'] === 'true';

interface Provider {
  name: string;
  call: (system: string, user: string) => Promise<string>;
}

function buildProviders(): Provider[] {
  const providers: Provider[] = [];

  if (config.GEMINI_API_KEY && config.GEMINI_MODEL) {
    providers.push({
      name: 'gemini',
      call: (s, u) => callGemini(config.GEMINI_API_KEY!, config.GEMINI_MODEL!, s, u),
    });
  }

  if (
    config.GROQ_API_KEY &&
    config.GROQ_MODEL &&
    !config.GROQ_API_KEY.includes('your_groq_api_key')
  ) {
    providers.push({
      name: 'groq',
      call: (s, u) => callGroq(config.GROQ_API_KEY!, config.GROQ_MODEL!, s, u),
    });
  }

  return providers;
}

async function tryProvider(
  provider: Provider,
  systemPrompt: string,
  userText: string,
): Promise<string> {
  // One retry on transient errors before falling back to next provider
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await provider.call(systemPrompt, userText);
    } catch (err) {
      lastErr = err;
      if (attempt === 0) {
        console.warn(`[llm] ${provider.name} attempt 1 failed: ${(err as Error).message}, retrying`);
      }
    }
  }
  throw lastErr;
}

export async function completeJson<T>(options: CompleteJsonOptions<T>): Promise<T> {
  const { systemPrompt, userText, schema, cacheKey: explicitKey } = options;

  const key = explicitKey ?? cacheKey(systemPrompt, userText);

  if (DEMO_CACHE) {
    const cached = getFromCache(key);
    if (cached !== null) {
      console.log(`[llm] cache hit key=${key}`);
      return schema.parse(cached);
    }
  }

  const providers = buildProviders();
  if (providers.length === 0) {
    throw new LLMUnavailableError([], 'No providers configured');
  }

  const failures: string[] = [];

  for (const provider of providers) {
    const start = Date.now();
    try {
      const raw = await tryProvider(provider, systemPrompt, userText);
      const latencyMs = Date.now() - start;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`Invalid JSON from ${provider.name}: ${raw.slice(0, 120)}`);
      }

      const result = schema.parse(parsed);
      console.log(`[llm] provider=${provider.name} latency=${latencyMs}ms`);

      if (DEMO_CACHE) {
        putInCache(key, parsed);
      }

      return result;
    } catch (err) {
      const msg = (err as Error).message;
      const latencyMs = Date.now() - start;
      console.warn(`[llm] provider=${provider.name} failed latency=${latencyMs}ms reason=${msg}`);
      failures.push(`${provider.name}: ${msg}`);
    }
  }

  throw new LLMUnavailableError(
    providers.map((p) => p.name),
    failures[failures.length - 1] ?? 'unknown',
  );
}
