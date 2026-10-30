import type Database from 'better-sqlite3';
import type { Transaction } from '../db/types.js';

export interface SevenDaySummaryFacts {
  moneyOut: number;
  paymentCount: number;
  largestPayment: number;
  transactions: Array<{
    id: string;
    payee: string;
    amount: number;
    time: string;
  }>;
  spokenText: {
    hi: string;
    en: string;
  };
}

export function getSevenDaySummary(
  db: Database.Database,
  userId = 'user_meena'
): SevenDaySummaryFacts {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Completed PayPal payouts are the source of sent-payment history.
  const txEntries = db
    .prepare<[string, string], Transaction>(
      "SELECT * FROM transactions WHERE user_id = ? AND created_at >= ? AND status = 'completed' ORDER BY created_at DESC, rowid DESC"
    )
    .all(userId, sevenDaysAgo);

  const paymentCount = txEntries.length;
  const moneyOut = txEntries.reduce((sum, tx) => sum + tx.amount, 0);
  const largestPayment = txEntries.reduce((max, tx) => Math.max(max, tx.amount), 0);

  // 3. Format list of transactions with resolved payee names
  const transactions = txEntries.map((tx) => {
    let payee = tx.counterparty_id;
    if (tx.counterparty_type === 'contact') {
      const c = db
        .prepare<[string], { display_name: string }>('SELECT display_name FROM contacts WHERE id = ?')
        .get(tx.counterparty_id);
      if (c) payee = c.display_name;
    } else if (tx.counterparty_type === 'merchant') {
      const m = db
        .prepare<[string], { name: string }>('SELECT name FROM merchants WHERE id = ?')
        .get(tx.counterparty_id);
      if (m) payee = m.name;
    }

    return {
      id: tx.id,
      payee,
      amount: tx.amount,
      time: tx.created_at,
    };
  });

  // 4. Deterministic spoken summaries (facts built in code first; never invent numbers)
  const hiSummary =
    paymentCount > 0
      ? `Is hafte aapne ${paymentCount} PayPal payment kiye. Kul ${moneyOut.toFixed(2)} US dollars bheje gaye. Sabse bada payment ${largestPayment.toFixed(2)} dollars ka tha.`
      : 'Is hafte koi PayPal payment complete nahi hua.';

  const enSummary =
    paymentCount > 0
      ? `In the past 7 days, you completed ${paymentCount} PayPal payouts totaling $${moneyOut.toFixed(2)}. The largest payment was $${largestPayment.toFixed(2)}.`
      : 'No PayPal payouts were completed this week.';

  return {
    moneyOut,
    paymentCount,
    largestPayment,
    transactions,
    spokenText: {
      hi: hiSummary,
      en: enSummary,
    },
  };
}

export interface PaymentExplanationFacts {
  found: boolean;
  payee?: string;
  amount?: number;
  currency?: string;
  fee?: number;
  arrival?: string;
  reversible?: boolean;
  time?: string;
  spokenText: {
    hi: string;
    en: string;
  };
}

export function explainRecentPayment(
  db: Database.Database,
  userId = 'user_meena'
): PaymentExplanationFacts {
  const tx = db
    .prepare<[string], Transaction>(
      "SELECT * FROM transactions WHERE user_id = ? AND status = 'completed' ORDER BY created_at DESC, rowid DESC LIMIT 1"
    )
    .get(userId);

  if (!tx) {
    return {
      found: false,
      spokenText: {
        hi: 'Aapke wallet se abhi tak koi payment nahi kiya gaya hai.',
        en: 'No completed payments found to explain.',
      },
    };
  }

  let payee = tx.counterparty_id;
  if (tx.counterparty_type === 'contact') {
    const c = db
      .prepare<[string], { display_name: string }>('SELECT display_name FROM contacts WHERE id = ?')
      .get(tx.counterparty_id);
    if (c) payee = c.display_name;
  } else if (tx.counterparty_type === 'merchant') {
    const m = db
      .prepare<[string], { name: string }>('SELECT name FROM merchants WHERE id = ?')
      .get(tx.counterparty_id);
    if (m) payee = m.name;
  }

  const fee = 0;
  const amount = tx.amount;

  const hi = `Aakhri payment ${payee} ko ${amount.toFixed(2)} US dollars ka kiya gaya tha. Isme koi fee nahi lagi. PayPal ne payment complete ki. Dhyan rahe, yeh payment wapas nahi ho sakta.`;
  const en = `Your most recent payment was $${amount.toFixed(2)} to ${payee}. There was zero fee, and PayPal marked it complete. Note that once sent, it may not be reversible.`;

  return {
    found: true,
    payee,
    amount,
    currency: tx.currency,
    fee,
    arrival: 'immediate',
    reversible: false,
    time: tx.created_at,
    spokenText: { hi, en },
  };
}

export function getLastSenderAmount(
  db: Database.Database,
  userId = 'user_meena',
  personName = 'Ramesh'
): { found: boolean; amount?: number; personName: string; spokenText: { hi: string; en: string } } {
  const pattern = `%${personName.toLowerCase()}%`;

  // Only completed PayPal payouts are payment history; old local wallet entries
  // are not part of the PayPal account balance or transfer history.
  const txMatch = db
    .prepare<[string, string], Transaction>(
      'SELECT * FROM transactions WHERE user_id = ? AND (LOWER(counterparty_id) LIKE ?) ORDER BY created_at DESC LIMIT 1'
    )
    .get(userId, pattern);

  if (txMatch) {
    const amount = txMatch.amount;
    return {
      found: true,
      amount,
      personName,
      spokenText: {
        hi: `${personName} ka aakhri transaction ${amount.toFixed(2)} US dollars ka tha.`,
        en: `Last transaction for ${personName} was $${amount.toFixed(2)}.`,
      },
    };
  }

  return {
    found: false,
    personName,
    spokenText: {
      hi: `${personName} ka koi pichla transaction nahi mila.`,
      en: `No prior transaction found for ${personName}.`,
    },
  };
}
