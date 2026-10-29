export class PayPalError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly path: string,
  ) {
    super(`PayPal ${status} on ${path}: ${body.slice(0, 200)}`);
    this.name = 'PayPalError';
  }
}

export interface CreateOrderInput {
  amount: number;
  currency: string;
  description?: string;
  idempotencyKey?: string;
}

export interface OrderResponse {
  id: string;
  status: string;
  links: Array<{ href: string; rel: string; method: string }>;
}

export interface CaptureResponse {
  id: string;
  status: string;
  purchase_units: Array<{
    payments: {
      captures: Array<{ id: string; status: string; amount: { value: string; currency_code: string } }>;
    };
  }>;
}

export interface PayoutItem {
  recipient_email: string;
  amount: number;
  currency: string;
  note?: string;
  sender_item_id: string;
}

export interface PayoutBatchResponse {
  batch_header: {
    payout_batch_id: string;
    batch_status: string;
  };
}

export interface InvoiceInput {
  merchant_email: string;
  recipient_email: string;
  amount: number;
  currency: string;
  note?: string;
}

export interface InvoiceResponse {
  id: string;
  status: string;
  detail: { invoice_number: string };
}

export interface WebhookVerifyInput {
  transmission_id: string;
  transmission_time: string;
  cert_url: string;
  auth_algo: string;
  transmission_sig: string;
  webhook_event: unknown;
}
