# 🚀 TTS Strategy Calendar — Production Installation & Deployment Guide

**Version**: 5.6  
**Last Updated**: August 2026  
**Repository**: `srkdroid/tts-strategies`

This guide details the complete end-to-end setup process for running the application **locally on your machine** or deploying it to **production on Vercel** backed by **Upstash Redis**.

---

## 📑 Table of Contents
1. [Prerequisites](#1-prerequisites)
2. [Local Installation & Offline Development](#2-local-installation--offline-development)
3. [Production Step 1: Provision Upstash Redis Database](#3-production-step-1-provision-upstash-redis-database)
4. [Production Step 2: Configure Telegram Bot (@BotFather)](#4-production-step-2-configure-telegram-bot-botfather)
5. [Production Step 3: Deploy Project to Vercel](#5-production-step-3-deploy-project-to-vercel)
6. [Production Step 4: Register Telegram Webhook](#6-production-step-4-register-telegram-webhook)
7. [Production Step 5: Configure Environment Variables](#7-production-step-5-configure-environment-variables)
8. [Production Step 6: Initial Whitelist & Permission Setup](#8-production-step-6-initial-whitelist--permission-setup)
9. [Automated CI Verification & Syntax Check](#9-automated-ci-verification--syntax-check)
10. [Troubleshooting & Maintenance Checklist](#10-troubleshooting--maintenance-checklist)

---

## 1. Prerequisites

Before starting, ensure you have:
- **Node.js**: v18.0.0 or higher installed on your machine (`node -v`).
- **Git**: Installed and connected to GitHub.
- **Vercel Account**: [Vercel Sign-Up](https://vercel.com/signup) (Free Hobby or Pro).
- **Upstash Account**: [Upstash Console](https://console.upstash.com/) (Free Serverless Redis).
- **Telegram Account**: To create an authentication bot via `@BotFather`.

---

## 2. Local Installation & Offline Development

You can run the full application locally with hot-reloading and simulated database fallback:

### Step 2.1: Clone the Repository
```bash
git clone https://github.com/srkdroid/tts-strategies.git
cd tts-strategies
```

### Step 2.2: Configure Local Environment
Copy the template environment file:
```bash
cp .env.example .env
```
Edit `.env` and set your local development secrets:
```ini
JWT_SECRET=local_development_jwt_secret_min_32_characters_long
ADMIN_JWT_SECRET=local_admin_jwt_secret_min_32_characters_long
ADMIN_PASSWORD=admin123!
```
*(If you have Upstash Redis credentials, add `KV_REST_API_URL` and `KV_REST_API_TOKEN` to connect to live data; otherwise, local fallback mode is active).*

### Step 2.3: Start Local Server
Run the built-in local development server:
```bash
node local-server.js
```

Open your browser and navigate to:
```
http://localhost:3000/index.html
```

---

## 3. Production Step 1: Provision Upstash Redis Database

Upstash Redis stores user sessions, 6-digit PIN whitelists, feature permissions, trade logs, strategy notes, and private WebP media.

1. Log into [Upstash Console](https://console.upstash.com/).
2. Click **Create Database**.
3. **Database Name**: `tts-strategies-kv`
4. **Primary Region**: Select a region closest to your users (e.g., `AWS ap-south-1 (Mumbai)` or `AWS us-east-1`).
5. **Encryption at Rest**: Enabled.
6. Click **Create**.
7. Once created, scroll down to the **REST API** section under **Details**.
8. Copy and save:
   - `KV_REST_API_URL` (e.g. `https://your-db.upstash.io`)
   - `KV_REST_API_TOKEN` (e.g. `AX...`)

---

## 4. Production Step 2: Configure Telegram Bot (@BotFather)

1. Open Telegram and search for **`@BotFather`**.
2. Send `/newbot`.
3. **Bot Name**: `TTS Strategies Calendar Bot`
4. **Bot Username**: Pick a unique username ending in `bot` (e.g. `TTSStrategiesAuthBot`).
5. Copy the generated **HTTP API Token** (e.g. `7123456789:AAE...`).
6. Set the description by sending `/setdescription`:
   - Text: `Official authentication bot for TTS Options Strategy Calendar. Share your contact card to verify your account.`

---

## 5. Production Step 3: Deploy Project to Vercel

1. Log into [Vercel Dashboard](https://vercel.com/).
2. Click **Add New...** ➔ **Project**.
3. Import your GitHub repository (`srkdroid/tts-strategies`).
4. **Project Settings**:
   - **Framework Preset**: `Other` (or `Plain HTML`).
   - **Root Directory**: `./`
   - **Build Command**: *(Leave empty)*
   - **Output Directory**: `.`
5. Expand **Environment Variables** (see Section 7 below) and add all required keys.
6. Click **Deploy**.

---

## 6. Production Step 4: Register Telegram Webhook

Once your Vercel deployment URL is live (e.g., `https://tts-strategies.vercel.app`), connect your Telegram bot:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url": "https://<YOUR_VERCEL_URL>/api/telegram-webhook"}'
```

Verify webhook registration:
```bash
curl "https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

---

## 7. Production Step 5: Configure Environment Variables

The following environment variables must be configured in your **Vercel Project Settings ➔ Environment Variables**:

| Variable Name | Required | Description | Example / Format |
|---|:---:|---|---|
| `JWT_SECRET` | **Yes** | 32+ character random string for signing member tokens | `f8a3c2...91d0` |
| `ADMIN_JWT_SECRET` | **Yes** | 32+ character random string for admin sessions | `e7b1a9...42c8` |
| `ADMIN_PASSWORD` | **Yes** | Master password to access `/admin.html` & Admin console | `YourSecurePassword!` |
| `KV_REST_API_URL` | **Yes** | Upstash Redis REST endpoint URL | `https://your-db.upstash.io` |
| `KV_REST_API_TOKEN` | **Yes** | Upstash Redis REST token | `AX...` |
| `TELEGRAM_BOT_TOKEN` | **Yes** | Bot API token from `@BotFather` | `7123456789:AAE...` |
| `TELEGRAM_BOT_USERNAME` | Optional | Username of your bot without `@` | `TTSStrategiesAuthBot` |

---

## 8. Production Step 6: Initial Whitelist & Permission Setup

1. Open your live deployment URL at `/admin.html` (e.g., `https://tts-strategies.vercel.app/admin.html`).
2. Log in using your master `ADMIN_PASSWORD`.
3. In the **Whitelist & Permissions** tab:
   - Click **+ Add User** to register member phone numbers and 6-digit PINs.
   - Toggle **Strategy Catalog** and **Trade Journal** access checkboxes per user, or use the header select-all box for bulk enablement.
   - Click **💾 Save Whitelist to Database**.

---

## 9. Automated CI Verification & Syntax Check

Every push or pull request to `main` automatically triggers GitHub Actions to validate JavaScript syntax across all files.

To run the syntax verification locally:
```bash
# Validate root files
node -c app.js
node -c notes.js
node -c holidays.js
node -c capital-planner-data.js
node -c strategies.js
node -c local-server.js

# Validate API handlers
node -c api/index.js
node -c api/_lib/admin.js
node -c api/_lib/data.js
node -c api/_lib/journal.js
node -c api/_lib/login.js
node -c api/_lib/login-pin.js
node -c api/_lib/logout.js
node -c api/_lib/notes.js
node -c api/_lib/telegram-webhook.js
node -c api/_lib/track.js
node -c api/_lib/upload.js
```

---

## 10. Troubleshooting & Maintenance Checklist

| Symptom | Cause | Solution |
|---|---|---|
| **401 Unauthorized on Login** | Phone number not in `whitelist` hash or incorrect PIN. | Verify phone in `/admin.html` whitelist. Ensure international format (`+91...`). |
| **429 Too Many Requests** | PIN rate limiter triggered after 5 failed attempts. | Wait 15 minutes or delete `rate_limit:pin:<phone>` key in Upstash console. |
| **500 KV_DATABASE_UNCONNECTED** | Missing `KV_REST_API_URL` or `KV_REST_API_TOKEN`. | Check Vercel environment variables and redeploy. |
| **Telegram OTP not verifying** | Telegram webhook not pointed to current Vercel URL. | Re-run `setWebhook` API call from Step 4. |
| **Image Paste Upload Fails** | Expired session cookie or image payload exceeds 1.5MB. | Ensure user is logged in; editor automatically falls back to local embed if offline. |
| **Stale CSS or JavaScript** | Browser caching older static asset versions. | Hard refresh with `Ctrl+Shift+R`; asset URLs use cache buster query `?v=5.6`. |
