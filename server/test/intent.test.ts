import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/llm/index.js', () => ({
  completeJson: vi.fn(),
}));

import { completeJson } from '../src/llm/index.js';
import { parseIntent } from '../src/intent/parseIntent.js';

const mockCompleteJson = vi.mocked(completeJson);

function llmResult(overrides: Record<string, unknown> = {}) {
  return {
    intent: 'check_balance',
    recipient_alias: null,
    amount: null,
    language: 'hi',
    confidence: 0.95,
    scam_cues: [],
    clarifying_question: null,
    ...overrides,
  };
}

describe('parseIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns parsed send_money result from LLM', async () => {
    mockCompleteJson.mockResolvedValueOnce(
      llmResult({ intent: 'send_money', recipient_alias: 'Bhaiya', amount: 500, language: 'hinglish', confidence: 0.98 }),
    );

    const result = await parseIntent('Bhaiya ko 500 bhej do', ['Bhaiya'], 'idle');
    expect(result.intent).toBe('send_money');
    expect(result.amount).toBe(500);
    expect(result.recipient_alias).toBe('Bhaiya');
    expect(result.clarifying_question).toBeNull();
    expect(mockCompleteJson).toHaveBeenCalledOnce();
  });

  it('returns check_balance from LLM with no clarifying_question', async () => {
    mockCompleteJson.mockResolvedValueOnce(llmResult({ intent: 'check_balance', language: 'hi' }));

    const result = await parseIntent('mere paas kitna paisa hai', [], 'idle');
    expect(result.intent).toBe('check_balance');
    expect(result.clarifying_question).toBeNull();
  });

  it('returns confirm_yes in awaiting_confirmation without calling LLM', async () => {
    const result = await parseIntent('haan kar do', [], 'awaiting_confirmation');
    expect(result.intent).toBe('confirm_yes');
    expect(result.confidence).toBe(1);
    expect(mockCompleteJson).not.toHaveBeenCalled();
  });

  it('returns confirm_no in awaiting_confirmation without calling LLM', async () => {
    const result = await parseIntent('nahi ruko', [], 'awaiting_confirmation');
    expect(result.intent).toBe('confirm_no');
    expect(mockCompleteJson).not.toHaveBeenCalled();
  });

  it('falls back to regex check_balance when LLM is unavailable', async () => {
    const err = Object.assign(new Error('all providers failed'), { name: 'LLMUnavailableError' });
    mockCompleteJson.mockRejectedValueOnce(err);

    const result = await parseIntent('mera balance', [], 'idle');
    expect(result.intent).toBe('check_balance');
    expect(mockCompleteJson).toHaveBeenCalledOnce();
  });

  it('regex fallback handles send_money with amount and contact', async () => {
    const err = Object.assign(new Error('all providers failed'), { name: 'LLMUnavailableError' });
    mockCompleteJson.mockRejectedValueOnce(err);

    const result = await parseIntent('Bhaiya ko 300 bhej do', ['Bhaiya'], 'idle');
    expect(result.intent).toBe('send_money');
    expect(result.amount).toBe(300);
    expect(result.recipient_alias).toBe('Bhaiya');
  });

  it('postProcess adds clarifying_question when send_money has no amount', async () => {
    mockCompleteJson.mockResolvedValueOnce(
      llmResult({ intent: 'send_money', recipient_alias: 'Bhaiya', amount: null, language: 'hinglish', confidence: 0.9 }),
    );

    const result = await parseIntent('Bhaiya ko bhej do', ['Bhaiya'], 'idle');
    expect(result.intent).toBe('send_money');
    expect(result.clarifying_question).toMatch(/kitna/i);
  });

  it('postProcess adds clarifying_question when send_money has no recipient', async () => {
    mockCompleteJson.mockResolvedValueOnce(
      llmResult({ intent: 'send_money', recipient_alias: null, amount: 500, language: 'hinglish', confidence: 0.88 }),
    );

    const result = await parseIntent('500 bhej do', [], 'idle');
    expect(result.clarifying_question).toMatch(/kisko/i);
  });

  it('postProcess adds clarifying_question when confidence is below 0.7', async () => {
    mockCompleteJson.mockResolvedValueOnce(
      llmResult({ intent: 'unknown', confidence: 0.4, language: 'en', clarifying_question: null }),
    );

    const result = await parseIntent('xyz abc', [], 'idle');
    expect(result.clarifying_question).not.toBeNull();
  });

  it('passes scam_cues through from LLM unchanged', async () => {
    mockCompleteJson.mockResolvedValueOnce(
      llmResult({
        intent: 'send_money',
        recipient_alias: null,
        amount: 5000,
        language: 'hinglish',
        confidence: 0.72,
        scam_cues: ['urgency', 'threat_authority'],
      }),
    );

    const result = await parseIntent('police aa jayegi abhi bhej do', [], 'idle');
    expect(result.scam_cues).toContain('urgency');
    expect(result.scam_cues).toContain('threat_authority');
  });

  it('does not override clarifying_question already set by LLM', async () => {
    mockCompleteJson.mockResolvedValueOnce(
      llmResult({ intent: 'unknown', confidence: 0.2, clarifying_question: 'Could you repeat that?' }),
    );

    const result = await parseIntent('asjdfkj', [], 'idle');
    expect(result.clarifying_question).toBe('Could you repeat that?');
  });
});
