import type { IntentResult, ConversationState } from './types.js';

const YES = /\b(haan|ha|ji|theek\s*hai|kar\s*do|bilkul|yes|ok|okay|sure)\b/i;
const NO = /\b(nahi|nahin|na|mat\s*karo|ruko|cancel|band\s*karo|no|nope|stop)\b/i;
const BALANCE = /\b(balance|paisa|kitna|bacha|wallet|account|funds?)\b/i;
const HISTORY = /\b(history|transactions?|kya\s*hua|dikhao|recent|last|hafte|mahine|week|happened|past|pichle)\b/i;
const REPEAT = /\b(dobara|phir|again|repeat|wapas|dohrao)\b/i;
const CANCEL = /\b(cancel|band\s*karo|rok|stop|chhodh?o)\b/i;
const SCAM = /(?<!@[\w.-]*)\b(thaga|scam(med)?|fraud|dhoka|cheated?)\b(?!@[\w.-]*)/i;
const HELPER = /\b(helper|sahayak|guardian|add\s*karo)\b/i;
const EXPLAIN = /\b(explain|samjhao|kyun|kyon|why|kaise|kisko|kitna\s*kata)\b|\b(kyun|kyon|why|kaise)\b.{0,40}\b(payment|transaction|kata|kati|gaya)\b|\b(payment|transaction)\b.{0,40}\b(kyun|kyon|why|kata|kati)\b/i;

const HINDI_ONES: Record<string, number> = {
  ek: 1, do: 2, teen: 3, chaar: 4, char: 4, paanch: 5, panch: 5,
  chhah: 6, chhe: 6, chha: 6, saat: 7, sath: 7, aath: 8, ath: 8, nau: 9,
  das: 10, gyarah: 11, barah: 12, terah: 13, chaudah: 14, pandrah: 15,
  solah: 16, satrah: 17, atharah: 18, unnis: 19, bees: 20, bis: 20,
  tees: 30, chalis: 40, pachas: 50, sattar: 70, assi: 80, nabbe: 90,
};

function parseHindiAmount(text: string): number | null {
  const tokens = text.replace(/[^\w\s]/g, ' ').toLowerCase().split(/\s+/);
  let total = 0;
  let current = 0;
  let prev = '';

  for (const t of tokens) {
    if (t === 'do' && (prev === 'bhej' || prev === 'de' || prev === 'kar' || prev === 'karo' || prev === 'mat')) {
      prev = t;
      continue;
    }

    if (HINDI_ONES[t] !== undefined) {
      current += HINDI_ONES[t];
    } else if (t === 'sau' || t === 'hundred') {
      current = current > 0 ? current * 100 : 100;
    } else if (t === 'hazaar' || t === 'hazar' || t === 'thousand') {
      current = current > 0 ? current * 1000 : 1000;
      total += current;
      current = 0;
    } else if (t === 'lakh') {
      current = current > 0 ? current * 100000 : 100000;
      total += current;
      current = 0;
    }
    prev = t;
  }

  total += current;
  return total > 0 ? total : null;
}

function parseAmount(text: string): number | null {
  const numMatch = text.match(/\b(\d+(?:\.\d+)?)\b/);
  if (numMatch) return parseFloat(numMatch[1]);
  return parseHindiAmount(text);
}

function findContact(text: string, contacts: string[]): string | null {
  const lower = text.toLowerCase();
  for (const c of contacts) {
    if (lower.includes(c.toLowerCase())) return c;
  }

  const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
  if (emailMatch) return emailMatch[0];

  const koMatch = text.match(/(?:^|\s)([\w.-]+)\s+ko\b/i);
  if (koMatch && !['kisi', 'sab', 'unko', 'inko', 'mujhe', 'humko', 'kisko'].includes(koMatch[1].toLowerCase())) {
    return koMatch[1];
  }

  return null;
}

export function detectLang(text: string): 'hi' | 'en' | 'hinglish' {
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  if (/\b(bhej|paisa|kitna|mera|karo|hai|ko|ka|ki|nahi|haan|bhai|rupay|hazaar|sau)\b/i.test(text)) {
    return 'hinglish';
  }
  return 'en';
}

function make(
  intent: IntentResult['intent'],
  lang: IntentResult['language'],
  confidence = 0.85,
): IntentResult {
  return { intent, recipient_alias: null, amount: null, language: lang, confidence, scam_cues: [], clarifying_question: null };
}

export function quickConfirmation(text: string): 'confirm_yes' | 'confirm_no' | null {
  const t = text.toLowerCase().trim();
  if (YES.test(t)) return 'confirm_yes';
  if (NO.test(t)) return 'confirm_no';
  return null;
}

export function regexFallback(
  text: string,
  contacts: string[],
  state: ConversationState,
): IntentResult {
  const lang = detectLang(text);

  if (state === 'awaiting_confirmation' || state === 'awaiting_scam_answers') {
    const quick = quickConfirmation(text);
    if (quick) return make(quick, lang, 1);
  }

  if (BALANCE.test(text)) return make('check_balance', lang);
  if (HISTORY.test(text)) return make('read_history', lang);
  if (REPEAT.test(text)) return make('repeat', lang);
  if (SCAM.test(text)) return make('report_scam', lang);
  if (HELPER.test(text)) return make('add_helper_request', lang);
  if (EXPLAIN.test(text)) return make('explain_payment', lang);
  if (CANCEL.test(text)) return make('cancel', lang);

  const amount = parseAmount(text);
  const contact = findContact(text, contacts);

  if (amount !== null || contact !== null) {
    const r = make('send_money', lang, 0.7);
    r.amount = amount;
    r.recipient_alias = contact;
    if (!amount) {
      r.clarifying_question = lang === 'en' ? 'How much would you like to send?' : 'Kitna bhejana hai?';
    } else if (!contact) {
      r.clarifying_question = lang === 'en' ? 'Who would you like to send to?' : 'Kisko bhejana hai?';
    }
    return r;
  }

  return {
    ...make('unknown', lang, 0.3),
    clarifying_question: lang === 'en' ? 'Could you please repeat that?' : 'Kya aap dobara bol sakte hain?',
  };
}
