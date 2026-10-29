# PayPal Integration Notes & Architectural Limitations

## 1. Invoice QR Code & Payer Access Limitations

### Background
In PayPal's Invoicing API (`v2/invoicing/invoices`), invoices are created by or on behalf of an invoicer (merchant). The API endpoint to retrieve full invoice details:
```http
GET /v2/invoicing/invoices/{invoice_id}
```
requires API credentials associated with the invoice creator/merchant. 

### Limitation
When an arbitrary payer (or a third-party wallet application acting on behalf of the customer) scans a PayPal invoice QR code, the customer/payer does not hold the merchant's API credentials. Attempting to call `GET /v2/invoicing/invoices/{invoice_id}` with client credentials that do not own the invoice results in an HTTP 403 / 404 access restriction.

### Solution & Source of Truth: The Local Invoices Registry
To solve this cleanly in Awaaz Pay:
1. When a merchant (e.g. **Ravi Cabs**) generates an invoice via the Awaaz Pay merchant portal or integration, the invoice record is stored in our database `invoices` table linked to the verified merchant (`merchants` table).
2. The invoice QR code encodes the PayPal invoice identifier (or official PayPal invoice link).
3. When the user scans the QR code with their camera, Awaaz Pay parses and decodes the invoice ID and looks up the merchant details, amount, currency, and verification status directly from **our local invoices registry**.
4. Our registry acts as the authoritative source of truth for the customer experience:
   - Verified merchant badge & display name ("Ravi Cabs")
   - Exact invoice amount (e.g. ₹250) which is locked and cannot be altered by voice
   - Merchant PayPal email for direct Payout settlement
5. Once the customer confirms payment, the wallet executes the payout to the merchant's PayPal account and marks the invoice as `PAID` (both locally and via PayPal's `POST /v2/invoicing/invoices/{id}/record-payment` API).

---

## 2. Voice Authentication as a Secondary Risk Signal
- WebAuthn fingerprint passkeys serve as the primary cryptographic barrier for authentication.
- Spoken challenge phrase matching provides a secondary behavioral signal to adjust risk scoring, without locking out users due to acoustic background noise or dialect variations.

## 3. Sandbox fallback when Invoicing API access is unavailable

The merchant portal now falls back to an Awaaz Pay wallet QR when PayPal rejects invoice creation or sending. The QR contains a local registry invoice ID, and the wallet resolves the merchant and fixed amount from that registry. After the user confirms, the existing Payouts flow sends a sandbox payout. This fallback is **not** a PayPal invoice or PayPal-hosted invoice checkout; the portal labels it as an Awaaz Pay wallet QR.

For the demo merchant, `PAYPAL_SANDBOX_MERCHANT_EMAIL` identifies the business account used as the PayPal invoicer. The payout recipient uses `PAYPAL_SANDBOX_MERCHANT_RECIPIENT_EMAIL` when configured, otherwise `PAYPAL_SANDBOX_RECEIVER_EMAIL`. Seed placeholder addresses are not used for these sandbox payouts. Payout API errors are returned as failures and the wallet reservation is reversed; they are never converted into synthetic successful payout IDs.

## 4. Wallet balance and PayPal balance are separate

The app's displayed wallet balance is calculated from its own `wallet_ledger`. It is not a readout of the PayPal business account's balance. PayPal is used as the sandbox payout rail; a successful sandbox batch is stored as the transaction reference. The sandbox demo maps INR ledger amounts to USD payouts using `PAYPAL_SANDBOX_INR_TO_USD_RATE` (default `0.012`, an illustrative fixed rate, not a live FX quote). Sandbox payments do not move real money.
