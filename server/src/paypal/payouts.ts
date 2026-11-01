import { ppRequest } from './client.js';
import crypto from 'node:crypto';
import type { PayoutItem, PayoutBatchResponse } from './types.js';

export async function createPayoutBatch(
  items: PayoutItem[],
  emailSubject = 'Payment from Awaaz Pay',
  idempotencyKey: string = crypto.randomUUID(),
): Promise<PayoutBatchResponse> {
  return ppRequest<PayoutBatchResponse>('POST', '/v1/payments/payouts', {
    idempotencyKey,
    body: {
      sender_batch_header: {
        sender_batch_id: idempotencyKey,
        email_subject: emailSubject,
      },
      items: items.map((i) => ({
        recipient_type: 'EMAIL',
        receiver: i.recipient_email,
        amount: { currency: i.currency, value: i.amount.toFixed(2) },
        note: i.note,
        sender_item_id: i.sender_item_id,
      })),
    },
  });
}

export async function getPayoutBatch(batchId: string): Promise<PayoutBatchResponse> {
  return ppRequest<PayoutBatchResponse>('GET', `/v1/payments/payouts/${batchId}`);
}
