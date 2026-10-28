# Deployment Guide: Render (Free Tier)

This guide explains how to deploy Awaaz Pay on Render's free tier as a single unified service (Express serving the React Vite PWA and API routes under one public URL).

---

## 1. Important Free Tier Caveats

Render's free tier has specific behaviors that directly impact app operation:

1. **Sleep After Inactivity:**
   - Free web services automatically spin down after **15 minutes of inactivity**.
   - The first request after sleep incurs a cold-start delay of approximately **30 to 50 seconds**.
   - PayPal webhooks sent while the service is sleeping will wake the instance, but PayPal may retry if the initial request times out. Keep this in mind when testing live webhooks.

2. **Ephemeral Filesystem (Disk Resets):**
   - Free tier instances **do not have persistent disks**. Any files written to disk (including the SQLite database `awaaz_pay.db`) will be **erased whenever the instance restarts, updates, or wakes up from sleep**.
   - **Architectural Requirement:** The application database must automatically create tables and re-seed default demo accounts (user, guardian, trusted contacts, and initial wallet balance) on server startup so the application is always demo-ready upon wake-up.

---

## 2. Step-by-Step Manual Deployment in Render Dashboard

Follow these steps to deploy manually from the Render dashboard:

### Step 1: Push Repository to GitHub
Ensure your latest changes are pushed to your GitHub repository:
```bash
git push origin main
```

### Step 2: Create a New Web Service on Render
1. Log in to [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** in the top navigation bar and select **Web Service**.
3. Choose **Build and deploy from a Git repository** and click **Next**.
4. Select your `Awaaz-Pay` repository (or paste the repository URL).

### Step 3: Configure Web Service Settings
Fill in the deployment settings as follows:

| Setting | Value |
| --- | --- |
| **Name** | `awaaz-pay` (or your preferred name, which determines your URL) |
| **Region** | Choose closest to you (e.g., `Singapore` or `Frankfurt` / `Oregon`) |
| **Branch** | `main` |
| **Root Directory** | *(leave blank - root of monorepo)* |
| **Runtime** | `Node` |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm start` |
| **Instance Type** | `Free` |

### Step 4: Configure Health Check Path
1. Scroll down and click **Advanced**.
2. Find the **Health Check Path** field.
3. Enter: `/api/health`.

### Step 5: Add Environment Variables
Under the **Environment Variables** section, click **Add Environment Variable** for each key:

| Key | Example / Recommended Value | Description |
| --- | --- | --- |
| `NODE_ENV` | `production` | Enforces production mode |
| `PORT` | `10000` | Port assigned by Render (automatically mapped) |
| `PUBLIC_BASE_URL` | `https://awaaz-pay.onrender.com` | Your public Render URL (used for webhooks and logging) |
| `PAYPAL_API_BASE` | `https://api-m.sandbox.paypal.com` | PayPal sandbox base URL |
| `PAYPAL_CLIENT_ID` | `your_sandbox_client_id` | From PayPal Developer Dashboard |
| `PAYPAL_CLIENT_SECRET` | `your_sandbox_client_secret` | From PayPal Developer Dashboard |
| `PAYPAL_WEBHOOK_ID` | `your_webhook_id` | Set after registering webhook in PayPal dashboard |
| `GEMINI_API_KEY` | `your_gemini_api_key` | Optional for LLM intent parsing |
| `GROQ_API_KEY` | `your_groq_api_key` | Optional LLM fallback key |

> **Note on `PUBLIC_BASE_URL`:** When first creating the service, enter the URL assigned by Render (e.g., `https://<service-name>.onrender.com`). You can update this after initial deployment if needed.

### Step 6: Deploy
1. Click **Create Web Service**.
2. Render will trigger the initial build (`npm install && npm run build`) and start the server (`npm start`).
3. Monitor the build and deploy logs. When finished, the status will show **Live**.

---

## 3. Alternative: Deploying via Blueprint (`render.yaml`)

If you prefer using Render's Infrastructure-as-Code feature:
1. In the Render Dashboard, click **New +** and select **Blueprint**.
2. Select your repository. Render will automatically detect `render.yaml`.
3. Fill in the empty environment variables prompted by the dashboard (e.g., `PUBLIC_BASE_URL`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`).
4. Click **Apply**.

---

## 4. Verification After Deployment

Once the service is **Live**, verify both endpoints:

1. **Frontend Web Page:**
   - Navigate to: `https://<your-service-name>.onrender.com/`
   - You should see the Awaaz Pay web application with high-contrast text: **"Awaaz Pay"**.

2. **Backend Health Check:**
   - Navigate to: `https://<your-service-name>.onrender.com/api/health`
   - Expected JSON response:
     ```json
     {
       "status": "ok",
       "time": "2026-10-29T..."
     }
     ```

3. **Check Logs:**
   - In Render Dashboard under the **Logs** tab, verify the startup line:
     ```text
     [Awaaz Pay Server] listening on port 10000 (mode: production)
     [Awaaz Pay Server] public base URL: https://<your-service-name>.onrender.com
     ```

---

## 5. Connecting PayPal Sandbox Webhook

Once the Render service is running:
1. Go to [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/).
2. Select your sandbox app.
3. Under **Webhooks**, click **Add Webhook**.
4. Set Webhook URL to: `https://<your-service-name>.onrender.com/api/webhooks/paypal`.
5. Select webhook events (e.g. `PAYMENT.CAPTURE.COMPLETED`, `CHECKOUT.ORDER.APPROVED`).
6. Copy the generated **Webhook ID** and add it as `PAYPAL_WEBHOOK_ID` in your Render environment variables.
