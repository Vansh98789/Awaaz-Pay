import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import QRCode from 'qrcode';
import crypto from 'node:crypto';
import {
  createInvoice,
  sendInvoice,
  generateInvoiceQrCode,
  recordInvoicePayment,
} from '../paypal/invoices.js';
import {
  createInvoiceRecord,
  getInvoiceByPaypalId,
  getInvoiceById,
  updateInvoiceStatus,
  getMerchantById,
  writeAudit,
  getUserById,
} from '../db/repository.js';
import { parseInvoiceQr } from '../payments/qrParser.js';
import { preparePayment, confirmPayment } from '../payments/pipeline.js';

export function createMerchantRouter(db: Database.Database): Router {
  const router = Router();

  // Create a shareable Awaaz Pay recipient QR with no amount attached.
  router.post('/recipient-qr', async (req: Request, res: Response) => {
    try {
      const merchantId = typeof req.body.merchantId === 'string' ? req.body.merchantId : 'merchant_ravi_cabs';
      const merchant = getMerchantById(db, merchantId);
      if (!merchant) {
        res.status(404).json({ error: 'Recipient not found' });
        return;
      }
      const paypalEmail = merchant.id === 'merchant_ravi_cabs'
        ? process.env.PAYPAL_SANDBOX_MERCHANT_RECIPIENT_EMAIL
          || process.env.PAYPAL_SANDBOX_RECEIVER_EMAIL
          || merchant.paypal_email
        : merchant.paypal_email;
      const name = typeof req.body.name === 'string' ? req.body.name.trim() : merchant.name;
      const requestedEmail = typeof req.body.paypalEmail === 'string' ? req.body.paypalEmail.trim() : '';
      const recipientEmail = requestedEmail || paypalEmail;
      if (!name || name.length > 80 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
        res.status(400).json({ error: 'Enter a recipient name and valid PayPal email' });
        return;
      }
      const payload = JSON.stringify({
        type: 'awaaz-pay-recipient',
        name,
        paypalEmail: recipientEmail,
      });
      const qrCodeImage = await QRCode.toDataURL(payload, {
        width: 320,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      });
      res.status(200).json({ success: true, name, paypalEmail: recipientEmail, qrCodeImage });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 1. Create invoice for demo merchant (e.g. Ravi Cabs)
  router.post('/invoice', async (req: Request, res: Response) => {
    try {
      const {
        merchantId = 'merchant_ravi_cabs',
        amount = 250,
        currency = 'INR',
        note = 'Ride with Ravi Cabs',
      } = req.body;

      const merchant = getMerchantById(db, merchantId);
      if (!merchant) {
        res.status(404).json({ error: `Merchant ${merchantId} not found` });
        return;
      }

      // Demo seed merchants use placeholder addresses; bind Ravi Cabs to the configured sandbox merchant.
      const merchantEmail = merchant.id === 'merchant_ravi_cabs'
        ? process.env['PAYPAL_SANDBOX_MERCHANT_EMAIL'] || merchant.paypal_email
        : merchant.paypal_email;
      const settlementEmail = merchant.id === 'merchant_ravi_cabs'
        ? process.env['PAYPAL_SANDBOX_MERCHANT_RECIPIENT_EMAIL']
          || process.env['PAYPAL_SANDBOX_RECEIVER_EMAIL']
          || merchant.paypal_email
        : merchant.paypal_email;

      let paypalInvoiceId = `AWZ-INV-${crypto.randomUUID()}`;
      let paypalInvoiceCreated = false;
      let paypalInvoiceSent = false;
      let qrCodeBase64: string | null = null;
      let qrCodeDataUrl: string = '';

      // Attempt live PayPal sandbox call
      try {
        const ppInv = await createInvoice({
          merchant_email: merchantEmail,
          recipient_email: process.env['PAYPAL_SANDBOX_RECEIVER_EMAIL'] || 'payer-sandbox@example.com',
          amount: Number(amount),
          currency,
          note,
        });

        if (ppInv?.id) {
          paypalInvoiceId = ppInv.id;
          paypalInvoiceCreated = true;
          try {
            await sendInvoice(paypalInvoiceId, false);
            paypalInvoiceSent = true;
            qrCodeBase64 = await generateInvoiceQrCode(paypalInvoiceId, 320).catch(() => null);
          } catch (sendError) {
            console.warn(`[merchant] PayPal invoice send failed: ${(sendError as Error).message}`);
          }
        }
      } catch (err) {
        // A local registry QR keeps the demo usable when PayPal Invoicing is not enabled.
        console.warn(`[merchant] Using wallet QR because PayPal invoice creation failed: ${(err as Error).message}`);
      }

      const invoiceUrl = paypalInvoiceSent && qrCodeBase64
        ? `https://www.sandbox.paypal.com/invoice/p/#${paypalInvoiceId}`
        : null;

      // If PayPal QR code is unavailable, generate a valid scannable QR data URL locally
      if (qrCodeBase64) {
        qrCodeDataUrl = `data:image/png;base64,${qrCodeBase64}`;
      } else {
        // Local registry QR payload is scanned by Awaaz Pay and settled by Payouts.
        const qrPayload = JSON.stringify({ type: 'awaaz_pay_invoice', invoiceId: paypalInvoiceId });
        qrCodeDataUrl = await QRCode.toDataURL(qrPayload, {
          width: 320,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' },
        });
      }

      // Save invoice in our local DB registry
      const invoice = createInvoiceRecord(db, {
        merchant_id: merchant.id,
        paypal_invoice_id: paypalInvoiceId,
        amount: Number(amount),
        currency,
        status: paypalInvoiceSent ? 'SENT' : 'OPEN',
      });

      const defaultUser = getUserById(db, 'user_meena');
      const auditUserId = defaultUser?.id || (db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string } | undefined)?.id;

      if (auditUserId) {
        writeAudit(db, {
          user_id: auditUserId,
          kind: 'merchant_invoice_created',
          payload: JSON.stringify({
            invoiceId: invoice.id,
            paypalInvoiceId,
            merchantId: merchant.id,
            amount: Number(amount),
          }),
        });
      }

      res.status(201).json({
        success: true,
        invoiceId: paypalInvoiceId,
        localId: invoice.id,
        merchantId: merchant.id,
        merchantName: merchant.name,
        merchantEmail,
        settlementEmail,
        verified: !!merchant.verified,
        amount: Number(amount),
        currency,
        status: invoice.status,
        paymentMode: invoiceUrl ? 'paypal_invoice' : 'awaaz_pay_payout',
        paypalInvoiceCreated,
        qrCodeUrl: invoiceUrl,
        qrCodeImage: qrCodeDataUrl,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 2. Lookup invoice details from our registry
  router.get('/invoices/:idOrPaypalId', (req: Request, res: Response) => {
    try {
      const param = Array.isArray(req.params.idOrPaypalId)
        ? req.params.idOrPaypalId[0]
        : req.params.idOrPaypalId;

      if (!param) {
        res.status(400).json({ error: 'Invoice ID is required' });
        return;
      }

      const invoice =
        getInvoiceByPaypalId(db, param) || getInvoiceById(db, param);

      if (!invoice) {
        res.status(404).json({ error: 'Invoice not found in merchant registry' });
        return;
      }

      res.status(200).json({
        success: true,
        invoiceId: invoice.paypal_invoice_id,
        paymentMode: invoice.paypal_invoice_id.startsWith('AWZ-INV-') ? 'awaaz_pay_payout' : 'paypal_invoice',
        localId: invoice.id,
        merchantId: invoice.merchant_id,
        merchantName: invoice.merchant_name,
        merchantEmail: invoice.merchant_email,
        verified: !!invoice.merchant_verified,
        amount: invoice.amount,
        currency: invoice.currency,
        status: invoice.status,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 3. Scan QR code endpoint: parses QR data and retrieves invoice from registry
  router.post('/invoices/scan', (req: Request, res: Response) => {
    try {
      const { qrData, userId = 'user_meena' } = req.body;
      if (!qrData || typeof qrData !== 'string') {
        res.status(400).json({ error: 'qrData string is required' });
        return;
      }

      const parsedInvoiceId = parseInvoiceQr(qrData);
      if (!parsedInvoiceId) {
        res.status(400).json({ error: 'No valid invoice identifier found in QR code' });
        return;
      }

      const invoice =
        getInvoiceByPaypalId(db, parsedInvoiceId) ||
        getInvoiceById(db, parsedInvoiceId);

      if (!invoice) {
        res.status(404).json({
          error: `Invoice ${parsedInvoiceId} not found in merchant registry`,
        });
        return;
      }

      const user = getUserById(db, userId);
      const isHindi = user?.language !== 'en';

      const readbackHindi = `${invoice.merchant_name}, ${invoice.amount} rupaye. Kya main bhej doon?`;
      const readbackEnglish = `${invoice.merchant_name}, ${invoice.amount} rupees. Shall I pay?`;

      res.status(200).json({
        success: true,
        invoiceId: invoice.paypal_invoice_id,
        paymentMode: invoice.paypal_invoice_id.startsWith('AWZ-INV-') ? 'awaaz_pay_payout' : 'paypal_invoice',
        localId: invoice.id,
        merchantId: invoice.merchant_id,
        merchantName: invoice.merchant_name,
        merchantEmail: invoice.merchant_email,
        verified: !!invoice.merchant_verified,
        amount: invoice.amount,
        currency: invoice.currency,
        status: invoice.status,
        spokenReadback: isHindi ? readbackHindi : readbackEnglish,
        readback: {
          hi: readbackHindi,
          en: readbackEnglish,
        },
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 4. Pay invoice via Tier 2 merchant pipeline
  router.post('/invoices/pay', async (req: Request, res: Response) => {
    try {
      const { invoiceId, userId = 'user_meena', confirm = false } = req.body;
      if (!invoiceId) {
        res.status(400).json({ error: 'invoiceId is required' });
        return;
      }

      const invoice =
        getInvoiceByPaypalId(db, invoiceId) || getInvoiceById(db, invoiceId);

      if (!invoice) {
        res.status(404).json({ error: 'Invoice not found in merchant registry' });
        return;
      }

      if (invoice.status === 'PAID') {
        res.status(400).json({ error: 'This invoice has already been paid' });
        return;
      }

      // The amount is locked to the invoice amount
      const prep = preparePayment(db, {
        userId,
        payee: invoice.merchant_name,
        amount: invoice.amount,
        currency: invoice.currency,
        scamRisk: 'low',
      });

      if (prep.decision.action === 'block') {
        res.status(403).json({
          success: false,
          status: 'blocked',
          reasons: prep.decision.reasons,
          spokenReason: prep.decision.spoken_reason,
        });
        return;
      }

      if (prep.decision.action === 'need_guardian_approval') {
        res.status(200).json({
          success: false,
          status: 'need_guardian_approval',
          transactionId: prep.transactionId,
          approvalToken: prep.approvalToken,
          approvalUrl: prep.approvalUrl,
          message: 'Payment requires guardian approval',
        });
        return;
      }

      // If confirmation flag is true, execute confirmation
      if (confirm) {
        const result = await confirmPayment(db, {
          transactionId: prep.transactionId,
          userConfirmed: true,
        });

        if (result.status === 'completed') {
          // Update invoice status to PAID in local registry
          updateInvoiceStatus(db, invoice.paypal_invoice_id, 'PAID');

          // Record payment on PayPal if possible
          if (!invoice.paypal_invoice_id.startsWith('AWZ-INV-')) {
            await recordInvoicePayment(
              invoice.paypal_invoice_id,
              invoice.amount,
              invoice.currency
            ).catch(() => {});
          }

          res.status(200).json({
            success: true,
            status: 'completed',
            transactionId: prep.transactionId,
            newBalance: result.newBalance,
            spokenMessage: result.spoken_message,
            paymentProvider: 'paypal_sandbox',
            paypalBatchId: result.batchId,
          });
          return;
        }

        if (result.status === 'processing') {
          res.status(202).json({
            success: true,
            status: 'processing',
            transactionId: result.transactionId,
            batchId: result.batchId,
            message: result.spoken_message,
            paymentProvider: 'paypal_sandbox',
          });
          return;
        }

        res.status(400).json({
          success: false,
          status: result.status,
          error: result.error,
        });
        return;
      }

      res.status(200).json({
        success: true,
        status: 'awaiting_confirmation',
        transactionId: prep.transactionId,
        merchantName: invoice.merchant_name,
        amount: invoice.amount,
        readbackText: prep.readbackText,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
