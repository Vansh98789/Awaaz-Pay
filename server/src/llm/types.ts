export class LLMUnavailableError extends Error {
  constructor(
    public readonly providers: string[],
    public readonly lastError: string,
  ) {
    super(`All LLM providers failed. Last error: ${lastError}`);
    this.name = 'LLMUnavailableError';
  }
}

export interface CompleteJsonOptions<T> {
  systemPrompt: string;
  userText: string;
  schema: import('zod').ZodType<T>;
  cacheKey?: string;
}

export interface ProviderResponse {
  text: string;
  provider: string;
  latencyMs: number;
}
