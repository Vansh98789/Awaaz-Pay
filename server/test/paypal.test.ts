import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearTokenCache,
  getAccessToken,
  createOrder,
  captureOrder,
  createPayoutBatch,
  getPayoutBatch,
  createInvoice,
  getInvoice,
  sendInvoice,
  generateInvoiceQrCode,
  recordInvoicePayment,
  verifyWebhookSignature,
  PayPalError,
} from '../src/paypal/index.js';

describe('PayPal client', () => {
  beforeEach(() => {
    clearTokenCache();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokenCache();
  });

  it('obtains access token and caches it until expiry', async () => {
    const tokenResponse = {
      access_token: 'test-token-123',
      token_type: 'Bearer',
      expires_in: 3600,
    };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => tokenResponse,
    } as Response);

    const token1 = await getAccessToken();
    expect(token1).toBe('test-token-123');
    expect(fetch).toHaveBeenCalledTimes(1);

    const token2 = await getAccessToken();
    expect(token2).toBe('test-token-123');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('re-fetches token when cache is cleared', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'first-token', expires_in: 3600 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'second-token', expires_in: 3600 }),
      } as Response);

    const t1 = await getAccessToken();
    expect(t1).toBe('first-token');

    clearTokenCache();

    const t2 = await getAccessToken();
    expect(t2).toBe('second-token');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('throws when token endpoint fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Invalid client credentials',
    } as Response);

    await expect(getAccessToken()).rejects.toThrow('PayPal auth failed 401');
  });

  it('sets PayPal-Request-Id header for idempotency', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'test-token', expires_in: 3600 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'ORDER-1', status: 'CREATED', links: [] }),
      } as Response);

    await createOrder({
      amount: 50,
      currency: 'USD',
      idempotencyKey: 'idem-key-999',
    });

    const call = vi.mocked(fetch).mock.calls[1];
    const headers = call[1]?.headers as Record<string, string>;
    expect(headers['PayPal-Request-Id']).toBe('idem-key-999');
    expect(headers['Authorization']).toBe('Bearer test-token');
  });

  it('throws PayPalError with status, body, and path on API failure', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'test-token', expires_in: 3600 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        text: async () => JSON.stringify({ name: 'UNPROCESSABLE_ENTITY' }),
      } as Response);

    try {
      await captureOrder('ORD-INVALID');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PayPalError);
      const ppErr = err as PayPalError;
      expect(ppErr.status).toBe(422);
      expect(ppErr.path).toBe('/v2/checkout/orders/ORD-INVALID/capture');
      expect(ppErr.body).toContain('UNPROCESSABLE_ENTITY');
    }
  });

  it('creates and captures an order', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'test-token', expires_in: 3600 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'ORDER-456', status: 'CREATED', links: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'ORDER-456',
          status: 'COMPLETED',
          purchase_units: [{ payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED', amount: { value: '10.00', currency_code: 'USD' } }] } }],
        }),
      } as Response);

    const order = await createOrder({ amount: 10, currency: 'USD' });
    expect(order.id).toBe('ORDER-456');

    const capture = await captureOrder(order.id);
    expect(capture.status).toBe('COMPLETED');
  });

  it('creates and checks payout batch', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'test-token', expires_in: 3600 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ batch_header: { payout_batch_id: 'BATCH-1', batch_status: 'PENDING' } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ batch_header: { payout_batch_id: 'BATCH-1', batch_status: 'SUCCESS' } }),
      } as Response);

    const batch = await createPayoutBatch([
      { recipient_email: 'test@example.com', amount: 5, currency: 'USD', sender_item_id: 'item-1' },
    ]);
    expect(batch.batch_header.payout_batch_id).toBe('BATCH-1');

    const status = await getPayoutBatch('BATCH-1');
    expect(status.batch_header.batch_status).toBe('SUCCESS');
  });

  it('manages invoice lifecycle and generates QR code', async () => {
    const rawData = 'mock-png-qr-code-data';
    const pngArrayBuffer = new TextEncoder().encode(rawData).buffer;

    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'test-token', expires_in: 3600 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'INV-123', status: 'DRAFT', detail: { invoice_number: '001' } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => pngArrayBuffer,
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: async () => ({}),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'INV-123', status: 'PAID', detail: { invoice_number: '001' } }),
      } as Response);

    const inv = await createInvoice({
      merchant_email: 'merchant@test.com',
      recipient_email: 'buyer@test.com',
      amount: 25,
      currency: 'USD',
    });
    expect(inv.id).toBe('INV-123');

    await expect(sendInvoice('INV-123')).resolves.toBeUndefined();

    const qrBase64 = await generateInvoiceQrCode('INV-123');
    expect(qrBase64).toBe(Buffer.from(rawData).toString('base64'));

    await expect(recordInvoicePayment('INV-123', 25, 'USD')).resolves.toBeUndefined();

    const fetched = await getInvoice('INV-123');
    expect(fetched.status).toBe('PAID');
  });

  it('verifies webhook signature', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'test-token', expires_in: 3600 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ verification_status: 'SUCCESS' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ verification_status: 'FAILURE' }),
      } as Response);

    const valid = await verifyWebhookSignature({
      transmission_id: 'tx-1',
      transmission_time: '2026-10-29T00:00:00Z',
      cert_url: 'https://api.sandbox.paypal.com/cert',
      auth_algo: 'SHA256withRSA',
      transmission_sig: 'sig-abc',
      webhook_event: { event_type: 'PAYMENT.CAPTURE.COMPLETED' },
    });
    expect(valid).toBe(true);

    const invalid = await verifyWebhookSignature({
      transmission_id: 'tx-2',
      transmission_time: '2026-10-29T00:00:00Z',
      cert_url: 'https://api.sandbox.paypal.com/cert',
      auth_algo: 'SHA256withRSA',
      transmission_sig: 'sig-bad',
      webhook_event: {},
    });
    expect(invalid).toBe(false);
  });
});
