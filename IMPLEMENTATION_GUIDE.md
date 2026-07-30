# 📘 TTS Strategy Calendar — Comprehensive Implementation & Deployment Guide

This guide provides a complete, step-by-step technical implementation, architecture, and deployment reference for the **TTS Strategy Calendar & Capital Allocation System**, assuming you have access to the source code repository on GitHub.

---

## 📑 Table of Contents
1. [Architecture Overview & Technology Stack](#1-architecture-overview--technology-stack)
2. [Database & Environment Variables Configuration](#2-database--environment-variables-configuration)
3. [Telegram Authentication Setup (`@TTSStrategiesBot`)](#3-telegram-authentication-setup-ttsstrategiesbot)
4. [PIN Authentication & User Whitelist Management](#4-pin-authentication--user-whitelist-management)
5. [Admin Facilities & Security Controls](#5-admin-facilities--security-controls)
6. [Strategy Engine & Calculation Logic (`strategies.js`, `holidays.js`, `app.js`)](#6-strategy-engine--calculation-logic)
7. [Knowledge Base & Notes System (`notes.js`, `api/notes.js`)](#7-knowledge-base--notes-system)
8. [Capital Allocation & Expected RoI Planner (`capital-planner-data.js`)](#8-capital-allocation--expected-roi-planner)
9. [Step-by-Step Vercel Deployment Guide](#9-step-by-step-vercel-deployment-guide)
10. [Troubleshooting & Maintenance Checklist](#10-troubleshooting--maintenance-checklist)

---

## 1. Architecture Overview & Technology Stack

The application is engineered as a zero-dependency, ultra-fast web app backed by Vercel Serverless Node.js functions and Upstash Redis Key-Value (KV) database.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            FRONTEND (Static / Edge)                         │
│  - index.html (Main Calendar, Flow View & Capital Planner)                  │
│  - login.html (Telegram QR & International Phone Auth)                      │
│  - loginpin.html (6-Digit PIN Auth Portal)                                  │
│  - admin.html (Admin Control Panel)                                         │
│  - app.js, notes.js, strategies.js, holidays.js, capital-planner-data.js     │
└───────────────────────┬─────────────────────────────────────────────────────┘
                        │ HTTP / REST APIs
┌───────────────────────▼─────────────────────────────────────────────────────┐
│                     BACKEND (Vercel Serverless Functions)                   │
│  - /api/login.js (Telegram token polling & JWT session generation)          │
│  - /api/telegram-webhook.js (Telegram bot updates & contact validation)    │
│  - /api/login-pin.js (6-digit PIN validation & auth audit logging)          │
│  - /api/data.js (Session validation & index/holiday metadata delivery)      │
│  - /api/notes.js (CRUD operations for strategy knowledge base)             │
│  - /api/admin/login.js, save.js, get.js (Admin management endpoints)        │
└───────────────────────┬─────────────────────────────────────────────────────┘
                        │ Upstash Redis REST API
┌───────────────────────▼─────────────────────────────────────────────────────┐
│                          PERSISTENCE LAYER (Upstash Redis)                  │
│  - Key `whitelist` (Hash): Phone numbers -> 6-digit PINs                    │
│  - Key `auth_token:<token>` (KV): Transient Telegram authentication tokens  │
│  - Key `tg_session:<chatId>` (KV): Active Telegram chat sessions            │
│  - Key `tg_user:<fromId>` (KV): Telegram User ID -> Phone mapping           │
│  - Key `auth_audit_logs` (List): Circular log of last 1000 login events     │
│  - Key `app_notes` (KV JSON): Knowledge base articles                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Database & Environment Variables Configuration

The application relies on 5 core environment variables configured in Vercel or local `.env` files.

### 🔑 Environment Variables Table

| Variable Name | Required | Description | Sample / Default Value |
|---|---|---|---|
| `JWT_SECRET` | **Yes** | HMAC-SHA256 key for signing user `session_token` cookies (30-day validity). | `TTS_STRATEGIES_SECURE_KEY_2026_JULY` |
| `ADMIN_JWT_SECRET` | **Yes** | HMAC-SHA256 key for signing `admin_token` cookies (2-hour validity). | `TTS_STRATEGIES_ADMIN_SECURE_KEY_2026` |
| `ADMIN_PASSWORD` | **Yes** | Master password to access `/admin.html` and admin features. | `admin123` |
| `TELEGRAM_BOT_TOKEN` | **Yes** | Bot API Token issued by `@BotFather` on Telegram. | `7123456789:AAE...` |
| `KV_REST_API_URL` | **Yes** | Upstash Redis REST Endpoint URL. | `https://...upstash.io` |
| `KV_REST_API_TOKEN` | **Yes** | Upstash Redis REST Authorization Bearer Token. | `AX...` |

> [!IMPORTANT]
> If `KV_REST_API_URL` or `KV_REST_API_TOKEN` are not set, the app falls back to reading local file mockups (`whitelist.json`, `auth_logs.json`). For multi-user production environments, Upstash Redis **must** be connected.

---

## 3. Telegram Authentication Setup (`@TTSStrategiesBot`)

The Telegram authentication mechanism allows users to log in securely without entering passwords, by sharing their verified Telegram contact card.

```
User (Browser)               Serverless API (/api)             Telegram Bot API               Upstash Redis (KV)
     │                                │                                │                               │
     │ 1. Open login.html             │                                │                               │
     │─── Click "Verify Telegram" ───►│                                │                               │
     │                                │ 2. Gen 32-char token           │                               │
     │                                │─── SET auth_token:<token> ────────────────────────────────────►│
     │◄── Return token & tg url ──────│                                │                               │
     │                                                                 │                               │
     │ 3. Click t.me/TTSStrategiesBot?start=<token>                   │                               │
     │────────────────────────────────────────────────────────────────►│                               │
     │                                                                 │ 4. Webhook Trigger            │
     │                                                                 │── POST /api/telegram-webhook ─►│
     │                                                                 │                               │ 5. Store session
     │                                                                 │◄── SET tg_session:<chatId> ───│
     │                                                                 │                               │
     │ 6. Telegram Bot shows "📱 Share Phone Number" button            │                               │
     │◄────────────────────────────────────────────────────────────────│                               │
     │                                                                 │                               │
     │ 7. User taps "📱 Share Phone Number"                            │                               │
     │────────────────────────────────────────────────────────────────►│                               │
     │                                                                 │ 8. Webhook Contact Payload    │
     │                                                                 │── POST /api/telegram-webhook ─►│
     │                                                                 │                               │ 9. Verify whitelist &
     │                                                                 │                               │    set verified: true
     │                                                                 │◄── SET auth_token:<token> ────│
     │                                                                 │                               │
     │ 10. Web Portal Polls /api/login?check_token=<token>             │                               │
     │────────────────────────────────────────────────────────────────────────────────────────────────►│
     │◄── Status: verified=true, Set-Cookie: session_token ────────────────────────────────────────────│
     │                                                                                                 │
     │ 11. Redirect to /index.html                                                                     │
```

### 🔨 Step-by-Step Telegram Bot Setup

1. **Create the Bot on Telegram:**
   - Open Telegram and search for **`@BotFather`**.
   - Send `/newbot`.
   - Name: `TTS Strategies Bot`
   - Username: `TTSStrategiesBot` (or your custom bot username).
   - Copy the API Token (e.g. `7123456789:AAF...`).

2. **Configure Bot Commands & Description:**
   - Send `/setdescription` to `@BotFather` and enter:
     `Official Authentication Bot for TTS Options Strategy Calendar.`

3. **Set Up the Webhook URL:**
   Execute the following command in your terminal (replace `<BOT_TOKEN>` and `<YOUR-DOMAIN>`):
   ```bash
   curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
        -H "Content-Type: application/json" \
        -d '{"url": "https://<YOUR-DOMAIN>/api/telegram-webhook"}'
   ```
   *Expected Response:*
   ```json
   {"ok": true, "result": true, "description": "Webhook was set"}
   ```

4. **Phone Number Normalization Rules:**
   All phone numbers are automatically normalized to international E.164 format before checking whitelist:
   - Input: `9876543210` $\rightarrow$ Normalized: `+919876543210`
   - Input: `+14155552671` $\rightarrow$ Normalized: `+14155552671`

---

## 4. PIN Authentication & User Whitelist Management

For users who prefer traditional 6-digit PIN entry, the app provides `/loginpin.html`.

### 📌 Architecture of PIN Authentication (`/api/login-pin.js`)

1. **User Request:** User submits mobile number and 6-digit PIN at `/loginpin.html`.
2. **Phone Normalization:** Input phone is converted to `+<country_code><number>`.
3. **Database Hash Lookup:** API executes Upstash Redis query: `HGET whitelist +919876543210`.
4. **Validation & Token Issuance:**
   - If PIN matches: Generates a 30-day HMAC-signed JWT payload containing `{ phone, expires }`.
   - Writes HTTP-only `session_token` cookie:
     ```http
     Set-Cookie: session_token=<base64_jwt>; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000
     ```
   - Logs login event to `auth_audit_logs` list in Redis.

### 📋 Whitelist Storage Model (`whitelist.json` / Redis `whitelist`)

Whitelisted users are stored in a Redis Hash structure named `whitelist`:
```json
{
    "+919876543210": "123456",
    "+919811122233": "654321",
    "+14155552671": "888999"
}
```

---

## 5. Admin Facilities & Security Controls

The Admin Control Panel at `/admin.html` gives site administrators full control over users, PINs, strategy data, and notes.

```
                             /admin.html (Browser)
                                       │
                                       ▼
                       POST /api/admin/login (Password)
                                       │
                 ┌─────────────────────┴─────────────────────┐
                 ▼                                           ▼
       Invalid Password                            Success (200 OK)
     401 Unauthorized                      Set-Cookie: admin_token (2 Hours)
                                                             │
                 ┌───────────────────────────────────────────┼───────────────────────────────────────────┐
                 ▼                                           ▼                                           ▼
      GET /api/admin/get                          POST /api/admin/save                       POST /api/admin/save
   (Action: get_all_data)                      (Action: add_whitelist)                    (Action: save_strategies)
  - Fetches whitelist & PINs                 - Adds/Updates user PIN                    - Overwrites strategiesData
  - Fetches audit logs                       - Updates Redis Hash                       - Generates strategies.js
```

### 🛡️ Admin Capabilities Summary

1. **User Whitelist & PIN Management:**
   - Add new users with custom 6-digit PINs.
   - Modify existing user PINs.
   - Delete users from whitelist.

2. **Audit Logging (`auth_audit_logs`):**
   - Displays real-time log of the last 100 login attempts with timestamps and authentication method (`Telegram`, `PIN`).

3. **Master Strategy Management (`strategies.js`):**
   - Edit strategy setup legs, credit ranges, DTE, exit rules, and deployment rules directly from the Admin portal.
   - Export parsed `strategies.js` file for local repository backups.

4. **Feature Lock Control (e.g. `💰 Capital Planner`):**
   - Restricts sensitive or preview features (`Capital Allocation Planner`) strictly to authenticated Admin sessions (`isAdminMode === true`).

---

## 6. Strategy Engine & Calculation Logic

The core trading calculation engine consists of three files working in tandem: `strategies.js`, `holidays.js`, and `app.js`.

### 📊 Master Strategy Registry (`strategies.js`)
Contains 14 option trading strategies categorized into 3 priority buckets:

1. **Priority 1 — Monthly Strategies (68% Avg Allocation Base):**
   - `Batman 1:3:2` (Nifty, 39-44 DTE, PE & CE)
   - `No Brainer (Nifty)` (Nifty, 29-34 DTE, CE Only)
   - `No Brainer (Bank Nifty)` (Bank Nifty, 12 DTE, CE Only)
   - `HNI (Nifty)` (Nifty, 39-44 DTE, CE Only)
   - `Auto-Pilot` (Fin Nifty, 12 DTE, CE Only)
   - `Double Decker` (Nifty, 39-43 DTE, PE & CE)

2. **Priority 2 — Weekly Strategies (24% Avg Allocation Base):**
   - `HNI` (Nifty, 8 DTE, CE Only)
   - `Blaze Butterfly` (Nifty, 8 DTE, PE Only)
   - `BWB` (Nifty, 12 DTE, PE Only)
   - `Broken Wing` (Sensex, 7 DTE, PE Only)

3. **Priority 3 — STBT Strategies (8% Avg Allocation Base):**
   - `Nifty 3D Ladder` (Nifty, 3 DTE, CE Only)
   - `Matrix Calendar` (Nifty, 11 DTE, CE Only)
   - `CE Dominator` (Nifty, 2 DTE, CE Only)
   - `Sensex No brainer` (Sensex, 6 DTE, CE Only)
   - `Fin Nifty 2D Ladder` (Fin Nifty, 2 DTE, CE Only)

### 🗓️ Holiday Shift Engine (`holidays.js`)
Contains NSE/BSE market trading holidays for 2026 (`marketHolidays2026`).
- **Preceding Shift Rule:** If a target deployment date falls on a market holiday, the engine automatically shifts the trade to the **preceding trading day**.
- **Visual Holiday Indicator:** Shifted trades display a prominent orange **`⚠️ Holiday Shifted`** badge in calendar cells and strategy detail popups.

### 🧮 Interactive ATM Option Calculator (`app.js`)
When inspecting any strategy popup, the engine dynamically calculates concrete option strike prices based on the index ATM value input:
- **Nifty Step Size:** 50 points (Default ATM: `25,000`)
- **Bank Nifty Step Size:** 100 points (Default ATM: `56,000`)
- **Fin Nifty Step Size:** 50 points (Default ATM: `25,000`)
- **Sensex Step Size:** 100 points (Default ATM: `87,000`)

---

## 7. Knowledge Base & Notes System

The Knowledge Base (`notes.js` and `/api/notes.js`) provides an interactive split-view documentation system integrated directly inside the app.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 📖 App Strategy Notes & Knowledge Base (25% / 75% Split View)              │
├──────────────────────────────┬──────────────────────────────────────────────┤
│ SIDEBAR (25% Width)          │ MAIN PANE (75% Width)                        │
│                              │                                              │
│ 📌 Generic Rules             │ # General Margin & Adjustment Rules          │
│  - Margin & Credit Rules     │                                              │
│  - Gap Up Protocols          │ ### 1. Credit Range & Margin Controls        │
│                              │ - Target Credit: Always aim for 5% to 6%.    │
│ 🎯 Strategy Blueprints       │ - Refinement Rule: If credit > 6%, shift...  │
│  - Batman 1:3:2              │                                              │
│  - No Brainer (Nifty)        │ [✏️ Edit Note] [🗑️ Delete] (Admin Only)      │
│  - Auto-Pilot                │                                              │
└──────────────────────────────┴──────────────────────────────────────────────┤
│ 💡 Pro Tip: Paste screenshots directly into markdown editor using Ctrl + V  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 💡 Markdown & Image Upload Support
- Built-in GitHub-Flavored Markdown preview renderer.
- Support for alert callouts (`> [!NOTE]`, `> [!IMPORTANT]`, `> [!TIP]`, `> [!WARNING]`).
- **Direct Clipboard Image Support:** Admins can paste screenshots (`Ctrl + V`) directly into the markdown textarea; images are converted into base64 strings and stored inside note content.

---

## 8. Capital Allocation & Expected RoI Planner

The **Capital Allocation & Expected RoI Planner** (`capital-planner-data.js`, `index.html`, `app.js`) simulates 100% week-by-week capital utilization across all 14 strategies to eliminate idle margin leakage.

### 📐 Mathematical Expectancy Formula
For each strategy priority bucket ($i$), given Total Account Capital ($C$), Max Potential Profit Percentage ($M_i$), and Assumed Win Rate ($W_i$):

$$\text{Expectancy Factor } (E_i) = (2 \times W_i) - 1$$

$$\text{Expected Net Monthly Profit (₹)} = \left( \frac{C \times M_i}{100} \right) \times E_i$$

$$\text{Expected Net Monthly Return (\%)} = M_i \times E_i$$

$$\text{Annualized Return (₹)} = \text{Expected Net Monthly Profit (₹)} \times 12$$

### 📊 Benchmark Values (₹ 50,00,000 Capital Base)

- **Total Capital Base:** ₹ 50,00,000 (₹ 50 Lakhs)
- **Max Monthly Potential Profit (100% Target):** ₹ 1,64,200 (3.28% / month)
- **Priority 1 (80% Win Rate):** ₹ 57,000 net profit (1.14% RoI)
- **Priority 2 (75% Win Rate):** ₹ 27,000 net profit (0.54% RoI)
- **Priority 3 (70% Win Rate):** ₹ 6,080 net profit (0.12% RoI)
- **Total Expected Net Monthly Profit:** **₹ 90,080 / month (1.80% / month)**
- **Annualized Expected Return:** **₹ 10,80,960 / year (21.60% / annum)**

---

## 9. Step-by-Step Vercel Deployment Guide

Follow these steps to deploy your repository from GitHub to Vercel in production.

### Step 1: Create Upstash Redis Database
1. Go to [Upstash Console](https://console.upstash.com/) and create a new Redis database named `tts-strategies-kv`.
2. Under Database Details, locate **REST API**.
3. Copy **`UPSTASH_REDIS_REST_URL`** and **`UPSTASH_REDIS_REST_TOKEN`**.

### Step 2: Push Repository to GitHub
Ensure your repository contains all source files:
```bash
git add .
git commit -m "Production release: TTS Strategies Calendar v2.0"
git push origin main
```

### Step 3: Create Vercel Project
1. Log into [Vercel Dashboard](https://vercel.com/) and click **Add New > Project**.
2. Select your GitHub repository (`srkdroid/tts-strategies`).
3. Framework Preset: **Other** / **Plain HTML & JavaScript**.
4. Root Directory: `./`

### Step 4: Configure Environment Variables in Vercel
In the Vercel Project Settings under **Environment Variables**, add:

```env
JWT_SECRET=TTS_STRATEGIES_SECURE_KEY_2026_JULY
ADMIN_JWT_SECRET=TTS_STRATEGIES_ADMIN_SECURE_KEY_2026
ADMIN_PASSWORD=YourSecureAdminPassword123!
TELEGRAM_BOT_TOKEN=7123456789:AAE...
KV_REST_API_URL=https://...upstash.io
KV_REST_API_TOKEN=AX...
```

### Step 5: Deploy Project & Register Telegram Webhook
1. Click **Deploy**.
2. Once Vercel finishes building, copy your live domain URL (e.g. `https://tts-strategies.vercel.app`).
3. Register the Telegram Webhook by visiting this URL in your web browser:
   ```text
   https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<YOUR_VERCEL_DOMAIN>/api/telegram-webhook
   ```

---

## 10. Troubleshooting & Maintenance Checklist

### 🔍 Diagnostic Commands & Health Checks

1. **Syntax Verification:**
   Before pushing changes to GitHub, run local syntax checks:
   ```bash
   node -c app.js capital-planner-data.js notes.js strategies.js
   ```

2. **Database Connectivity Verification:**
   If users experience login issues, check Vercel function logs for `KV_DATABASE_UNCONNECTED`. Verify that `KV_REST_API_URL` and `KV_REST_API_TOKEN` are correctly saved in Vercel environment variables.

3. **Telegram Bot Webhook Status Check:**
   To check if your Telegram webhook is active and receiving updates:
   ```text
   https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/getWebhookInfo
   ```

4. **Hard Refresh / Cache Clearing:**
   When deploying UI updates (CSS or JS), advise users to execute a hard refresh (`Ctrl + F5` on Windows or `Cmd + Shift + R` on Mac) to fetch the latest bundled assets.

---

### 🎉 Congratulations!
Your **TTS Strategy Calendar & Capital Allocation System** is now fully documented, configured, and ready for production deployment.
