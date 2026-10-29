import crypto from 'node:crypto';
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
  createApproval,
  createNotification,
  hasLedgerRef,
} from '../db/repository.js';
import { resolvePayee, buildPaymentContext } from './context.js';
import { config } from '../config.js';

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
  approvalToken?: string;
  approvalUrl?: string;
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
  let approvalToken: string | undefined;
  let approvalUrl: string | undefined;

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
    paypal_ref: null,
  });

  if (decision.action === 'need_guardian_approval') {
    const guardian = db
      .prepare<[string], { id: string }>('SELECT id FROM guardians WHERE user_id = ? LIMIT 1')
      .get(userId);
    const guardianId = guardian?.id || 'guardian_ramesh';

    approvalToken = crypto.randomUUID().replace(/-/g, '');
    approvalUrl = `/approve/${approvalToken}`;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    createApproval(db, {
      transaction_id: tx.id,
      guardian_id: guardianId,
      token: approvalToken,
      status: 'pending',
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
    });

    createNotification(db, {
      user_id: userId,
      kind: 'approval_requested',
      message: `Guardian approval requested for ₹${amount} to ${resolvedPayee.displayName}.`,
      spoken_text: `Approval request bhej di gayi hai.`,
    });
  }

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
    approvalToken,
    approvalUrl,
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
  paypalStatus?: string;
  error?: string;
  httpStatus?: number;
}

export async function refreshPayoutStatus(
  db: Database.Database,
  transactionId: string
): Promise<{ status: string | null; paypalStatus?: string }> {
  const tx = getTransactionById(db, transactionId);
  if (!tx) return { status: null };
  if (tx.status !== 'processing' || !tx.paypal_ref) return { status: tx.status };

  let batch;
  try {
    batch = await getPayoutBatch(tx.paypal_ref);
  } catch {
    return { status: tx.status };
  }

  const itemStatus = batch.items?.[0]?.transaction_status?.toUpperCase();
  const batchStatus = batch.batch_header?.batch_status?.toUpperCase();
  const status = itemStatus || batchStatus || 'PENDING';

  if (status === 'SUCCESS') {
    updateTransactionStatus(db, tx.id, 'completed', tx.paypal_ref);
    writeAudit(db, {
      user_id: tx.user_id,
      kind: 'payment_completed',
      payload: JSON.stringify({ transactionId: tx.id, batchId: tx.paypal_ref, amount: tx.amount }),
    });

    if (tx.counterparty_type === 'merchant') {
      const invoice = db.prepare<[string, number], { id: string; paypal_invoice_id: string; currency: string }>(
        "SELECT id, paypal_invoice_id, currency FROM invoices WHERE merchant_id = ? AND amount = ? AND status != 'PAID' ORDER BY rowid DESC LIMIT 1"
      ).get(tx.counterparty_id, tx.amount);
      if (invoice) {
        db.prepare("UPDATE invoices SET status = 'PAID' WHERE id = ?").run(invoice.id);
        if (!invoice.paypal_invoice_id.startsWith('AWZ-INV-')) {
          const { recordInvoicePayment } = await import('../paypal/invoices.js');
          await recordInvoicePayment(invoice.paypal_invoice_id, tx.amount, invoice.currency).catch(() => {});
        }
      }
    }
    return { status: 'completed', paypalStatus: status };
  }

  if (['FAILED', 'DENIED', 'CANCELED', 'CANCELLED', 'BLOCKED', 'RETURNED', 'REFUNDED', 'REVERSED'].includes(status)) {
    const refundRef = `ref_${tx.id}`;
    if (!hasLedgerRef(db, refundRef)) {
      addLedgerEntry(db, {
        user_id: tx.user_id,
        delta: tx.amount,
        reason: `Refund reservation for failed tx ${tx.id}`,
        ref: refundRef,
      });
    }
    updateTransactionStatus(db, tx.id, 'failed', tx.paypal_ref);
    writeAudit(db, {
      user_id: tx.user_id,
      kind: 'payment_payout_failed',
      payload: JSON.stringify({ transactionId: tx.id, batchId: tx.paypal_ref, paypalStatus: status }),
    });
    return { status: 'failed', paypalStatus: status };
  }

  return { status: 'processing', paypalStatus: status };
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
    const refreshedStatus = await refreshPayoutStatus(db, tx.id);
    if (refreshedStatus.status === 'completed') {
      return {
        status: 'completed',
        alreadyPaid: true,
        transactionId: tx.id,
        batchId: tx.paypal_ref || undefined,
        newBalance: getBalance(db, tx.user_id),
        httpStatus: 200,
      };
    }
    if (refreshedStatus.status === 'failed') {
      return {
        status: 'failed',
        transactionId: tx.id,
        error: 'PayPal marked this payout as failed.',
        spoken_message: 'Payment failed and the reserved amount was returned to your wallet.',
        httpStatus: 200,
      };
    }
    return {
      status: 'processing',
      transactionId: tx.id,
      message: 'Payment is currently processing.',
      httpStatus: 200,
    };
  }

  // Allow confirmation if the decision was allow_with_confirmation OR guardian has approved it (status 'confirmed')
  const isGuardianApproved = tx.status === 'confirmed';
  if (
    tx.decision !== 'allow_with_confirmation' &&
    tx.status !== 'pending_confirmation' &&
    !isGuardianApproved
  ) {
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

  let recipientEmail = config.PAYPAL_SANDBOX_RECEIVER_EMAIL || '';
  if (tx.counterparty_type === 'contact') {
    const c = db
      .prepare<[string], { paypal_email: string }>('SELECT paypal_email FROM contacts WHERE id = ?')
      .get(tx.counterparty_id);
    if (c?.paypal_email && !c.paypal_email.endsWith('@example.com')) {
      recipientEmail = c.paypal_email;
    }
  } else if (tx.counterparty_type === 'merchant') {
    const m = db
      .prepare<[string], { paypal_email: string }>('SELECT paypal_email FROM merchants WHERE id = ?')
      .get(tx.counterparty_id);
    if (m?.paypal_email && !m.paypal_email.endsWith('@example.com')) {
      recipientEmail = m.paypal_email;
    } else if (tx.counterparty_id === 'merchant_ravi_cabs') {
      recipientEmail = config.PAYPAL_SANDBOX_MERCHANT_RECIPIENT_EMAIL
        || config.PAYPAL_SANDBOX_RECEIVER_EMAIL
        || recipientEmail;
    }
  } else if (tx.counterparty_id.includes('@')) {
    recipientEmail = tx.counterparty_id;
  }

  let batchId = '';
  let batchStatus = '';
  const paypalAmount = tx.currency === 'INR'
    ? Math.round(tx.amount * config.PAYPAL_SANDBOX_INR_TO_USD_RATE * 100) / 100
    : tx.amount;
  const paypalCurrency = tx.currency === 'INR' ? 'USD' : tx.currency;

  try {
    if (paypalAmount <= 0) throw new Error('PayPal payout amount is below the smallest supported unit.');
    const payoutBatch = await createPayoutBatch([
      {
        recipient_email: recipientEmail,
        amount: paypalAmount,
        currency: paypalCurrency,
        note: `Payment from Awaaz Pay user`,
        sender_item_id: tx.id,
      },
    ]);

    batchId = payoutBatch.batch_header?.payout_batch_id || '';
    batchStatus = payoutBatch.items?.[0]?.transaction_status?.toUpperCase()
      || payoutBatch.batch_header?.batch_status?.toUpperCase()
      || '';
    if (!batchId || !batchStatus) {
      throw new Error('PayPal did not return a payout batch ID and status.');
    }

    if (['PENDING', 'PROCESSING', 'ACKNOWLEDGED'].includes(batchStatus)) {
      try {
        const poll = await getPayoutBatch(batchId);
        batchStatus = poll.items?.[0]?.transaction_status?.toUpperCase()
          || poll.batch_header?.batch_status?.toUpperCase()
          || batchStatus;
      } catch {
        // Fallback
      }
    }

    if (['FAILED', 'DENIED', 'CANCELED', 'CANCELLED', 'BLOCKED', 'RETURNED', 'REFUNDED', 'REVERSED'].includes(batchStatus)) {
      throw new Error(`PayPal payout batch status: ${batchStatus}`);
    }

    if (batchStatus !== 'SUCCESS') {
      updateTransactionStatus(db, tx.id, 'processing', batchId);
      writeAudit(db, {
        user_id: tx.user_id,
        kind: 'payment_payout_pending',
        payload: JSON.stringify({ transactionId: tx.id, batchId, batchStatus, paypalAmount, paypalCurrency }),
      });
      return {
        status: 'processing',
        transactionId: tx.id,
        batchId,
        paypalStatus: batchStatus,
        message: `PayPal payout status: ${batchStatus}.`,
        spoken_message: `PayPal is still processing this payment. PayPal status is ${batchStatus}. Do not retry this payment.`,
        httpStatus: 202,
      };
    }
  } catch (err) {
    const errMsg = (err as Error).message || '';
    // A failed PayPal call must never be reported as a successful transfer.
    addLedgerEntry(db, {
      user_id: tx.user_id,
      delta: tx.amount,
      reason: `Refund reservation for failed tx ${tx.id}`,
      ref: `ref_${tx.id}`,
    });

    updateTransactionStatus(db, tx.id, 'failed');
    writeAudit(db, {
      user_id: tx.user_id,
      kind: 'payment_payout_failed',
      payload: JSON.stringify({ transactionId: tx.id, error: errMsg }),
    });

    return {
      status: 'failed',
      transactionId: tx.id,
      error: `Payout dispatch failed: ${errMsg}`,
      spoken_message: 'Payment failed and amount was refunded to your wallet.',
      httpStatus: 500,
    };
  }

    updateTransactionStatus(db, tx.id, 'completed', batchId);

    // If payment was made to a merchant, update invoice status in registry & PayPal
    if (tx.counterparty_type === 'merchant') {
      try {
        const inv = db
          .prepare<[string, number], { id: string; paypal_invoice_id: string; currency: string }>(
            "SELECT id, paypal_invoice_id, currency FROM invoices WHERE merchant_id = ? AND amount = ? AND status != 'PAID' ORDER BY rowid DESC LIMIT 1"
          )
          .get(tx.counterparty_id, tx.amount);
        if (inv) {
          db.prepare("UPDATE invoices SET status = 'PAID' WHERE id = ?").run(inv.id);
          if (!inv.paypal_invoice_id.startsWith('AWZ-INV-')) {
            import('../paypal/invoices.js')
              .then(({ recordInvoicePayment }) => {
                recordInvoicePayment(inv.paypal_invoice_id, tx.amount, inv.currency).catch(() => {});
              })
              .catch(() => {});
          }
        }
      } catch {
        // Ignored
      }
    }

    writeAudit(db, {
      user_id: tx.user_id,
      kind: 'payment_completed',
      payload: JSON.stringify({ transactionId: tx.id, batchId, amount: tx.amount, paypalAmount, paypalCurrency }),
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
}
