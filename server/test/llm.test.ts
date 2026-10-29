import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const SCHEMA = z.object({ intent: z.string(), amount: z.number() });
type Result = z.infer<typeof SCHEMA>;

const VALID_JSON = JSON.stringify({ intent: 'send_money', amount: 500 });

function geminiResponse(text: string) {
  return {
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text }] } }],
    }),
    text: async () => text,
  };
}

function groqResponse(text: string) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: text } }],
    }),
    text: async () => text,
  };
}

function errorResponse(status: number, body = 'error') {
  return {
    ok: false,
    status,
    statusText: body,
    json: async () => ({}),
    text: async () => body,
  };
}

async function loadService() {
  const mod = await import('../src/llm/service.js?t=' + Date.now());
  return mod.completeJson as <T>(opts: {
    systemPrompt: string;
    userText: string;
    schema: z.ZodType<T>;
    cacheKey?: string;
  }) => Promise<T>;
}

async function loadErrorClass() {
  const mod = await import('../src/llm/types.js?t=' + Date.now());
  return mod.LLMUnavailableError;
}

describe('LLM service', () => {
  beforeEach(() => {
    process.env['GEMINI_API_KEY'] = 'test-gemini-key';
    process.env['GEMINI_MODEL'] = 'gemini-test';
    process.env['GROQ_API_KEY'] = 'test-groq-key';
    process.env['GROQ_MODEL'] = 'groq-test';
    process.env['LLM_DEMO_CACHE'] = 'false';
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    delete process.env['GEMINI_API_KEY'];
    delete process.env['GEMINI_MODEL'];
    delete process.env['GROQ_API_KEY'];
    delete process.env['GROQ_MODEL'];
    delete process.env['LLM_DEMO_CACHE'];
  });

  it('returns parsed result from Gemini on first try', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(geminiResponse(VALID_JSON) as never);

    const completeJson = await loadService();
    const result = await completeJson<Result>({
      systemPrompt: 'sys',
      userText: 'user',
      schema: SCHEMA,
    });

    expect(result.intent).toBe('send_money');
    expect(result.amount).toBe(500);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('falls back to Groq when Gemini fails both attempts', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(errorResponse(429) as never)
      .mockResolvedValueOnce(errorResponse(429) as never)
      .mockResolvedValueOnce(groqResponse(VALID_JSON) as never);

    const completeJson = await loadService();
    const result = await completeJson<Result>({
      systemPrompt: 'sys',
      userText: 'user',
      schema: SCHEMA,
    });

    expect(result.intent).toBe('send_money');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('retries once on transient error before falling back', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(errorResponse(500) as never)
      .mockResolvedValueOnce(geminiResponse(VALID_JSON) as never);

    const completeJson = await loadService();
    const result = await completeJson<Result>({
      systemPrompt: 'sys',
      userText: 'user',
      schema: SCHEMA,
    });

    expect(result.intent).toBe('send_money');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries once on invalid JSON then succeeds on fallback', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(geminiResponse('not json at all') as never)
      .mockResolvedValueOnce(geminiResponse('also bad') as never)
      .mockResolvedValueOnce(groqResponse(VALID_JSON) as never);

    const completeJson = await loadService();
    const result = await completeJson<Result>({
      systemPrompt: 'sys',
      userText: 'user',
      schema: SCHEMA,
    });

    expect(result.amount).toBe(500);
  });

  it('throws LLMUnavailableError when all providers fail', async () => {
    vi.mocked(fetch).mockResolvedValue(errorResponse(500) as never);

    const completeJson = await loadService();
    const LLMUnavailableError = await loadErrorClass();

    await expect(
      completeJson<Result>({ systemPrompt: 'sys', userText: 'user', schema: SCHEMA }),
    ).rejects.toBeInstanceOf(LLMUnavailableError);
  });

  it('throws LLMUnavailableError with provider names listed', async () => {
    vi.mocked(fetch).mockResolvedValue(errorResponse(503) as never);

    const completeJson = await loadService();
    const LLMUnavailableError = await loadErrorClass();

    try {
      await completeJson<Result>({ systemPrompt: 's', userText: 'u', schema: SCHEMA });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LLMUnavailableError);
      const e = err as InstanceType<typeof LLMUnavailableError>;
      expect(e.providers).toContain('gemini');
      expect(e.providers).toContain('groq');
    }
  });

  it('returns cached result and skips fetch when demo cache is warm', async () => {
    const key = 'test-cache-key-' + Date.now();
    const { putInCache } = await import('../src/llm/cache.js');
    putInCache(key, { intent: 'check_balance', amount: 0 });

    process.env['LLM_DEMO_CACHE'] = 'true';

    const completeJson = await loadService();
    const result = await completeJson<Result>({
      systemPrompt: 'sys',
      userText: 'user',
      schema: SCHEMA,
      cacheKey: key,
    });

    expect(result.intent).toBe('check_balance');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('throws when no providers are configured', async () => {
    delete process.env['GEMINI_API_KEY'];
    delete process.env['GROQ_API_KEY'];

    const completeJson = await loadService();
    const LLMUnavailableError = await loadErrorClass();

    await expect(
      completeJson<Result>({ systemPrompt: 's', userText: 'u', schema: SCHEMA }),
    ).rejects.toBeInstanceOf(LLMUnavailableError);
  });
});
