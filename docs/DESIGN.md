# Awaaz Pay: Complete Build Guide

*PayPal AI Hackathon · working name “Awaaz Pay” (change freely) · Submission deadline: Nov 12, 2026, 12:00 pm PT (about 1:30 am IST on Nov 13). Plan to submit on Nov 11 night IST.*

## 1. The idea in one minute

**Awaaz Pay is a voice-first wallet for people who cannot read or see a screen.** They speak in Hindi, Hinglish or English. The app understands, explains every payment in plain words, protects them from scams, and moves real money through the PayPal sandbox.

**Pitch line:** “Meena can’t read. Her son in Dubai sends her money. She hears it, understands it, pays the vegetable seller by voice, and when a scammer calls, the app stops her.”

**Three things that make it different from generic “talk to your wallet” projects:**

1. **Built around one specific person and language** (low-literacy or visually impaired user in India, Hindi and Hinglish).
2. **Safety is the core feature**, not an add-on: trust tiers, spending caps, spoken readback, scam interview, family approval.
3. **It explains money, not just moves it** (“this fee is ₹40, money arrives in 2 days”).

## 2. Problem and audience

- Hundreds of millions of people worldwide, and a very large number in India, have low literacy or visual impairment. Verify and cite current figures from WHO, Census or NFB-type sources before using them in the pitch.
- Most payment apps assume you can read, type and see a confirmation screen.
- Existing options (screen readers, UPI 123PAY for feature phones, Hello UPI, assistant-based voice payments) help with navigation, but setup still needs sighted help, local-dialect support is thin, and almost none actively explain payments or defend against scams. Check current details before stating them as fact.
- This group is a prime scam target because they cannot verify what is on a screen.

**Primary persona:** Meena, 58, low literacy, receives money from family abroad, pays small local vendors. **Secondary personas:** a blind user, an elderly first-time digital user. **Family guardian:** her son or daughter, who sets limits and approves risky payments.

## 3. Why this can win (judging criteria mapping)

Scoring is equal across five criteria.

| Criterion | How we score |
| --- | --- |
| Technological Implementation | Real PayPal sandbox flows (send, receive webhooks, invoice QR), LLM intent parsing, speech in and out, WebAuthn, rules engine. Non-trivial and working. |
| Design | One giant mic button, audio-first UX, accessible HTML (screen readers work too), a family dashboard. Coherent end to end. |
| Potential Impact | Specific user, specific problem, tested with real people (include their feedback in the video). |
| Innovation | Trust tiers for non-visual users, scam interview, explain-the-payment, dialect handling. |
| Presentation | A 3-minute story: problem, live demo, scam catch, impact. |

**Prize targets:** Most Impactful, Best Use of PayPal + AI, Most Creative, a Grand Prize. Sponsor prizes (you can win one main plus one sponsor prize): **Render** (host the app), **AG Grid** (family activity dashboard), **Postman** (API collection for testing and docs).

## 4. Feature list

### MVP (must work flawlessly in the demo)

1. Assisted one-time onboarding (guardian present) with fingerprint passkey, voice enrollment, trusted contacts and limits.
2. Voice login and conversation loop: speak, transcribe, intent, spoken reply.
3. **Receive money:** a family member funds the wallet; the app announces it aloud (“Ramesh ne 500 rupaye bheje”).
4. **Send to a trusted contact** by spoken nickname with readback and spoken “haan” confirmation.
5. **Pay a new merchant by scanning a PayPal invoice QR code** with audio camera guidance; the app reads the verified name and fixed amount.
6. **Scam interview and interruption** before risky payments.
7. **Balance and history by voice**, with conversational follow-ups.
8. **Family approval** (one-tap approve or deny) and alerts.
9. “Explain this payment” in plain language.

### Stretch (only if MVP is polished)

- Phone-call mode (a number anyone can call from a basic phone) via a telephony provider.
- A second language.
- AG Grid family dashboard with filters and risk flags.
- Teen/guardian rules mode (mention as “what’s next” otherwise).

## 5. Key design decisions and why

### 5.1 How a blind person opens the app

- Build a **PWA**. After a one-time install by a helper, it opens from the home screen or by voice assistant (“Hey Google, open Awaaz Pay”).
- Blind users already use TalkBack (Android) or VoiceOver (iOS). Semantic HTML, ARIA live regions and big touch targets make the app work with them too.
- Honest assumption: one-time setup by a trusted helper (family, CSC or bank agent).

### 5.2 Who is opening the app

Layered, because each layer can fail:

- **Phone lock and fingerprint passkey (WebAuthn)** as the primary lock.
- **Voice as a secondary risk signal only** (see 5.5).
- **Spending caps**, so even a total failure loses only a small amount.

### 5.3 Preventing someone from using or tricking the blind user

- Allowlist of trusted contacts; payments to anyone else go through tiers (section 6).
- Added contacts have a **24-hour cooling-off** before they can receive money, and the guardian is alerted and can block them. This also stops a dishonest helper from quietly adding themselves.
- Full spoken readback and spoken “haan” on every payment.
- Family alerts above a small threshold.

### 5.4 How he says whom to pay

No typing and no spelling.

1. **Scan the payee’s QR code** (best). The app reads the registered name and fixed amount.
2. **Payee speaks their number or email**, the app repeats it digit by digit (only up to the Tier 2 cap).
3. **A helper adds a regular payee** to the trusted list.
4. Spoken nicknames (“Bhaiya”, “Dukaan wala”) for trusted contacts.

### 5.5 Voice authentication: honest limits

Voiceprints can be fooled by recordings and AI voice cloning. So:

- Voice match is a **risk signal**: a low match adds checks instead of silently blocking.
- A **random-phrase challenge** (“Say: neela kela saat”) defeats simple replay, not a live clone.
- Say plainly in the pitch: **“voice is one signal, not the key.”**

### 5.6 Account opening for a blind person

Real KYC is PayPal’s job, and the sandbox has none. In the demo: assisted onboarding with the guardian present, the app narrating each step, passkey registration, voice enrollment, contacts and limits. State clearly: “real identity verification would use PayPal’s existing KYC.”

### 5.7 Balance and history for non-visual use

- “Mere paas kitna paisa hai?” gives “Aapke paas 2,300 rupaye hain.”
- “Is hafte kya hua?” gives a spoken summary of money in and out.
- Follow-ups: “Ramesh ne last time kitna bheja?”
- Navigation commands: *dohrao* (repeat), *agla* (next), *ruko* (stop).

## 6. Trust tiers and rules engine

A blanket “24 hours for any new payee” would strand someone at a cab or shop. Use tiers instead.

| Tier | Payee | Rule |
| --- | --- | --- |
| 1 | Saved trusted contact (past cooling-off) | Pay freely up to personal limit. Spoken readback and “haan”. |
| 2 | New payee, small amount (spot payment) | “Pocket-money” cap. Example ₹500 per payment, ₹1,000 per day **in total across all new payees**. Verified merchant QR preferred. Readback, “haan”, scam interview. |
| 3 | New payee, larger amount | Needs live family approval (one-tap push). Seconds, not 24 hours. |
| Emergency | Hospital, ticket, urgent | Guardian remotely adds a trusted payee instantly or grants a one-time higher limit. |

### Anti-“salami slicing” rules (many small payments)

- Cap the **aggregate** to all new payees per day and week, not just per payment.
- Limit **new payees per day** (for example 2).
- Repeated payments to the same new payee count against a cumulative cap.
- Pattern alerts: several payments in a short window, rising amounts, payment right after a call.
- Family instant alert when the new-payee budget is used up.

### Risk score inputs

Amount versus normal spending, payee verified or unknown, personal account versus registered merchant, time of day, velocity, scam-interview answers, flagged phrases, payee on shared blocklist.

**Output:** low risk goes through with confirmation; medium adds a question or family alert; high is blocked or needs approval.

Keep caps **configurable** by the user and family.

## 7. Scam detection: how it actually works

The app **cannot hear** a scammer’s phone call (phones block call access, and it would invade privacy). It knows only what the user tells it, plus behavior signals.

**A. Ask directly (most important).** Before a new-payee or unusual payment: “Kya kisi ne phone ya message par aapko ye payment karne ko kaha hai?” and “Kya aap is insaan ko jaante hain?” A yes triggers the warning flow.

**B. Analyze what he says to the app.** The LLM flags coercion cues: urgency, threats (“police aa jayegi”), secrecy (“kisi ko mat batana”), prizes and lotteries, OTP or KYC requests, “refund” and “customs fee” stories.

**C. Silent signals:** unverified payee, unusually high amount, rapid sequence of payments, payee reported by other families (shared blocklist).

**Response when flagged:** the app interrupts calmly (“Ye scam ho sakta hai. Asli bank kabhi OTP nahi maangta. Rukein?”), adds a pause, offers to call a family member, and alerts the guardian.

**Honest limitation:** if the user does not mention the pressure and the payment looks routine, detection can miss it. That is why caps and family alerts sit behind detection.

## 8. Architecture and tech stack

```
[PWA: big mic button, camera, WebAuthn]
        |  audio / QR / taps
[Backend API (Node or Python)]
   |-- Speech-to-Text (Hindi/Hinglish)
   |-- LLM: intent JSON, explanations, scam classifier
   |-- Text-to-Speech (Hindi voice)
   |-- Rules engine (tiers, caps, risk score)
   |-- PayPal sandbox (Payouts/Orders, Invoicing QR, Webhooks)
   |-- DB (users, contacts, ledger, events, approvals)
   |-- Notifications (family approval: push, SMS or WhatsApp-style demo)
[Family dashboard: AG Grid]
```

| Layer | Suggested choice | Notes |
| --- | --- | --- |
| Frontend | React or Next.js PWA | Mobile-first, high contrast, haptics, ARIA live regions |
| Backend | Node (Express) or Python (FastAPI) | Pick the one you ship fastest in |
| DB | Postgres on Render (or SQLite for speed) | Ledger plus audit log |
| Speech-to-text | Evaluate Whisper, Google STT and Indian-language providers | **Test with noisy, accented Hindi on day 2** and choose by accuracy |
| LLM | Claude API (or any strong LLM) | Structured JSON output for intents; separate prompt for scam checks |
| Text-to-speech | Google or Azure Hindi neural voice | Fallback: browser SpeechSynthesis |
| Auth | WebAuthn (SimpleWebAuthn library) | Fingerprint passkeys |
| QR scanning | BarcodeDetector API or jsQR | Add spoken guidance (“thoda left”) |
| Hosting | **Render** | Deploy from day 1 (also eligible for the Render prize) |
| API testing and docs | **Postman** collection | Eligible for sponsor consideration; include in repo |
| Dashboard | **AG Grid** | Family activity table |
| Optional | Telephony (Twilio-style) for phone-call mode | Stretch only |

## 9. PayPal integration plan

Model for the sandbox: the app acts as a **wallet operator** with a PayPal sandbox business account. Be open in the README that balances are tracked in your own ledger as a **sandbox simulation**.

| Flow | PayPal piece | Detail |
| --- | --- | --- |
| Family funds the wallet | Orders API (checkout) | Family member pays in sandbox; **webhook** (payment capture completed) triggers “Ramesh ne 500 rupaye bheje” |
| Pay a trusted contact | Payouts API | Business account pays the contact’s sandbox email; handle payout success webhooks |
| Pay a merchant by QR | Invoicing API: create and send invoice, **generate QR code** | Scanning opens the invoice; amount is fixed by the invoice |
| Receipts and history | Order and payment detail endpoints plus your ledger | Read aloud on request |

**Day-one checks (do not skip):**

1. Can you enable and call Payouts in your sandbox business account? If not, fall back to Orders or another sandbox mechanism.
2. Does the invoice QR flow work end to end in the sandbox?
3. The invoice details API is designed for the merchant who created the invoice, so a payer-side app may not be able to read it directly. **Fallback:** keep a demo merchant registry on your backend that stores the invoices you created, so the app can resolve invoice ID to merchant name and amount. Disclose this in the README.
4. Webhooks need a public URL, so your Render deployment from day 1 is required.
5. If the QR payer flow cannot be completed from the app, record payment against the invoice (mark as paid) after a successful payout, and keep the demo honest.

Use the PayPal sandbox only, with test accounts: a sender (family), a receiver (user), a merchant (cab driver), and your wallet-operator business account.

## 10. AI components

### 10.1 Intent parsing (LLM to JSON)

Example output the app expects:

```json
{"intent":"send_money","recipient_alias":"bhaiya","amount":500,"currency":"INR","language":"hi-en","confidence":0.93,"scam_cues":[]}
```

Supported intents: `send_money`, `check_balance`, `read_history`, `explain_payment`, `repeat`, `confirm_yes`, `confirm_no`, `add_help_request`, `report_scam`, `unknown`.

Rules: low confidence means ask a short clarifying question; never act on money intents without explicit spoken confirmation.

### 10.2 Dialect handling

Handle code-switching (“bhaiya 500 rupaye bhej do”), number words (“paanch sau”), and common nicknames. Build a small test set of 30 or more recorded utterances (different speakers, noise levels) and track accuracy.

### 10.3 Explanations

Plain, short, spoken: amount, who, fee, when it arrives, can it be reversed. Keep every response under about 15 seconds of speech, and always offer “dohrao”.

### 10.4 Scam classifier

Separate prompt: input is the transcript plus context signals, output is `risk: low/medium/high` plus reasons plus the spoken warning. Log every decision for the audit trail.

### 10.5 Safety rules for the AI itself

- The LLM **never moves money directly**. It outputs intents; the rules engine decides; the user confirms.
- Never trust spoken claims of identity or authority.
- Do not store raw audio longer than needed (privacy).

## 11. Accessibility and UX principles

- One huge mic button; everything else optional.
- Always speak the result and the next step (“Ab ‘haan’ ya ‘nahi’ bolein”).
- Short sentences, slow clear Hindi voice, adjustable speed.
- Audio cues and haptic feedback for success and failure.
- Never rely on color alone; high contrast; text mirrors speech for helpers and judges.
- Works with TalkBack and VoiceOver (labels, focus order, live regions).
- Every error is spoken and recoverable (“Samajh nahi aaya, dobara boliye”).
- Silence and noise handling: re-prompt, never guess on money.

## 12. Data model (sketch)

- **users**: id, name, language, passkey credential, voice profile ref, limits
- **guardians**: id, user\_id, contact, permissions
- **contacts**: id, user\_id, alias, paypal\_email, status (cooling\_off or active), added\_by, activated\_at
- **merchants**: id, name, paypal\_email, verified, invoice registry
- **transactions**: id, user\_id, type, amount, counterparty, tier, risk\_score, status, paypal\_ref
- **approvals**: id, transaction\_id, guardian\_id, status, decided\_at
- **events/audit**: every intent, decision and warning
- **blocklist**: reported payees

## 13. Demo scenario (build the app around this)

1. Meena’s son (Dubai) sends ₹500; the phone announces it.
2. She asks the balance and hears a clear answer.
3. She pays her saved vegetable seller by voice with readback and “haan”.
4. At a cab, she scans the driver’s QR; the app speaks the driver’s name and ₹250; she confirms.
5. A scammer on a call tells her to pay a “prize fee”. She tells the app; the app interrupts, asks questions, blocks it and alerts her son.
6. Her son opens the family dashboard (AG Grid) and sees the flagged event.

## 14. 14-day build plan (Oct 29 to Nov 12)

| Dates | Goal |
| --- | --- |
| **Oct 29-30** | Create PayPal sandbox accounts, public GitHub repo with **MIT license visible in About**, project skeleton, **deploy to Render**. Run all day-one PayPal checks. |
| **Oct 31-Nov 2** | Voice loop: mic, STT, LLM intent JSON, TTS reply. Test dialects early. |
| **Nov 3-5** | PayPal flows: fund wallet with webhook announcement, payout to contact, balance and history. |
| **Nov 6-7** | Rules engine, tiers, caps, scam interview and interruption, family approval. |
| **Nov 8-9** | Invoice QR scan flow, passkey login, UI polish, **test with 2-3 real people** (note their feedback). |
| **Nov 10** | Bug fixing, README with exact run instructions, sandbox credentials, Postman collection. |
| **Nov 11** | Record and edit the video (under 3 minutes), upload to YouTube, complete the Devpost form, **submit**. |
| **Nov 12** | Buffer only. Do not start new features. |

Daily habit: end each day with a working, deployed build. Cut features, never quality.

## 15. Submission checklist (disqualification traps)

- [ ] Project integrates PayPal (sandbox) and an AI tool, with PayPal central.
- [ ] Public repo (GitHub, GitLab or Bitbucket) with a detectable open-source license in the About section.
- [ ] README with setup and run instructions, plus test credentials and sandbox details.
- [ ] A working demo (hosted URL or runnable instructions). A mockup does not count.
- [ ] Text description of features and functionality; if reusing older code, explain what was significantly updated during the submission period.
- [ ] Video under 3 minutes, public on YouTube, shows the real app working on the intended device.
- [ ] No copyrighted music and no third-party trademarks or logos in the video.
- [ ] All materials in English (or English translation). Provide English subtitles for Hindi speech in the video.
- [ ] Third-party SDKs and APIs used within their terms.
- [ ] Every feature shown in the video really works in the build.
- [ ] Team representative chosen (if a team) and eligibility confirmed.
- [ ] Free access for judges until the judging period ends (keep the Render app alive and the sandbox accounts valid through mid-December).

## 16. Video script (under 3 minutes)

| Time | Content |
| --- | --- |
| 0:00-0:25 | The problem through Meena’s story; one strong statistic |
| 0:25-1:45 | Live demo: receive money, balance, pay a trusted contact, cab QR payment |
| 1:45-2:20 | The scam moment: interruption, family alert, dashboard |
| 2:20-2:50 | Impact, who it is for, real-user feedback, how PayPal and AI are used |
| 2:50-3:00 | Close, repo and demo link |

Tips: show the phone screen and hear the audio clearly; add English subtitles; record the voice demo in a quiet room; rehearse three times.

## 17. Pitch and judge Q&A

**Business model line:** families and guardians (or NGOs and banks) fund the wallets; PayPal earns transaction and cross-border fees and gains new users from an underserved group.

**Be ready for:**

- *“What if someone steals the phone?”* Fingerprint passkey, voice risk signal, caps, family alerts.
- *“What about voice cloning?”* Voice is one signal, not the key. Caps and approvals limit damage.
- *“How does a blind user onboard?”* Assisted one-time setup; real KYC via PayPal’s verification.
- *“What if the guardian is the abuser?”* Acknowledge it: a future version needs an independent trusted contact and abuse-reporting paths.
- *“What if he pays a cab and can’t wait?”* Tier 2 spot payments with a pocket-money cap.
- *“How do you detect scams you can’t hear?”* We ask, we analyze what the user says, and we use behavior signals; caps sit behind it.
- *“Is this production-ready?”* No. It’s a sandbox build; say what is simulated.

## 18. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| STT struggles with dialect or noise | Test early, compare providers, add confirmation of numbers, push-to-talk |
| Payouts or invoice QR not available as expected in sandbox | Day-one checks and fallbacks in section 9 |
| Webhook not reaching the app | Deploy early; use a webhook tester; log events |
| Scope creep | MVP list is fixed; stretch only after polish |
| Demo fails live | Pre-test, use a recorded take for the video, keep a backup recording |
| Real-user testing skipped | Schedule it for Nov 8-9 and make it part of the video |
| Privacy | Minimal audio retention; no real personal data; sandbox only |

## 19. Honest limitations (state them in the submission)

- Sandbox only; no real KYC; balances simulated in a ledger.
- Voice biometrics are not production-grade and are a secondary signal.
- The app cannot hear scam calls; it relies on questions, user statements and behavior signals.
- Guardian misuse is a recognized risk to address in future work.

## 20. Future work (one slide, one sentence each)

- Teen and guardian rules mode.
- Phone-call mode for feature phones.
- More Indian languages and dialects.
- Community scam blocklist across families.
- Production KYC, stronger anti-spoofing, and regulatory review.

## 21. Quick start (do these today)

1. Create the GitHub repo with an MIT license and a README stub.
2. Create PayPal developer sandbox accounts (family, user, merchant, operator).
3. Deploy a hello-world to Render and register the webhook URL.
4. Run the PayPal day-one checks (Payouts, invoice QR, webhook).
5. Record 30 Hindi and Hinglish test utterances and try two STT options.
6. Write the intent JSON schema and the rules table in code.
