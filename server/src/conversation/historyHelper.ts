import type Database from 'better-sqlite3';
import type { Transaction, LedgerEntry } from '../db/types.js';

export interface SevenDaySummaryFacts {
  moneyIn: number;
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

  // 1. Money In from ledger (positive deltas)
  const ledgerEntries = db
    .prepare<[string, string], LedgerEntry>(
      'SELECT * FROM wallet_ledger WHERE user_id = ? AND created_at >= ? AND delta > 0 ORDER BY created_at DESC'
    )
    .all(userId, sevenDaysAgo);

  const moneyIn = ledgerEntries.reduce((sum, entry) => sum + entry.delta, 0);

  // 2. Money Out from completed transactions
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
      ? `Is hafte aapne ${paymentCount} payment kiye. Kul ₹${moneyOut.toLocaleString('en-IN')} bheje gaye aur ₹${moneyIn.toLocaleString('en-IN')} aaye. Sabse bada payment ₹${largestPayment.toLocaleString('en-IN')} ka tha.`
      : `Is hafte koi payment nahi kiya gaya. Kul ₹${moneyIn.toLocaleString('en-IN')} wallet mein aaye.`;

  const enSummary =
    paymentCount > 0
      ? `In the past 7 days, you made ${paymentCount} payments. You sent ₹${moneyOut.toLocaleString('en-IN')} and received ₹${moneyIn.toLocaleString('en-IN')}. The largest payment was ₹${largestPayment.toLocaleString('en-IN')}.`
      : `No payments were sent this week. You received ₹${moneyIn.toLocaleString('en-IN')} in your wallet.`;

  return {
    moneyIn,
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

  const hi = `Aakhri payment ${payee} ko ₹${amount.toLocaleString('en-IN')} ka kiya gaya tha. Isme koi fee nahi lagi. Paisa turant pahunch gaya. Dhyan rahe, yeh payment wapas nahi ho sakta.`;
  const en = `Your most recent payment was ₹${amount.toLocaleString('en-IN')} to ${payee}. There was zero fee, and money arrived immediately. Note that once sent, it cannot be reversed.`;

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

  // Check ledger for funding from that person
  const ledgerMatch = db
    .prepare<[string, string, string], LedgerEntry>(
      'SELECT * FROM wallet_ledger WHERE user_id = ? AND delta > 0 AND (LOWER(reason) LIKE ? OR LOWER(ref) LIKE ?) ORDER BY created_at DESC LIMIT 1'
    )
    .get(userId, pattern, pattern);

  if (ledgerMatch) {
    const amount = ledgerMatch.delta;
    return {
      found: true,
      amount,
      personName,
      spokenText: {
        hi: `${personName} ne aakhri baar ₹${amount.toLocaleString('en-IN')} bheje the.`,
        en: `${personName} sent ₹${amount.toLocaleString('en-IN')} last time.`,
      },
    };
  }

  // Check transactions if money was sent or received with that counterparty
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
        hi: `${personName} ka aakhri transaction ₹${amount.toLocaleString('en-IN')} ka tha.`,
        en: `Last transaction for ${personName} was ₹${amount.toLocaleString('en-IN')}.`,
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
