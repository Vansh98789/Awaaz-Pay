import { completeJson } from '../llm/index.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { quickConfirmation, regexFallback, detectLang, extractPaymentDetails } from './fallback.js';
import { IntentSchema } from './types.js';
import type { IntentResult, ConversationState } from './types.js';

function postProcess(result: IntentResult): IntentResult {
  if (result.clarifying_question) return result;

  if (result.intent === 'send_money') {
    if (!result.amount) {
      return {
        ...result,
        clarifying_question: result.language === 'en'
          ? 'How much would you like to send?'
          : 'Kitna bhejana hai?',
      };
    }
    if (!result.recipient_alias) {
      return {
        ...result,
        clarifying_question: result.language === 'en'
          ? 'Who would you like to send to?'
          : 'Kisko bhejana hai?',
      };
    }
  }

  if (result.confidence < 0.7) {
    return {
      ...result,
      clarifying_question: result.language === 'en'
        ? 'Could you please repeat that more clearly?'
        : 'Kya aap thoda clearly bol sakte hain?',
    };
  }

  return result;
}

export async function parseIntent(
  transcript: string,
  contacts: string[],
  state: ConversationState,
): Promise<IntentResult> {
  if (state === 'awaiting_confirmation' || state === 'awaiting_scam_answers') {
    const quick = quickConfirmation(transcript);
    if (quick !== null) {
      return {
        intent: quick,
        recipient_alias: null,
        amount: null,
        language: detectLang(transcript),
        confidence: 1,
        scam_cues: [],
        clarifying_question: null,
      };
    }
  }

  try {
    const result = await completeJson({
      systemPrompt: buildSystemPrompt(contacts, state),
      userText: transcript,
      schema: IntentSchema,
    });
    const details = extractPaymentDetails(transcript, contacts);
    const explicitMoneyRequest = /\b(send|pay|transfer|bhej(?:na|o|do)?|rupaye? bhej)\b/i.test(transcript);
    if (
      result.intent === 'send_money' ||
      (result.intent === 'unknown' && explicitMoneyRequest &&
        (details.amount !== null || details.recipient_alias !== null))
    ) {
      return postProcess({
        ...result,
        intent: 'send_money',
        amount: result.amount ?? details.amount,
        recipient_alias: result.recipient_alias ?? details.recipient_alias,
        confidence: Math.max(result.confidence, details.amount !== null || details.recipient_alias !== null ? 0.8 : 0),
        clarifying_question: null,
      });
    }
    return postProcess(result);
  } catch (err) {
    if ((err as Error).name === 'LLMUnavailableError') {
      return regexFallback(transcript, contacts, state);
    }
    throw err;
  }
}
