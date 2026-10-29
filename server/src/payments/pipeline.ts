import type Database from 'better-sqlite3';
import { evaluatePayment } from '../rules/engine.js';
import type { Decision, PaymentRequest, ScamRiskLevel } from '../rules/types.js';
import { createPayoutBatch, getPayoutBatch } from '../paypal/index.js';
import {
  addLedgerEntry,
  getBalance,
  getTransactionById,
  getUserById,
  recordTransaction,
  updateTransactionStatus,
  writeAudit,
} from '../db/repository.js';
import { resolvePayee, buildPaymentContext } from './context.js';

export interface PreparePaymentParams {
  userId?: string;
  payee: string;
  amount: number;
  currency?: string;
  scamRisk?: ScamRiskLevel;
}

export interface PreparePaymentResult {
  transactionId: string;
  decision: Decision;
  readbackText: string;
  payee: string;
  payeeEmail: string;
  amount: number;
  status: string;
}

export function generateReadbackText(
  displayName: string,
  amount: number,
  currency = 'INR',
  lang = 'hi'
): string {
  if (lang === 'en') {
    return `Sending ₹${amount} to ${displayName}. No extra fees apply. Please say yes to confirm.`;
  }
  return `${displayName} ko ${amount} rupaye bheje ja rahe hain. Koi extra fee nahi hai. Kripya confirm karein.`;
}

export function preparePayment(
  db: Database.Database,
  params: PreparePaymentParams
): PreparePaymentResult {
  const {
    userId = 'user_meena',
    payee,
    amount,
    currency = 'INR',
    scamRisk = 'low',
  } = params;

  if (!payee || typeof payee !== 'string') {
    throw new Error('Payee is required');
  }
  if (!amount || typeof amount !== 'number' || amount <= 0) {
    throw new Error('Valid positive amount is required');
  }

  const user = getUserById(db, userId);
  if (!user) {
    throw new Error('User not found');
  }

  const resolvedPayee = resolvePayee(db, userId, payee);
  const { context } = buildPaymentContext(
    db,
    user,
    resolvedPayee,
    scamRisk as ScamRiskLevel
  );

  const paymentRequest: PaymentRequest = {
    amount,
    currency,
    payeeType: resolvedPayee.payeeType,
    payeeId: resolvedPayee.counterpartyId,
    payeeName: resolvedPayee.displayName,
  };

  const decision = evaluatePayment(paymentRequest, context);

  let status = 'pending_confirmation';
  if (decision.action === 'need_guardian_approval') {
    status = 'awaiting_approval';
  } else if (decision.action === 'block') {
    status = 'failed';
  }

  const tx = recordTransaction(db, {
    user_id: userId,
    type: 'send_money',
    amount,
    currency,
    counterparty_type: resolvedPayee.counterpartyType,
    counterparty_id: resolvedPayee.counterpartyId,
    tier: decision.tier,
    risk_score: scamRisk === 'high' ? 0.9 : scamRisk === 'medium' ? 0.5 : 0.1,
    decision: decision.action,
    status,
  });

  writeAudit(db, {
    user_id: userId,
    kind: 'payment_prepared',
    payload: JSON.stringify({
      transactionId: tx.id,
      payee: resolvedPayee.displayName,
      amount,
      decision: decision.action,
      tier: decision.tier,
    }),
  });

  const readbackText = generateReadbackText(
    resolvedPayee.displayName,
    amount,
    currency,
    user.language
  );

  return {
    transactionId: tx.id,
    decision,
    readbackText,
    payee: resolvedPayee.displayName,
    payeeEmail: resolvedPayee.email,
    amount,
    status: tx.status,
  };
}

export interface ConfirmPaymentParams {
  transactionId: string;
  userConfirmed: boolean;
}

export interface ConfirmPaymentResult {
  status: string;
  transactionId: string;
  batchId?: string;
  newBalance?: number;
  balance?: number;
  alreadyPaid?: boolean;
  message?: string;
  spoken_message?: string;
  error?: string;
  httpStatus?: number;
}

export async function confirmPayment(
  db: Database.Database,
  params: ConfirmPaymentParams
): Promise<ConfirmPaymentResult> {
  const { transactionId, userConfirmed } = params;
  if (!transactionId || typeof transactionId !== 'string') {
    return {
      status: 'error',
      transactionId: '',
      error: 'transactionId is required',
      httpStatus: 400,
    };
  }

  const tx = getTransactionById(db, transactionId);
  if (!tx) {
    return {
      status: 'error',
      transactionId,
      error: 'Transaction not found',
      httpStatus: 404,
    };
  }

  if (tx.status === 'completed') {
    return {
      status: 'completed',
      alreadyPaid: true,
      transactionId: tx.id,
      message: 'Payment already completed.',
      httpStatus: 200,
    };
  }

  if (tx.status === 'processing') {
    return {
      status: 'processing',
      transactionId: tx.id,
      message: 'Payment is currently processing.',
      httpStatus: 200,
    };
  }

  if (tx.decision !== 'allow_with_confirmation' && tx.status !== 'pending_confirmation') {
    return {
      status: 'error',
      transactionId: tx.id,
      error: `Cannot confirm transaction with decision: ${tx.decision} and status: ${tx.status}`,
      spoken_message: 'This payment cannot be confirmed directly.',
      httpStatus: 400,
    };
  }

  if (!userConfirmed) {
    updateTransactionStatus(db, tx.id, 'cancelled');
    writeAudit(db, {
      user_id: tx.user_id,
      kind: 'payment_cancelled',
      payload: JSON.stringify({ transactionId: tx.id }),
    });
    return {
      status: 'cancelled',
      transactionId: tx.id,
      message: 'Payment cancelled.',
      httpStatus: 200,
    };
  }

  const balance = getBalance(db, tx.user_id);
  if (balance < tx.amount) {
    updateTransactionStatus(db, tx.id, 'failed');
    writeAudit(db, {
      user_id: tx.user_id,
      kind: 'payment_insufficient_funds',
      payload: JSON.stringify({
        transactionId: tx.id,
        balance,
        requiredAmount: tx.amount,
      }),
    });
    return {
      status: 'failed',
      transactionId: tx.id,
      error: 'Insufficient balance',
      spoken_message: 'Aapke wallet mein paryapt balance nahi hai.',
      balance,
      httpStatus: 400,
    };
  }

  addLedgerEntry(db, {
    user_id: tx.user_id,
    delta: -tx.amount,
    reason: `Payment reservation for tx ${tx.id}`,
    ref: `res_${tx.id}`,
  });

  updateTransactionStatus(db, tx.id, 'processing');
  writeAudit(db, {
    user_id: tx.user_id,
    kind: 'payment_confirmed_processing',
    payload: JSON.stringify({ transactionId: tx.id, amount: tx.amount }),
  });

  let recipientEmail = 'receiver@sandbox.paypal.com';
  if (tx.counterparty_type === 'contact') {
    const c = db
      .prepare<[string], { paypal_email: string }>('SELECT paypal_email FROM contacts WHERE id = ?')
      .get(tx.counterparty_id);
    if (c?.paypal_email) recipientEmail = c.paypal_email;
  } else if (tx.counterparty_type === 'merchant') {
    const m = db
      .prepare<[string], { paypal_email: string }>('SELECT paypal_email FROM merchants WHERE id = ?')
      .get(tx.counterparty_id);
    if (m?.paypal_email) recipientEmail = m.paypal_email;
  } else if (tx.counterparty_id.includes('@')) {
    recipientEmail = tx.counterparty_id;
  }

  try {
    const payoutBatch = await createPayoutBatch([
      {
        recipient_email: recipientEmail,
        amount: tx.amount,
        currency: tx.currency === 'INR' ? 'USD' : tx.currency,
        note: `Payment from Awaaz Pay user`,
        sender_item_id: tx.id,
      },
    ]);

    const batchId = payoutBatch.batch_header?.payout_batch_id || `batch-${Date.now()}`;
    let batchStatus = payoutBatch.batch_header?.batch_status || 'SUCCESS';

    if (batchStatus === 'PENDING') {
      try {
        const poll = await getPayoutBatch(batchId);
        batchStatus = poll.batch_header?.batch_status || batchStatus;
      } catch {
        // Fallback
      }
    }

    if (batchStatus === 'FAILED' || batchStatus === 'DENIED' || batchStatus === 'CANCELED') {
      throw new Error(`PayPal payout batch status: ${batchStatus}`);
    }

    updateTransactionStatus(db, tx.id, 'completed', batchId);
    writeAudit(db, {
      user_id: tx.user_id,
      kind: 'payment_completed',
      payload: JSON.stringify({ transactionId: tx.id, batchId, amount: tx.amount }),
    });

    const newBalance = getBalance(db, tx.user_id);
    return {
      status: 'completed',
      transactionId: tx.id,
      batchId,
      newBalance,
      spoken_message: `Payment of ₹${tx.amount} completed successfully.`,
      httpStatus: 200,
    };
  } catch (payoutErr) {
    addLedgerEntry(db, {
      user_id: tx.user_id,
      delta: tx.amount,
      reason: `Reversal for failed tx ${tx.id}`,
      ref: `rev_${tx.id}`,
    });

    updateTransactionStatus(db, tx.id, 'failed');
    writeAudit(db, {
      user_id: tx.user_id,
      kind: 'payment_failed_reversed',
      payload: JSON.stringify({
        transactionId: tx.id,
        error: (payoutErr as Error).message,
      }),
    });

    return {
      status: 'failed',
      transactionId: tx.id,
      error: (payoutErr as Error).message,
      spoken_message: 'Payment failed and amount was refunded to your wallet.',
      httpStatus: 500,
    };
  }
}
