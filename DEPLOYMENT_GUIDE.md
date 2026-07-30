# 🚀 TTS Strategy Calendar — Production Deployment Guide

This guide details the complete end-to-end deployment process for launching the **TTS Strategy Calendar & Capital Allocation System** to production, starting **only with the source code repository hosted on GitHub**.

---

## 📑 Table of Contents
1. [Prerequisites & Account Setup](#1-prerequisites--account-setup)
2. [Step 1: Provision Upstash Redis Database](#step-1-provision-upstash-redis-database)
3. [Step 2: Create & Configure Telegram Bot (`@BotFather`)](#step-2-create--configure-telegram-bot-botfather)
4. [Step 3: Deploy Project on Vercel](#step-3-deploy-project-on-vercel)
5. [Step 4: Register Telegram Webhook Endpoint](#step-4-register-telegram-webhook-endpoint)
6. [Step 5: Custom Domain & SSL Configuration](#step-5-custom-domain--ssl-configuration)
7. [Step 6: Post-Deployment Verification & Smoke Testing](#step-6-post-deployment-verification--smoke-testing)
8. [Step 7: Ongoing Maintenance & Incident Recovery](#step-7-ongoing-maintenance--incident-recovery)

---

## 1. Prerequisites & Account Setup

Before starting deployment, ensure you have accounts created for the following free services:

- **GitHub Account:** Access to repository `srkdroid/tts-strategies`.
- **Vercel Account:** [Vercel Sign-Up](https://vercel.com/signup) (free Hobby or Pro account).
- **Upstash Account:** [Upstash Console](https://console.upstash.com/) (free serverless Redis tier).
- **Telegram Account:** Access to Telegram mobile/desktop app to communicate with `@BotFather`.

---

## Step 1: Provision Upstash Redis Database

Upstash Redis handles user sessions, transient Telegram login tokens, user whitelists (phone numbers & 6-digit PINs), notes data, and login audit trails.

1. Log into [Upstash Console](https://console.upstash.com/).
2. Click **Create Database**.
3. **Database Name:** `tts-strategies-kv`
4. **Primary Region:** Select a region closest to your target users (e.g., `AWS ap-south-1 (Mumbai)` or `AWS us-east-1`).
5. **Encryption at Rest:** Enabled.
6. Click **Create**.
7. Once created, scroll down to the **REST API** section under **Details**.
8. Copy and save the following two credentials:
   - `UPSTASH_REDIS_REST_URL` (e.g. `https://vital-snake-31234.upstash.io`)
   - `UPSTASH_REDIS_REST_TOKEN` (e.g. `AX...`)

---

## Step 2: Create & Configure Telegram Bot (`@BotFather`)

Telegram login requires an official bot to receive contact verification cards.

1. Open Telegram and search for **`@BotFather`**.
2. Start a chat and send `/newbot`.
3. **Bot Name:** `TTS Strategies Calendar Bot`
4. **Bot Username:** Choose a unique username ending in `bot` (e.g. `TTSStrategiesBot` or `MyTTSCalendarBot`).
5. Copy the generated **HTTP API Token** (e.g. `7123456789:AAE...`).
6. Set bot description by sending `/setdescription`:
   - Text: `Official authentication bot for TTS Options Strategy Calendar. Share your contact card to verify your account.`

---

## Step 3: Deploy Project on Vercel

Vercel hosts the static HTML5/CSS/JS frontend assets and executes the Node.js Serverless Functions in `/api`.

1. Log into [Vercel Dashboard](https://vercel.com/).
2. Click **Add New...** > **Project**.
3. Under *Import Git Repository*, select your GitHub repository (`srkdroid/tts-strategies`).
4. **Project Settings:**
   - **Project Name:** `tts-strategies` (or custom name).
   - **Framework Preset:** `Other` (or `Plain HTML`).
   - **Root Directory:** `./`
   - **Build Command:** *(Leave empty)*
   - **Output Directory:** `.`
5. Expand **Environment Variables** and add the following 6 key-value pairs:

| Key | Value Description | Example Value |
|---|---|---|
| `JWT_SECRET` | 32+ character random string for signing user tokens | `TTS_STRATEGIES_SECURE_KEY_2026_JULY` |
| `ADMIN_JWT_SECRET` | 32+ character random string for admin sessions | `TTS_STRATEGIES_ADMIN_SECURE_KEY_2026` |
| `ADMIN_PASSWORD` | Master password to access `/admin.html` | `YourMasterAdminPassword123!` |
| `TELEGRAM_BOT_TOKEN` | API Token from `@BotFather` | `7123456789:AAE...` |
| `KV_REST_API_URL` | Upstash Redis REST URL | `https://vital-snake-31234.upstash.io` |
| `KV_REST_API_TOKEN` | Upstash Redis REST Token | `AX...` |

6. Click **Deploy**.
7. Wait 30–45 seconds for Vercel to complete building and deploying. Copy your live Vercel deployment URL (e.g., `https://tts-strategies.vercel.app`).

---

## Step 4: Register Telegram Webhook Endpoint

Now connect your Telegram Bot to your live Vercel API endpoint so Telegram can notify your server when users tap **Verify Phone Number**.

Run the following command in your terminal (replace `<BOT_TOKEN>` and `<VERCEL_URL>`):

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url": "https://<VERCEL_URL>/api/telegram-webhook"}'
```

*Example Execution:*
```bash
curl -X POST "https://api.telegram.org/bot7123456789:AAE.../setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url": "https://tts-strategies.vercel.app/api/telegram-webhook"}'
```

*Expected Success Response:*
```json
{"ok": true, "result": true, "description": "Webhook was set"}
```

To verify the webhook status at any time, open this URL in your web browser:
```text
https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo
```

---

## Step 5: Custom Domain & SSL Configuration

If you own a custom domain (e.g., `tts-strategies.com` or `app.yourdomain.com`):

1. In Vercel Dashboard, go to **Project Settings > Domains**.
2. Type your domain name and click **Add**.
3. In your DNS provider (Cloudflare, GoDaddy, Namecheap, Google Domains):
   - For Apex Domain (`yourdomain.com`): Add an **A Record** pointing `@` to `76.76.21.21`.
   - For Subdomain (`app.yourdomain.com`): Add a **CNAME Record** pointing `app` to `cname.vercel-dns.com`.
4. Vercel automatically provisions SSL certificates via Let's Encrypt within 60 seconds.
5. If using a custom domain, re-register your Telegram webhook URL with the custom domain:
   ```bash
   curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
        -H "Content-Type: application/json" \
        -d '{"url": "https://app.yourdomain.com/api/telegram-webhook"}'
   ```

---

## Step 6: Post-Deployment Verification & Smoke Testing

Execute this smoke test suite to confirm 100% operational status:

### 🧪 Test 1: Admin Portal Login & Seed Data Setup
1. Navigate to `https://<YOUR-DOMAIN>/admin.html`.
2. Enter your `ADMIN_PASSWORD`.
3. Verify access to the Admin Dashboard.
4. Add your phone number (e.g. `+919876543210`) and a 6-digit PIN under **User Whitelist Management**.

### 🧪 Test 2: Telegram QR & Contact Authentication
1. Open `https://<YOUR-DOMAIN>/login.html` in an Incognito window.
2. Click **Verify on Telegram**.
3. Open the Telegram link and click **Start** in Telegram.
4. Tap **📱 Verify Phone Number**.
5. Confirm that the browser automatically detects successful verification, sets the HTTP-only cookie, and redirects to `/index.html`.

### 🧪 Test 3: 6-Digit PIN Authentication
1. Open `https://<YOUR-DOMAIN>/loginpin.html`.
2. Enter your registered phone number and 6-digit PIN.
3. Confirm successful login and redirection to `/index.html`.

### 🧪 Test 4: Master Calendar & Index Filters
1. In `/index.html`, select index filters (`Nifty`, `Bank Nifty`, `Fin Nifty`, `Sensex`).
2. Verify calendar deployment tiles render with exact dates and holiday badges.

### 🧪 Test 5: Knowledge Base & Notes System
1. Click **📖 Strategy Notes** in the top header.
2. Verify generic guidelines and strategy blueprints render in markdown.
3. Test editing or adding a note as Admin.

### 🧪 Test 6: Capital Allocation & Expected RoI Planner
1. Ensure you are logged in as Admin.
2. Click **`💰 Capital Planner`** in the view toggle bar.
3. Verify the 5-week deployment matrix and strategy breakdown table render accurately.
4. Change capital base (e.g., ₹ 50,00,000) and verify real-time recalculation.

---

## Step 7: Ongoing Maintenance & Incident Recovery

### 💾 Backup Strategy Data
Admins can download a complete backup of parsed strategies at any time:
1. Open `/admin.html`.
2. Click **Export Strategies (`strategies.js`)**.
3. Save the file locally or commit it to GitHub.

### 🔄 Secret Rotation Protocol
If credentials are compromised:
1. Update `ADMIN_PASSWORD`, `JWT_SECRET`, or `ADMIN_JWT_SECRET` in Vercel Environment Variables.
2. Click **Redeploy** in Vercel Dashboard. All existing sessions will automatically expire, requiring users to log in again.

---

### 🎉 Production Ready!
Your **TTS Strategy Calendar System** is fully deployed, secured, and ready for live production use!
