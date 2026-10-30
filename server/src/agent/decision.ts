import { z } from 'zod';
import { completeJson } from '../llm/index.js';

const AgentDecisionSchema = z.object({
  action: z.enum([
    'navigate',
    'set_preference',
    'check_balance',
    'activity_query',
    'repeat',
    'stop_listening',
    'delegate_conversation',
    'clarify',
  ]),
  destination: z.enum(['wallet', 'activity', 'family', 'settings', 'scanner', 'merchant']).nullable().default(null),
  preference: z.enum(['theme', 'language', 'speech_speed', 'output_mode', 'hands_free']).nullable().default(null),
  value: z.enum(['light', 'dark', 'hi-IN', 'en-IN', 'slower', 'faster', 'normal', 'voice', 'screen_reader', 'on', 'off']).nullable().default(null),
  operation: z.enum(['latest', 'next', 'previous', 'spending_summary', 'recipient_summary', 'refresh', 'read_all', 'read_last_n', 'search_transactions', 'balance', 'filter_all', 'filter_sent', 'filter_received']).nullable().default(null),
  count: z.number().int().min(1).max(20).nullable().default(null),
  exactDate: z.string().max(10).nullable().default(null),
  includeBalance: z.boolean().default(false),
  transactionDirection: z.enum(['OUT', 'IN', 'ANY']).nullable().default(null),
  timeframe: z.enum(['today', 'week', 'month', 'all']).nullable().default(null),
  recipient: z.string().max(100).nullable().default(null),
  replyText: z.string().min(1).max(420),
});

export type AgentDecision = z.output<typeof AgentDecisionSchema>;

const validValues: Record<NonNullable<AgentDecision['preference']>, string[]> = {
  theme: ['light', 'dark'],
  language: ['hi-IN', 'en-IN'],
  speech_speed: ['slower', 'faster', 'normal'],
  output_mode: ['voice', 'screen_reader'],
  hands_free: ['on', 'off'],
};

function askForClarification(language: string, request: string): AgentDecision {
  const isHindi = language === 'hi-IN';
  return {
    action: 'clarify', destination: null, preference: null, value: null,
    operation: null, count: null, exactDate: null, includeBalance: false, transactionDirection: null, timeframe: null, recipient: null,
    replyText: request || (isHindi
      ? 'Aap kya karna chahte hain? Thoda aur bataiye.'
      : 'What would you like me to do? Please tell me a little more.'),
  };
}

function inferClearDestination(text: string, screen = 'wallet'): AgentDecision['destination'] {
  const value = text.normalize('NFKC').toLowerCase().replace(/[.,!?;:।]/g, ' ').replace(/\s+/g, ' ').trim();
  if (screen !== 'wallet' && /^(?:back|go back|go home|return|return home|return to (?:the )?(?:main page|home|wallet)|back to (?:the )?(?:main page|home|wallet)|close(?: it| this page| the page| the scanner| scanner| settings| settings page)?|dismiss(?: it| this page)?|scanner band karo|settings band karo|वापस|घर जाओ)$/.test(value)) {
    return 'wallet';
  }
  const plain = value.replace(/^(?:hey|hi|hello|awaaz|awaaz pay|please|can you|could you|would you|will you|i want to|i need to|open|show|go to|take me to|bring up|the|my|app)+\s*/g, '').trim();
  const pageOnly = /^(?:the )?(?:app )?(settings?|preferences|configuration|options|scanner|camera|qr(?: code)?|activity|transactions?|transaction history|payment history|history|hisab|family|guardian|family portal|merchant portal|merchant|wallet|home)(?: page| screen| portal)?$/;
  const exact = plain.match(pageOnly)?.[0] || value.match(pageOnly)?.[0];
  const asksToNavigate = /\b(open|show|go|take|bring|change|modify|want|need|please|can|could|would|खोल|दिखा|बदल|चाहिए)\b/.test(value);
  if (!exact && !asksToNavigate) return null;

  if (/\b(settings?|preferences|configuration|options)\b/.test(value)
    && (exact || asksToNavigate)
    && !/\b(light|dark|theme|language|hindi|english|speed|slower|faster|screen reader|hands[- ]free)\b/.test(value)) return 'settings';
  if (/\b(scanner|camera|qr(?: code)?)\b/.test(value) && (exact || /\b(open|show|start|scan|need|want|please|can|could|would|खोल|स्कैन)\b/.test(value))) return 'scanner';
  if (/\b(family|guardian|family portal)\b/.test(value) && (exact || asksToNavigate)) return 'family';
  if (/\b(merchant portal|merchant)\b/.test(value) && (exact || asksToNavigate)) return 'merchant';
  if (/\b(wallet|home)\b/.test(value) && (exact || asksToNavigate)) return 'wallet';
  if (/\b(activity|transactions?|transaction history|payment history|history|hisab)\b/.test(value)
    && (exact || asksToNavigate)
    && !/\b(last|latest|recent|payment|transaction|spent|received|summary|balance|five|four|three|two|one|\d+)\b/.test(value)) return 'activity';
  return null;
}

function isExplicitScannerRequest(text: string): boolean {
  const value = text.normalize('NFKC').toLowerCase();
  return inferClearDestination(value) === 'scanner'
    && /\b(open|show|start|launch|scan|use|through|with|खोल|स्कैन)\b/.test(value);
}

function navigationDecision(destination: NonNullable<AgentDecision['destination']>, language: 'hi-IN' | 'en-IN'): AgentDecision {
  const replies: Record<NonNullable<AgentDecision['destination']>, { en: string; hi: string }> = {
    wallet: { en: 'Opening your wallet.', hi: 'Aapka wallet khol rahi hoon.' },
    activity: { en: 'Opening recent activity.', hi: 'Aapka hisaab khol rahi hoon.' },
    family: { en: 'Opening the family portal.', hi: 'Family portal khol rahi hoon.' },
    settings: { en: 'Opening settings.', hi: 'Settings khol rahi hoon.' },
    scanner: { en: 'Opening the QR scanner.', hi: 'QR scanner khol rahi hoon.' },
    merchant: { en: 'Opening the merchant portal.', hi: 'Merchant portal khol rahi hoon.' },
  };
  return {
    action: 'navigate', destination, preference: null, value: null, operation: null,
    count: null, exactDate: null, includeBalance: false, transactionDirection: null, timeframe: null, recipient: null,
    replyText: language === 'hi-IN' ? replies[destination].hi : replies[destination].en,
  };
}

function inferRecentCount(text: string): number | null {
  const value = text.normalize('NFKC').toLowerCase();
  const match = value.match(/\b(?:last|latest|recent)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:payments?|transactions?|transfers?|activity)?\b/);
  if (!match) return null;
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const count = Number(match[1]) || words[match[1]];
  return count && count >= 1 && count <= 20 ? count : null;
}

function compactName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let row = previous;
  for (let i = 1; i <= left.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= right.length; j += 1) {
      next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[right.length];
}

function resolveRecipientName(query: string, modelRecipient: string | null, context: Array<{ counterparty: string }>): string {
  const candidates = [...new Set(context.map((item) => item.counterparty).filter(Boolean))];
  if (!candidates.length) return query;
  const modelName = modelRecipient?.trim() || '';
  const exactModelMatch = candidates.find((name) => compactName(name) === compactName(modelName));
  if (exactModelMatch) return exactModelMatch;
  const namesToTry = [modelName, query].filter(Boolean);
  for (const name of namesToTry) {
    const compactQuery = compactName(name);
    const ranked = candidates
      .map((candidate) => ({ candidate, distance: editDistance(compactQuery, compactName(candidate)) }))
      .sort((a, b) => a.distance - b.distance);
    const best = ranked[0];
    if (best && compactQuery.length >= 5 && best.distance <= Math.max(1, Math.floor(compactQuery.length * 0.15))) return best.candidate;
  }
  return modelName || query;
}

function inferRecipientDateSearch(text: string): Pick<AgentDecision, 'operation' | 'recipient' | 'exactDate' | 'transactionDirection' | 'includeBalance'> | null {
  const value = text.normalize('NFKC').toLowerCase().replace(/[.,!?;:।]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!/\b(sent|send|paid|pay|transferred|transfer|bhej|bheja|bheje|diya|payment)\b/.test(value)) return null;
  const monthNumbers: Record<string, string> = {
    jan: '01', january: '01', feb: '02', february: '02', mar: '03', march: '03', apr: '04', april: '04',
    may: '05', jun: '06', june: '06', jul: '07', july: '07', aug: '08', august: '08',
    sep: '09', sept: '09', september: '09', oct: '10', october: '10', nov: '11', november: '11', dec: '12', december: '12',
  };
  const monthPattern = Object.keys(monthNumbers).sort((a, b) => b.length - a.length).join('|');
  const dateMatch = value.match(new RegExp(`\\b(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})|(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?)(?:\\s+(\\d{4}))?\\b`));
  if (!dateMatch) return null;
  const day = Number(dateMatch[1] || dateMatch[4]);
  const month = monthNumbers[dateMatch[2] || dateMatch[3]];
  const year = dateMatch[5];
  if (!day || day > 31) return null;
  const date = `${year ? `${year}-` : '--'}${month}-${String(day).padStart(2, '0')}`;
  const toIndex = value.lastIndexOf(' to ');
  if (toIndex < 0) return null;
  const dateIndex = dateMatch.index ?? value.length;
  if (toIndex >= dateIndex) return null;
  const recipient = value.slice(toIndex + 4, dateIndex).replace(/\b(?:on|at|during|in|and|also|plus)\s*$/g, '').trim();
  if (!recipient || recipient.length > 100) return null;
  return {
    operation: 'search_transactions',
    recipient,
    exactDate: date,
    transactionDirection: /\b(received|got|from)\b/.test(value) ? 'IN' : 'OUT',
    includeBalance: /\b(balance|remaining|left|still have|available)\b/.test(value),
  };
}

export async function understandAppRequest(input: {
  text: string;
  screen: string;
  language: 'hi-IN' | 'en-IN';
  preferences: Record<string, unknown>;
  conversationState: string;
  transactionContext?: Array<{ amount: number; counterparty: string; time: string; direction: 'IN' | 'OUT' }>;
}): Promise<AgentDecision> {
  const systemPrompt = `You are the voice interaction planner for Awaaz Pay, an audio-first payment app for blind and low-literacy users.

Infer what the user means from natural speech in English, Hindi, or Hinglish. Do not require exact command wording. Use the current screen and settings as context. Return one JSON object matching the required schema exactly.

Available safe actions:
- navigate: move to wallet, activity, family, settings, scanner, or merchant. Understand polite and paraphrased requests too: "could you open the scanner for me?", "Awaaz, please show the QR camera", and "I need to scan a code" all mean navigate to scanner. If a request mentions both paying and explicitly opening/scanning a QR, prioritize opening the scanner; the app will preserve the payment request and continue after a QR is scanned. When screen is scanner, "close it", "go back", "go home", or "return to the main page" mean navigate to wallet. When screen is settings, close/back/home requests also mean navigate to wallet. "I want to change settings", "can you please open settings", and the one-word follow-up "settings" all mean navigate to settings. If the user only wants to open the activity page, navigate to activity. If they ask you to tell, read, summarize, or find actual transaction information, use activity_query instead, even from another screen. On the activity page, navigation to Wallet means leave activity and return home. Family/guardian requests navigate to family.
- set_preference: on the settings page, change exactly one preference when the user clearly expresses both what they want and a valid value. theme uses light/dark; language uses hi-IN/en-IN; speech_speed uses slower/faster/normal; output_mode uses voice/screen_reader; hands_free uses on/off. If the value is unclear, use clarify and ask a short question.
- check_balance: read the PayPal balance from the wallet screen.
- activity_query: transaction questions should use the provided transactionContext, which contains only each transaction's amount, counterparty, date/time, and direction. Never invent a transaction. Match spoken nicknames, transliteration, phonetic spellings, and small spelling/spacing differences to the closest counterparty actually present in transactionContext (for example, "sabjiwala" can refer to a saved "Sabzi wala"). For a request to find transactions by a person and/or specific date (examples: "how much did I send to Sabji Wala on 28 December?", "show payments to milk vendor yesterday"), use search_transactions and set recipient and exactDate when present. exactDate must be YYYY-MM-DD when a year is spoken, or --MM-DD when only month/day is spoken. Set transactionDirection to OUT for sent, IN for received, or ANY when unspecified. Set includeBalance true when the user asks for balance too. For a specific number of recent transactions ("last five payments"), use read_last_n and set count (maximum 20); do not ask what part of activity they mean. For a general history request use read_all. Use filter_received for money received and filter_sent for outgoing payments. Set timeframe to today/week/month/all when useful. For recipient_summary, return the recipient words the user referred to, or null if unclear. Use spending_summary for totals over time; set includeBalance if requested.
- repeat: repeat the previous spoken answer.
- stop_listening: pause hands-free listening.
- delegate_conversation: use for payments, payment confirmations, scam concerns, or anything requiring the existing payment conversation. Never approve, send, cancel, or alter a payment yourself.
- clarify: ask one short follow-up when the request is ambiguous or cannot be safely mapped.

Safety rules:
- You do not call tools, APIs, or PayPal. You only select one allowlisted action for the app to execute.
- Never ask the user for a password, one-time code, card number, or secret.
- Payment-related requests must be delegated to the payment conversation, where confirmation and safety checks apply.
- If an existing payment conversation is active, delegate every utterance to that conversation so its scam questions, missing details, and confirmation state are preserved.
- If the user asks to change a setting but does not specify the option/value, ask what they want changed. If they said they want settings but not the target, help them choose from theme, language, speech speed, voice output, screen reader, or hands-free.
- If the user asks for help, explain actions available on the current screen: wallet (pay, balance, scanner, activity, settings), scanner (scan an invoice/recipient QR, retry the camera, or say “go home”, “go back”, or “close it” to return to Wallet), settings (change theme, language, speech speed, voice/screen-reader output, hands-free, or say “go home”, “go back”, or “close it” to return to Wallet), activity (latest/last N, sent/received, summaries, balance, refresh, or return to Wallet).
- Keep replyText brief, friendly, and in the user's language.
- If preferences includes knownRecipients, use those labels to resolve a spoken nickname or description to the closest exact label in recipient. If no confident match exists, ask who the user means.
- Use null for fields that do not apply. The app validates the action and values before applying them.

Current UI context: ${JSON.stringify({ screen: input.screen, language: input.language, preferences: input.preferences, conversationState: input.conversationState, transactionContext: input.transactionContext || [] })}`;

  let decision: AgentDecision;
  try {
    const rawDecision = await completeJson({
      systemPrompt,
      userText: input.text,
      schema: AgentDecisionSchema,
    });
    decision = AgentDecisionSchema.parse(rawDecision);
  } catch (error) {
    const destination = inferClearDestination(input.text, input.screen);
    if (destination) return navigationDecision(destination, input.language);
    const message = (error as Error).message;
    if ((error as Error).name === 'LLMUnavailableError') {
      throw new Error('The voice assistant is temporarily unavailable. Please try again shortly.');
    }
    throw new Error(`Could not understand the request safely: ${message}`);
  }

  if (isExplicitScannerRequest(input.text)) {
    return navigationDecision('scanner', input.language);
  }

  if (input.screen === 'activity') {
    const transactionSearch = inferRecipientDateSearch(input.text);
    if (transactionSearch) {
      const resolvedRecipient = resolveRecipientName(transactionSearch.recipient || '', decision.recipient, input.transactionContext || []);
      return {
        ...decision,
        action: 'activity_query',
        destination: null,
        ...transactionSearch,
        recipient: resolvedRecipient,
        replyText: input.language === 'hi-IN' ? 'Main aapke len-den mein yeh dhoondh rahi hoon.' : 'I’ll search your transactions for that recipient and date.',
      };
    }
  }

  const recentCount = input.screen === 'activity' ? inferRecentCount(input.text) : null;
  if (recentCount && (decision.action === 'clarify' || (decision.action === 'activity_query' && !decision.operation))) {
    return {
      ...decision,
      action: 'activity_query',
      operation: 'read_last_n',
      count: recentCount,
      replyText: input.language === 'hi-IN' ? `Aapke aakhri ${recentCount} len-den dekh rahi hoon.` : `I’ll find your last ${recentCount} transactions.`,
    };
  }

  const homeDestination = inferClearDestination(input.text, input.screen);
  if (homeDestination === 'wallet' && input.screen !== 'wallet') {
    return navigationDecision('wallet', input.language);
  }

  if (decision.action === 'clarify'
    || (decision.action === 'navigate' && !decision.destination)
    || (decision.action === 'set_preference' && (!decision.preference || !decision.value))) {
    const destination = inferClearDestination(input.text, input.screen);
    if (destination) return navigationDecision(destination, input.language);
  }

  if (decision.action === 'navigate' && !decision.destination) {
    return askForClarification(input.language, input.language === 'hi-IN'
      ? 'Aap kaunsa page kholna chahte hain: wallet, activity, family, settings, ya scanner?'
      : 'Which page should I open: wallet, activity, family, settings, or scanner?');
  }

  if (decision.action === 'set_preference') {
    if (!decision.preference || !decision.value || !validValues[decision.preference].includes(decision.value)) {
      return askForClarification(input.language, input.language === 'hi-IN'
        ? 'Kaunsi setting badalni hai, aur aap use kaise chahte hain?'
        : 'Which setting would you like to change, and what value should I use?');
    }
  }

  if (decision.action === 'activity_query' && !decision.operation) {
    return askForClarification(input.language, input.language === 'hi-IN'
      ? 'Aap kaunse len-den ke baare mein poochhna chahte hain?'
      : 'Which part of your activity would you like to hear about?');
  }

  return decision;
}
