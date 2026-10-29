import { ppRequest } from './client.js';
import type { CreateOrderInput, OrderResponse, CaptureResponse } from './types.js';

export async function createOrder(input: CreateOrderInput): Promise<OrderResponse> {
  return ppRequest<OrderResponse>('POST', '/v2/checkout/orders', {
    body: {
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: { currency_code: input.currency, value: input.amount.toFixed(2) },
          description: input.description,
        },
      ],
    },
    idempotencyKey: input.idempotencyKey,
  });
}

export async function captureOrder(orderId: string): Promise<CaptureResponse> {
  return ppRequest<CaptureResponse>('POST', `/v2/checkout/orders/${orderId}/capture`, {
    idempotencyKey: orderId,
  });
}
