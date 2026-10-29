import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

const { getAccessToken } = await import('./auth.js');
const { createOrder } = await import('./orders.js');
const { createPayoutBatch } = await import('./payouts.js');
const { createInvoice, getInvoice, sendInvoice, generateInvoiceQrCode } = await import('./invoices.js');

const MERCHANT_EMAIL = process.env['PAYPAL_SANDBOX_MERCHANT_EMAIL'] ?? '';
const RECEIVER_EMAIL = process.env['PAYPAL_SANDBOX_RECEIVER_EMAIL'] ?? '';

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    console.log(`FAIL  ${name}: ${(err as Error).message}`);
  }
}

console.log('\n=== Awaaz Pay — PayPal sandbox capability check ===\n');

await check('authentication', async () => {
  const token = await getAccessToken();
  if (!token) throw new Error('empty token');
});

let orderId = '';
await check('create order', async () => {
  const order = await createOrder({
    amount: 10,
    currency: 'USD',
    description: 'Awaaz Pay check',
    idempotencyKey: `check-order-${Date.now()}`,
  });
  if (!order.id) throw new Error('no order id');
  orderId = order.id;
  console.log(`      order_id=${orderId}  status=${order.status}`);
});

await check('create payout batch', async () => {
  if (!RECEIVER_EMAIL) throw new Error('set PAYPAL_SANDBOX_RECEIVER_EMAIL in .env');
  const batch = await createPayoutBatch([
    {
      recipient_email: RECEIVER_EMAIL,
      amount: 1,
      currency: 'USD',
      note: 'Awaaz Pay check script',
      sender_item_id: `chk-${Date.now()}`,
    },
  ]);
  if (!batch.batch_header?.payout_batch_id) throw new Error('no batch id');
  console.log(`      batch_id=${batch.batch_header.payout_batch_id}`);
});

let invoiceId = '';
await check('create invoice', async () => {
  if (!MERCHANT_EMAIL || !RECEIVER_EMAIL)
    throw new Error('set PAYPAL_SANDBOX_MERCHANT_EMAIL and PAYPAL_SANDBOX_RECEIVER_EMAIL in .env');
  const inv = await createInvoice({
    merchant_email: MERCHANT_EMAIL,
    recipient_email: RECEIVER_EMAIL,
    amount: 5,
    currency: 'USD',
    note: 'Awaaz Pay test invoice',
  });
  if (!inv.id) throw new Error('no invoice id');
  invoiceId = inv.id;
  console.log(`      invoice_id=${invoiceId}`);
});

await check('send invoice', async () => {
  if (!invoiceId) throw new Error('invoice not created - skipped');
  await sendInvoice(invoiceId);
});

await check('generate invoice QR code', async () => {
  if (!invoiceId) throw new Error('invoice not created - skipped');
  const b64 = await generateInvoiceQrCode(invoiceId);
  if (!b64 || b64.length < 100) throw new Error('QR code empty or too short');
  console.log(`      qr_code length=${b64.length} chars`);
});

await check('whether the invoice can be read by a non-owner', async () => {
  if (!invoiceId) throw new Error('invoice not created - skipped');
  const baseUrl = process.env['PAYPAL_BASE_URL'] ?? 'https://api-m.sandbox.paypal.com';
  const unauthRes = await fetch(`${baseUrl}/v2/invoicing/invoices/${invoiceId}`);
  if (unauthRes.status !== 401 && unauthRes.status !== 403) {
    throw new Error(`Expected 401/403 for unauthenticated access, got ${unauthRes.status}`);
  }
  const inv = await getInvoice(invoiceId);
  const payerLink = inv.links?.find((l) => l.rel === 'payer-view')?.href;
  if (payerLink) {
    const payerRes = await fetch(payerLink);
    if (!payerRes.ok) {
      throw new Error(`Payer view link returned HTTP ${payerRes.status}`);
    }
    console.log(`      payer-view link is publicly accessible`);
  } else {
    console.log(`      API access is restricted to authenticated owner`);
  }
});

console.log('\nDone.\n');
