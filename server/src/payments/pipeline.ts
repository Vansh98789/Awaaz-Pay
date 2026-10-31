import crypto from 'node:crypto';
import type { AppDatabase as Database } from '../db/connection.js';
import { evaluatePayment } from '../rules/engine.js';
import type { Decision, PaymentRequest, ScamRiskLevel } from '../rules/types.js';
import { createPayoutBatch, getPayoutBatch } from '../paypal/index.js';
import {
  getTransactionById,
  getUserById,
  recordTransaction,
  updateTransactionStatus,
  writeAudit,
  createApproval,
  getApprovalByTransactionId,
  createNotification,
  updateApprovalStatus,
} from '../db/repository.js';
import { resolvePayee, buildPaymentContext } from './context.js';
import { config } from '../config.js';

export interface PreparePaymentParams {
  userId?: string;
  payee: string;
  amount: number;
  currency?: string;
  scamRisk?: ScamRiskLevel;
  requireGuardianApproval?: boolean;
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
  currency = 'USD',
  lang = 'hi'
): string {
  if (lang === 'en') {
    return `Sending $${amount.toFixed(2)} to ${displayName}. No extra fees apply. Please say yes to confirm.`;
  }
  return `${displayName} ko ${amount.toFixed(2)} US dollars bheje ja rahe hain. Koi extra fee nahi hai. Kripya confirm karein.`;
}

export async function preparePayment(
  db: Database,
  params: PreparePaymentParams
): Promise<PreparePaymentResult> {
  const {
    userId = 'user_meena',
    payee,
    amount,
    currency = 'USD',
    scamRisk = 'low',
    requireGuardianApproval = false,
  } = params;

  if (!payee || typeof payee !== 'string') {
    throw new Error('Payee is required');
  }
  if (!amount || typeof amount !== 'number' || amount <= 0) {
    throw new Error('Valid positive amount is required');
  }

  const user = await getUserById(db, userId);
  if (!user) {
    throw new Error('User not found');
  }

  const resolvedPayee = await resolvePayee(db, userId, payee);
  const { context } = await buildPaymentContext(
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

  const evaluatedDecision = evaluatePayment(paymentRequest, context);
  const decision: Decision = requireGuardianApproval && evaluatedDecision.action !== 'block'
    ? {
        action: 'need_guardian_approval',
        tier: 3,
        reasons: [...evaluatedDecision.reasons, 'This recipient was selected by QR or PayPal email and always requires family approval'],
        spoken_reason: 'This recipient was selected by QR or email. Your family must approve this payment.',
      }
    : evaluatedDecision;

  const status = decision.action === 'block' ? 'failed' : 'pending_confirmation';

  const tx = await recordTransaction(db, {
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

  await writeAudit(db, {
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
  alreadyPaid?: boolean;
  message?: string;
  spoken_message?: string;
  paypalStatus?: string;
  approvalToken?: string;
  approvalUrl?: string;
  error?: string;
  httpStatus?: number;
}

export async function refreshPayoutStatus(
  db: Database,
  transactionId: string
): Promise<{ status: string | null; paypalStatus?: string }> {
  const tx = await getTransactionById(db, transactionId);
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
    await updateTransactionStatus(db, tx.id, 'completed', tx.paypal_ref);
    await writeAudit(db, {
      user_id: tx.user_id,
      kind: 'payment_completed',
      payload: JSON.stringify({ transactionId: tx.id, batchId: tx.paypal_ref, amount: tx.amount }),
    });

    if (tx.counterparty_type === 'merchant') {
      const invoice = (await db.query<{ id: string; paypal_invoice_id: string; currency: string }>(
        "SELECT id, paypal_invoice_id, currency FROM invoices WHERE merchant_id = $1 AND amount = $2 AND status != 'PAID' ORDER BY id DESC LIMIT 1",
        [tx.counterparty_id, tx.amount]))[0];
      if (invoice) {
        await db.query("UPDATE invoices SET status = 'PAID' WHERE id = $1", [invoice.id]);
        if (!invoice.paypal_invoice_id.startsWith('AWZ-INV-')) {
          const { recordInvoicePayment } = await import('../paypal/invoices.js');
          await recordInvoicePayment(invoice.paypal_invoice_id, tx.amount, invoice.currency).catch(() => {});
        }
      }
    }
    return { status: 'completed', paypalStatus: status };
  }

  if (['FAILED', 'DENIED', 'CANCELED', 'CANCELLED', 'BLOCKED', 'RETURNED', 'REFUNDED', 'REVERSED'].includes(status)) {
    await updateTransactionStatus(db, tx.id, 'failed', tx.paypal_ref);
    await writeAudit(db, {
      user_id: tx.user_id,
      kind: 'payment_payout_failed',
      payload: JSON.stringify({ transactionId: tx.id, batchId: tx.paypal_ref, paypalStatus: status }),
    });
    return { status: 'failed', paypalStatus: status };
  }

  return { status: 'processing', paypalStatus: status };
}

export async function confirmPayment(
  db: Database,
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

  const tx = await getTransactionById(db, transactionId);
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
        httpStatus: 200,
      };
    }
    if (refreshedStatus.status === 'failed') {
      return {
        status: 'failed',
        transactionId: tx.id,
        error: 'PayPal marked this payout as failed.',
        spoken_message: 'PayPal did not complete this payout. Check PayPal activity before retrying.',
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
    const approval = await getApprovalByTransactionId(db, tx.id);
    if (approval?.status === 'pending' || approval?.status === 'awaiting_user_confirmation') {
      await updateApprovalStatus(db, approval.token, 'cancelled');
    }
    await updateTransactionStatus(db, tx.id, 'cancelled');
    await writeAudit(db, {
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

  // Risky or unverified payments first require the user's spoken readback confirmation.
  // PayPal's Business Sandbox balance is the only funds source; no local INR balance is reserved.
  if (tx.decision === 'need_guardian_approval' && tx.status === 'pending_confirmation') {
    const guardian = (await db.query<{ id: string }>('SELECT id FROM guardians WHERE user_id = $1 LIMIT 1', [tx.user_id]))[0];
    const guardianId = guardian?.id || 'guardian_ramesh';
    const approvalToken = crypto.randomUUID().replace(/-/g, '');
    const approvalUrl = `/approve/${approvalToken}`;
    await createApproval(db, {
      transaction_id: tx.id,
      guardian_id: guardianId,
      token: approvalToken,
      status: 'pending',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
    await updateTransactionStatus(db, tx.id, 'awaiting_approval');

    let payeeName = tx.counterparty_id;
    if (tx.counterparty_type === 'contact') {
      payeeName = (await db.query<{ display_name: string }>('SELECT display_name FROM contacts WHERE id = $1', [tx.counterparty_id]))[0]?.display_name || payeeName;
    } else if (tx.counterparty_type === 'merchant') {
      payeeName = (await db.query<{ name: string }>('SELECT name FROM merchants WHERE id = $1', [tx.counterparty_id]))[0]?.name || payeeName;
    }
    await createNotification(db, {
      user_id: tx.user_id,
      kind: 'approval_requested',
      message: `Guardian approval requested for $${tx.amount.toFixed(2)} to ${payeeName}.`,
      spoken_text: 'Approval request sent to your family member.',
    });
    await writeAudit(db, {
      user_id: tx.user_id,
      kind: 'guardian_approval_requested',
      payload: JSON.stringify({ transactionId: tx.id, amount: tx.amount, payee: payeeName }),
    });
    return {
      status: 'awaiting_approval', transactionId: tx.id, approvalToken, approvalUrl,
      message: `Your family member must approve $${tx.amount.toFixed(2)} to ${payeeName}. No PayPal payout has been sent yet.`,
      spoken_message: `Aapki family ko ${payeeName} ko ${tx.amount.toFixed(2)} US dollars bhejne ki approval request bhej di hai. Approval milne ke baad payment apne aap bhej di jayegi.`,
      httpStatus: 202,
    };
  }

  if (tx.status === 'awaiting_approval') {
    const approval = await getApprovalByTransactionId(db, tx.id);
    return {
      status: 'awaiting_approval', transactionId: tx.id,
      approvalToken: approval?.token,
      approvalUrl: approval ? `/approve/${approval.token}` : undefined,
      message: 'Waiting for family approval. No PayPal payout has been sent yet.',
      httpStatus: 202,
    };
  }

  await updateTransactionStatus(db, tx.id, 'processing');
  await writeAudit(db, {
    user_id: tx.user_id,
    kind: 'payment_confirmed_processing',
    payload: JSON.stringify({ transactionId: tx.id, amount: tx.amount }),
  });

  let recipientEmail = '';
  if (tx.counterparty_type === 'contact') {
    const c = (await db.query<{ paypal_email: string }>('SELECT paypal_email FROM contacts WHERE id = $1', [tx.counterparty_id]))[0];
    if (tx.counterparty_id === 'contact_sabzi_wala' && config.PAYPAL_SANDBOX_VEGETABLE_VENDOR_EMAIL) {
      recipientEmail = config.PAYPAL_SANDBOX_VEGETABLE_VENDOR_EMAIL;
    } else if (tx.counterparty_id === 'contact_doodh_wala' && config.PAYPAL_SANDBOX_MILK_VENDOR_EMAIL) {
      recipientEmail = config.PAYPAL_SANDBOX_MILK_VENDOR_EMAIL;
    } else if (c?.paypal_email && !c.paypal_email.endsWith('@example.com')) {
      recipientEmail = c.paypal_email;
    }
  } else if (tx.counterparty_type === 'merchant') {
    const m = (await db.query<{ paypal_email: string }>('SELECT paypal_email FROM merchants WHERE id = $1', [tx.counterparty_id]))[0];
    if (m?.paypal_email && !m.paypal_email.endsWith('@example.com')) {
      recipientEmail = m.paypal_email;
    } else if (tx.counterparty_id === 'merchant_ravi_cabs') {
      recipientEmail = config.PAYPAL_SANDBOX_MERCHANT_RECIPIENT_EMAIL
        || config.PAYPAL_SANDBOX_CAB_DRIVER_EMAIL
        || '';
    }
  } else if (tx.counterparty_id.includes('@')) {
    recipientEmail = tx.counterparty_id;
  }

  let batchId = '';
  let batchStatus = '';
  const paypalAmount = tx.amount;
  const paypalCurrency = tx.currency;

  try {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      throw new Error('No PayPal recipient email is set. Scan the recipient QR or enter their Sandbox email.');
    }
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
      await updateTransactionStatus(db, tx.id, 'processing', batchId);
      await writeAudit(db, {
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
    const insufficientFunds = /INSUFFICIENT_FUNDS|insufficient funds/i.test(errMsg);
    await updateTransactionStatus(db, tx.id, 'failed');
    await writeAudit(db, {
      user_id: tx.user_id,
      kind: 'payment_payout_failed',
      payload: JSON.stringify({ transactionId: tx.id, error: errMsg }),
    });

    return {
      status: 'failed',
      transactionId: tx.id,
      error: `Payout dispatch failed: ${errMsg}`,
      spoken_message: insufficientFunds
        ? 'The PayPal Sandbox sender account does not have enough available funds for this payout.'
        : 'PayPal did not confirm this payout. Check PayPal activity before retrying.',
      httpStatus: 500,
    };
  }

    await updateTransactionStatus(db, tx.id, 'completed', batchId);

    // If payment was made to a merchant, update invoice status in registry & PayPal
    if (tx.counterparty_type === 'merchant') {
      try {
        const inv = (await db.query<{ id: string; paypal_invoice_id: string; currency: string }>(
          "SELECT id, paypal_invoice_id, currency FROM invoices WHERE merchant_id = $1 AND amount = $2 AND status != 'PAID' ORDER BY id DESC LIMIT 1",
          [tx.counterparty_id, tx.amount]))[0];
        if (inv) {
          await db.query("UPDATE invoices SET status = 'PAID' WHERE id = $1", [inv.id]);
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

    await writeAudit(db, {
      user_id: tx.user_id,
      kind: 'payment_completed',
      payload: JSON.stringify({ transactionId: tx.id, batchId, amount: tx.amount, paypalAmount, paypalCurrency }),
    });

    return {
      status: 'completed',
      transactionId: tx.id,
      batchId,
      spoken_message: `Payment of $${tx.amount.toFixed(2)} completed successfully.`,
      httpStatus: 200,
    };
}
