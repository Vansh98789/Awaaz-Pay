import { ppRequest } from './client.js';
import { config } from '../config.js';
import type { WebhookVerifyInput } from './types.js';

export async function verifyWebhookSignature(input: WebhookVerifyInput): Promise<boolean> {
  const result = await ppRequest<{ verification_status: string }>(
    'POST',
    '/v1/notifications/verify-webhook-signature',
    {
      body: { ...input, webhook_id: config.PAYPAL_WEBHOOK_ID },
    },
  );
  return result.verification_status === 'SUCCESS';
}
