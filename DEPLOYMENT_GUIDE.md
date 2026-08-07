# 🚀 TTS Strategy Calendar — Production Deployment & Setup Guide

This guide details the complete end-to-end deployment process for launching the **TTS Strategy Calendar, Trade Journal & Capital Allocation System** to production on Vercel backed by Upstash Redis.

---

## 📑 Table of Contents
1. [Prerequisites & Account Setup](#1-prerequisites--account-setup)
2. [Step 1: Provision Upstash Redis Database](#step-1-provision-upstash-redis-database)
3. [Step 2: Create & Configure Telegram Bot (`@BotFather`)](#step-2-create--configure-telegram-bot-botfather)
4. [Step 3: Deploy Project on Vercel](#step-3-deploy-project-on-vercel)
5. [Step 4: Register Telegram Webhook Endpoint](#step-4-register-telegram-webhook-endpoint)
6. [Step 5: Post-Deployment Initial Whitelist & Bulk Permission Setup](#step-5-post-deployment-initial-whitelist--bulk-permission-setup)
7. [Step 6: Custom Domain & SSL Configuration](#step-6-custom-domain--ssl-configuration)
8. [Step 7: Ongoing Maintenance & Incident Recovery](#step-7-ongoing-maintenance--incident-recovery)

---

## 1. Prerequisites & Account Setup

Before starting deployment, ensure you have active accounts for the following free/standard services:

- **GitHub Account:** Access to repository `srkdroid/tts-strategies`.
- **Vercel Account:** [Vercel Sign-Up](https://vercel.com/signup) (free Hobby or Pro account).
- **Upstash Account:** [Upstash Console](https://console.upstash.com/) (free serverless Redis tier).
- **Telegram Account:** Access to Telegram mobile/desktop app to communicate with `@BotFather`.

---

## Step 1: Provision Upstash Redis Database

Upstash Redis handles user sessions, transient Telegram login tokens, user whitelists (phone numbers & 6-digit PINs), per-user feature permission flags (`user_permissions`), trade journal logs (`user_trades:<phone>`), strategy notes data, and login audit trails.

1. Log into [Upstash Console](https://console.upstash.com/).
2. Click **Create Database**.
3. **Database Name:** `tts-strategies-kv`
4. **Primary Region:** Select a region closest to your target users (e.g., `AWS ap-south-1 (Mumbai)` or `AWS us-east-1`).
5. **Encryption at Rest:** Enabled.
6. Click **Create**.
7. Once created, scroll down to the **REST API** section under **Details**.
8. Copy and save the following two credentials:
   - `KV_REST_API_URL` (e.g. `https://vital-snake-31234.upstash.io`)
   - `KV_REST_API_TOKEN` (e.g. `AX...`)

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
5. Expand **Environment Variables** and add the following key-value pairs:

| Key | Required | Value Description | Example Value |
|---|---|---|---|
| `JWT_SECRET` | **Yes** | 32+ character random string for signing user tokens | `TTS_STRATEGIES_SECURE_KEY_2026_JULY` |
| `ADMIN_JWT_SECRET` | **Yes** | 32+ character random string for admin sessions | `TTS_STRATEGIES_ADMIN_SECURE_KEY_2026` |
| `ADMIN_PASSWORD` | **Yes** | Master password to access `/admin.html` & Admin features | `YourMasterAdminPassword123!` |
| `TELEGRAM_BOT_TOKEN` | **Yes** | API Token from `@BotFather` | `7123456789:AAE...` |
| `KV_REST_API_URL` | **Yes** | Upstash Redis REST URL | `https://vital-snake-31234.upstash.io` |
| `KV_REST_API_TOKEN` | **Yes** | Upstash Redis REST Token | `AX...` |

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
*Expected Output:* `{"ok":true,"result":true,"description":"Webhook was set"}`

---

## Step 5: Post-Deployment Initial Whitelist & Bulk Permission Setup

1. **Access Admin Portal:**
   Navigate to `https://<YOUR-VERCEL-URL>/admin.html` and log in using your `ADMIN_PASSWORD`.
2. **Import Whitelist & Initial Sync:**
   - Click **🔄 Sync from Codebase** to populate the Redis `whitelist` hash with initial phone numbers from `whitelist.json`.
   - Alternatively, tap **📱 Sync WhatsApp Group** to pull group members from OpenWA REST API.
3. **Configure User Permissions (Bulk or Individual):**
   - Go to the **Whitelisted Users** tab.
   - Use the **Table Header Select-All Checkboxes** (`📖 Strategy Catalog` and `📔 Trade Journal`) to toggle access for all users at once, or toggle individual user checkboxes.
   - Changes persist immediately to Redis (`user_permissions` hash via `/api/admin/save.js`).

---

## Step 6: Custom Domain & SSL Configuration

1. In Vercel Console, open your project -> **Settings** -> **Domains**.
2. Add your custom domain (e.g., `tts.yourdomain.com`).
3. Configure your DNS provider with the CNAME/A records provided by Vercel.
4. Update your Telegram Bot webhook URL if using a custom domain.

---

## Step 7: Ongoing Maintenance & Incident Recovery

- **Deploying Code Updates:** Push code changes to GitHub `main` branch (`git push origin main`). Vercel will automatically trigger a production deployment.
- **Export Database Backup:** Periodically open `/admin.html` -> **Whitelisted Users** and click `📥 Export JSON` to backup `whitelist.json`.
- **Clear Audit Logs:** In Admin panel -> **Auth Audit Logs**, tap `🗑️ Clear Logs` if log size reaches 1,000 entries.
- **Force Re-sync Database:** In Admin panel -> **Database Sync**, tap `🔄 Force Re-sync Vercel KV` to force-sync strategies, holidays, and whitelist from codebase.
