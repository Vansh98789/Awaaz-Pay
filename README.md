# Awaaz Pay

> A voice-first wallet for blind and low-literacy users in India.

A voice-first financial assistant and wallet built for the PayPal AI Hackathon. Users speak in Hindi, Hinglish, or English. The app explains payments clearly, enforces deterministic rules and human confirmation before executing any transaction, and guards against financial scams.

## Setup

<!-- Instructions for installing prerequisites and configuring environment variables -->

1. Clone the repository:
   ```bash
   git clone https://github.com/Vansh98789/Awaaz-Pay.git
   cd awaaz_pay
   ```
2. Copy `.env.example` to `.env` and fill in required sandbox API keys:
   ```bash
   cp .env.example .env
   ```
3. Install dependencies:
   ```bash
   npm install
   ```

## Run

<!-- Commands to start the development servers and execute tests -->

- **Start both backend and frontend:**
  ```bash
  npm run dev
  ```
  - Backend API: `http://localhost:3001`
  - Web App: `http://localhost:5173`
- **Run tests:**
  ```bash
  npm test
  ```
- **Lint code:**
  ```bash
  npm run lint
  ```
- **Build production assets:**
  ```bash
  npm run build
  ```

## Demo

<!-- Live demo link, video link, and test credentials -->

- **Hosted URL:** TBD (Render)
- **Video:** TBD (< 3 minutes)
- **PayPal Sandbox Credentials:** See documentation / sandbox test accounts.

## How it works

<!-- Architecture overview and flow description -->

1. **Voice Input:** User taps the prominent mic button and speaks in Hindi or Hinglish.
2. **Intent & Safety:** Speech is transcribed and processed to extract structured intent. Scam cues are flagged deterministically.
3. **Deterministic Rules Engine:** The LLM never moves money. Limits, trust tiers, and cooldown rules decide if the payment is permitted.
4. **Verbal Confirmation:** The app clearly reads back the payment details, fees, and recipient name; the user confirms aloud.
5. **Execution:** Transaction executes via PayPal sandbox APIs (Orders/Payouts/Invoicing).

## How we built it

<!-- Tech stack and engineering decisions -->

- **Backend:** Node.js, Express, TypeScript, Zod, better-sqlite3, Vitest.
- **Frontend:** React, Vite, TypeScript, PWA-ready architecture.
- **Payments:** PayPal Sandbox (Orders API, Payouts API, Invoicing QR, Webhooks).
- **Safety:** Multi-tier trust model, anti-salami-slicing velocity checks, spoken readback.
