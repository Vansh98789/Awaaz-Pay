# Payment Rules Engine Specification

Awaaz Pay enforces a deterministic rules engine where **AI never directly moves money**. The LLM only interprets spoken utterances and extracts structured intents. A pure, deterministic rules engine evaluates all transactions against trust tiers, spending caps, velocity limits, and scam signals before asking the user for verbal confirmation.

---

## 1. Summary of Rules and Default Limits

| Rule / Category | Target / Condition | Default Value | Outcome if Exceeded |
| --- | --- | --- | --- |
| **Tier 1: Per-Payment** | Active trusted contact past cooling-off | ₹5,000 | Escalates to Tier 3 (`need_guardian_approval`) |
| **Tier 1: Daily Total** | All payments today | ₹10,000 (or user custom cap) | Escalates to Tier 3 (`need_guardian_approval`) |
| **Cooling-off Period** | Newly added contact | 24 hours | Reclassified as `new_personal` (Tier 2 caps apply) |
| **Tier 2: Verified Merchant** | Spot payment (e.g. cab, shop QR) | ₹500 per transaction | Escalates to Tier 3 (`need_guardian_approval`) |
| **Tier 2: Personal Payee** | New non-merchant personal account | ₹300 per transaction | Escalates to Tier 3 (`need_guardian_approval`) |
| **Tier 2: Combined New Daily** | Total spent across all new payees today | ₹1,000 per day | Escalates to Tier 3 (`need_guardian_approval`) |
| **Tier 2: New Payees Count** | Number of unique new payees per day | 2 new payees / day | Escalates to Tier 3 (`need_guardian_approval`) |
| **Tier 2: Single Payee Cap** | Cumulative payments to one new payee | ₹500 cumulative | Escalates to Tier 3 (`need_guardian_approval`) |
| **Velocity Check** | Rapid sequence of payments | 3 payments within 10 mins | Escalates to Tier 3 (`need_guardian_approval`) |
| **Anomaly Detection** | Comparison against user history | > 3x median past amount | Escalates to Tier 3 (`need_guardian_approval`) |
| **Scam Risk: Medium** | Coercion signals / unverified pressure | `medium` | Escalates to Tier 3 (`need_guardian_approval`) |
| **Scam Risk: High** | Direct threat, OTP/KYC scam, extreme pressure | `high` | Immediate `block` |
| **Safety Blocklist** | Counterparty on shared or personal blocklist | On blocklist | Immediate `block` |
| **Spoken Confirmation** | Any approved payment (`Tier 1` or `Tier 2`) | Every transaction | `allow_with_confirmation` (spoken "haan") |

---

## 2. Trust Tiers Explained

### Tier 1: Saved Trusted Contact
- Payees saved by the user or guardian who have completed their **24-hour cooling-off** period.
- Intended for routine transactions (family allowance, trusted regular vegetable seller).
- Allows payments freely up to **₹5,000** per transaction, subject to the daily limit.
- Requires spoken readback of recipient name, amount, and audible "haan" confirmation.

### Tier 2: Small Spot Payments (Pocket-Money Cap)
- Intended for real-world spontaneous needs where waiting 24 hours is impossible (e.g., paying a cab driver or local vendor).
- Preferred for verified merchant QR codes (up to **₹500**).
- Personal accounts get a lower cap (**₹300**).
- Strictly bound by anti-salami-slicing daily limits.

### Tier 3: Guardian Approval Required
- Any transaction exceeding Tier 2 limits, or triggered by velocity/anomaly/medium-risk flags.
- Does not block the user permanently; sends an instant one-tap approval notification to the guardian (e.g., Ramesh in Dubai).

---

## 3. Anti-"Salami Slicing" Defense

Fraudsters often attempt to bypass per-transaction limits by executing multiple small transfers. Awaaz Pay mitigates this through three distinct defensive layers:

1. **Max New Payees Per Day (Default: 2):** Even if an attacker attempts ten ₹100 payments to 10 different accounts, the 3rd new recipient triggers guardian approval.
2. **Cumulative Single Payee Cap (Default: ₹500):** Multiple small payments to the same new payee aggregate until reaching ₹500, preventing repeated draining of pocket money.
3. **Aggregate Daily New Payee Budget (Default: ₹1,000):** The sum of all payments to all new payees in a calendar day cannot exceed ₹1,000.

---

## 4. Evaluation Sequence

```text
[Payment Request + Context]
          │
          ▼
   [Is Blocklisted?] ───────► YES ───► Action: BLOCK (Tier 3)
          │ NO
          ▼
   [High Scam Risk?] ───────► YES ───► Action: BLOCK (Tier 3)
          │ NO
          ▼
   [Amount <= 0?]    ───────► YES ───► Action: BLOCK (Tier 3)
          │ NO
          ▼
   [Cooling-off Active?] ───► YES ───► Reclassify as new_personal
          │ NO
          ▼
   [Check Medium Scam, Velocity, Median Anomaly, Daily Cap, Tier Caps]
          │
          ├── Any Cap Exceeded? ─────► Action: NEED_GUARDIAN_APPROVAL (Tier 3)
          │
          └── All Caps Passed?
                ├── Trusted Contact? ──► Action: ALLOW_WITH_CONFIRMATION (Tier 1)
                └── New Payee?       ──► Action: ALLOW_WITH_CONFIRMATION (Tier 2)
```
