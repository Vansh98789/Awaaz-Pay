import type { AppDatabase as Database } from '../db/connection.js';
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

export async function getSevenDaySummary(
  db: Database,
  userId = 'user_meena'
): Promise<SevenDaySummaryFacts> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Completed PayPal payouts are the source of sent-payment history.
  const txEntries = await db.query<Transaction & { payee_name: string | null }>(
    `SELECT t.*, COALESCE(c.display_name, m.name) AS payee_name FROM transactions t
     LEFT JOIN contacts c ON t.counterparty_type = 'contact' AND c.id = t.counterparty_id
     LEFT JOIN merchants m ON t.counterparty_type = 'merchant' AND m.id = t.counterparty_id
     WHERE t.user_id = $1 AND t.created_at >= $2 AND t.status = 'completed'
     ORDER BY t.created_at DESC, t.id DESC`, [userId, sevenDaysAgo]);

  const paymentCount = txEntries.length;
  const moneyOut = txEntries.reduce((sum, tx) => sum + Number(tx.amount), 0);
  const largestPayment = txEntries.reduce((max, tx) => Math.max(max, Number(tx.amount)), 0);

  // 3. Format list of transactions with resolved payee names
  const transactions = txEntries.map((tx) => {
    const payee = tx.payee_name || tx.counterparty_id;
    return {
      id: tx.id,
      payee,
      amount: Number(tx.amount),
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

export async function explainRecentPayment(
  db: Database,
  userId = 'user_meena'
): Promise<PaymentExplanationFacts> {
  const tx = (await db.query<Transaction & { payee_name: string | null }>(
    `SELECT t.*, COALESCE(c.display_name, m.name) AS payee_name FROM transactions t
     LEFT JOIN contacts c ON t.counterparty_type = 'contact' AND c.id = t.counterparty_id
     LEFT JOIN merchants m ON t.counterparty_type = 'merchant' AND m.id = t.counterparty_id
     WHERE t.user_id = $1 AND t.status = 'completed' ORDER BY t.created_at DESC, t.id DESC LIMIT 1`, [userId]))[0];

  if (!tx) {
    return {
      found: false,
      spokenText: {
        hi: 'Aapke wallet se abhi tak koi payment nahi kiya gaya hai.',
        en: 'No completed payments found to explain.',
      },
    };
  }

  const payee = tx.payee_name || tx.counterparty_id;

  const fee = 0;
  const amount = Number(tx.amount);

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

export async function getLastSenderAmount(
  db: Database,
  userId = 'user_meena',
  personName = 'Ramesh'
): Promise<{ found: boolean; amount?: number; personName: string; spokenText: { hi: string; en: string } }> {
  const pattern = `%${personName.toLowerCase()}%`;

  // Only completed PayPal payouts are payment history; old local wallet entries
  // are not part of the PayPal account balance or transfer history.
  const txMatch = (await db.query<Transaction>(
    "SELECT * FROM transactions WHERE user_id = $1 AND status = 'completed' AND LOWER(counterparty_id) LIKE $2 ORDER BY created_at DESC LIMIT 1",
    [userId, pattern]))[0];

  if (txMatch) {
    const amount = Number(txMatch.amount);
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
