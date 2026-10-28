# Decisions

## 2026-10-29: Voice is a secondary signal, not the lock
Decision: Fingerprint passkey is the main login; voice match only adds risk.
Why: Voice cloning and recordings can fool voiceprints.
Rejected: Voice-only login.

## 2026-10-30: Tiered payee trust instead of a flat 24-hour wait
Decision: Tier 1 trusted, Tier 2 small spot payments, Tier 3 needs family approval.
Why: A blanket wait would leave a blind user stuck at a cab.
Rejected: Block all new payees for 24 hours.

## 2026-10-31: Gemini first, Groq as fallback
Decision: Free Gemini Flash as the main LLM, Groq if it fails or rate-limits.
Why: Both are free, and a fallback keeps the demo from breaking.
Rejected: Paid APIs (cost), single provider (rate-limit risk).