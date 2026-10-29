import { ppRequest } from './client.js';
import type { InvoiceInput, InvoiceResponse } from './types.js';

export async function getInvoice(
  invoiceId: string,
): Promise<InvoiceResponse & { links?: Array<{ href: string; rel: string; method?: string }> }> {
  return ppRequest<InvoiceResponse & { links?: Array<{ href: string; rel: string; method?: string }> }>(
    'GET',
    `/v2/invoicing/invoices/${invoiceId}`,
  );
}

export async function createInvoice(input: InvoiceInput): Promise<InvoiceResponse> {
  return ppRequest<InvoiceResponse>('POST', '/v2/invoicing/invoices', {
    body: {
      detail: {
        currency_code: input.currency,
        payment_term: { term_type: 'NO_DUE_DATE' },
      },
      invoicer: { email_address: input.merchant_email },
      primary_recipients: [{ billing_info: { email_address: input.recipient_email } }],
      items: [
        {
          name: input.note ?? 'Payment',
          quantity: '1',
          unit_amount: { currency_code: input.currency, value: input.amount.toFixed(2) },
        },
      ],
    },
  });
}

export async function sendInvoice(invoiceId: string): Promise<void> {
  await ppRequest<void>('POST', `/v2/invoicing/invoices/${invoiceId}/send`, {
    body: { send_to_recipient: true },
  });
}

export async function generateInvoiceQrCode(invoiceId: string, size = 300): Promise<string> {
  const buf = await ppRequest<Buffer>(
    'POST',
    `/v2/invoicing/invoices/${invoiceId}/generate-qr-code`,
    {
      body: { width: size, height: size },
      responseType: 'buffer',
    },
  );
  return buf.toString('base64');
}

export async function recordInvoicePayment(
  invoiceId: string,
  amount: number,
  currency: string,
): Promise<void> {
  await ppRequest<void>('POST', `/v2/invoicing/invoices/${invoiceId}/record-payment`, {
    body: {
      method: 'OTHER',
      amount: { currency_code: currency, value: amount.toFixed(2) },
    },
  });
}
