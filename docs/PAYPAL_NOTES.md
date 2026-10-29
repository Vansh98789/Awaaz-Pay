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
