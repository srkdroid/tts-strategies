# 📘 TTS Strategy Calendar — Comprehensive Implementation & Technical Guide

This guide provides a complete, step-by-step technical implementation reference, system architecture, database schema, API documentation, and feature walkthrough for the **TTS Strategy Calendar, Trade Journal & Capital Allocation System**.

---

## 📑 Table of Contents
1. [Architecture Overview & Technology Stack](#1-architecture-overview--technology-stack)
2. [Database Schema & Redis Key Structures](#2-database-schema--redis-key-structures)
3. [User Access Control & Permission Flags](#3-user-access-control--permission-flags)
4. [Authentication Engine (Telegram OTP & PIN Auth)](#4-authentication-engine-telegram-otp--pin-auth)
5. [Admin Management, WhatsApp Sync & Security Controls](#5-admin-management-whatsapp-sync--security-controls)
6. [Strategy Engine & Master Catalog (Card & List Views)](#6-strategy-engine--master-catalog-card--list-views)
7. [Trade Journal & Multi-Level RoI Analytics Engine](#7-trade-journal--multi-level-roi-analytics-engine)
8. [Knowledge Base & Notes System (Collapsible Accordion)](#8-knowledge-base--notes-system-collapsible-accordion)
9. [Capital Allocation & Expected RoI Planner](#9-capital-allocation--expected-roi-planner)
10. [App Guide & User Interface Experience](#10-app-guide--user-interface-experience)
11. [Troubleshooting & Maintenance Checklist](#11-troubleshooting--maintenance-checklist)

---

## 1. Architecture Overview & Technology Stack

The application is built using standard HTML5, CSS3, and modern JavaScript (ES6+) backed by Vercel Serverless Functions (Node.js) and an Upstash Redis Key-Value database.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 FRONTEND (Static / Edge)                                    │
│  - index.html (Main Header Nav: Calendar, Flow, Planner, Notes, Catalog, Journal)           │
│  - login.html (Telegram QR & International Phone Auth)                                      │
│  - loginpin.html (6-Digit PIN Auth Portal)                                                  │
│  - admin.html (Admin Management Portal)                                                     │
│  - Client Logic: app.js, notes.js, strategies.js, holidays.js, capital-planner-data.js     │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │ HTTP / REST APIs
┌──────────────────────────────────────────────▼──────────────────────────────────────────────┐
│                            BACKEND (Vercel Serverless Functions)                            │
│  - /api/login.js & /api/login-pin.js (Auth verification & JWT session issuance)             │
│  - /api/telegram-webhook.js (Telegram Bot contact card webhook)                            │
│  - /api/data.js (Session validation, index/holiday metadata & permission flags)             │
│  - /api/journal.js (Trade record CRUD, P&L calculations & journal permission guards)        │
│  - /api/notes.js (Strategy notes CRUD & Markdown knowledge base delivery)                   │
│  - /api/admin/get.js, save.js, whatsapp-sync.js (Admin database & whitelist controls)        │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │ Upstash Redis REST API
┌──────────────────────────────────────────────▼──────────────────────────────────────────────┐
│                                PERSISTENCE LAYER (Upstash Redis)                            │
│  - Hash `whitelist`: Phone numbers -> 6-digit PINs                                          │
│  - Hash `user_permissions`: Phone numbers -> { catalog: boolean, journal: boolean }         │
│  - Hash `user_trades:<phone>`: JSON array of executed trade records                         │
│  - Key `app_notes`: Knowledge base articles JSON array                                      │
│  - Key `auth_audit_logs`: Circular audit list of last 1,000 auth events                     │
│  - Keys `strategies` & `holidays`: Active strategy catalog & holiday configurations         │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Database Schema & Redis Key Structures

All persistent data is stored in Upstash Redis. Below are the key data structures:

### 🔑 Redis Keys & Schemas

| Redis Key | Type | Description / Value Schema |
|---|---|---|
| `whitelist` | **Hash** | Mapping of normalized phone numbers (`+919876543210`) to 6-digit PINs (`123456`). |
| `user_permissions` | **Hash** | Mapping of phone numbers to JSON feature permissions: `{"catalog": true, "journal": true}`. |
| `user_trades:<phone>` | **KV JSON** | Array of trade objects recorded by the user in Trade Journal. |
| `app_notes` | **KV JSON** | Array of strategy and generic notes markdown objects. |
| `strategies` | **KV JSON** | Master strategy definitions array (Index, Expiry, DTE, Rules, Setup). |
| `holidays` | **KV JSON** | Market trading holidays dictionary for calendar calculation. |
| `auth_audit_logs` | **List** | Log entries: `{"phone":"+91...","method":"pin","timestamp":"..."}`. |

---

## 3. User Access Control & Permission Flags

Access to **Strategy Catalog** and **Trade Journal** is strictly regulated per user:

1. **Permission Data Structure:**
   Each whitelisted user has a permissions record stored in Redis hash `user_permissions`:
   ```json
   {
     "catalog": true,
     "journal": true
   }
   ```
2. **Default State for Standard Users:**
   - When a new user is whitelisted, `catalog` and `journal` default to `false`.
   - Top-bar header buttons (`📖 Strategy Catalog` and `📔 Trade Journal`) are hidden (`display: none`).
   - If an un-permissioned user attempts to navigate to these views, the client blocks access and redirects to `Calendar`.
3. **Server-Side Authorization Enforcement:**
   - `/api/data.js` returns `permissions` in `/api/check-auth`.
   - `/api/journal.js` verifies `permissions.journal === true` before serving or saving trade records. Returns `403 Forbidden` if unauthorized.
4. **Admin Access:**
   - Admins automatically receive full access (`{ catalog: true, journal: true }`).
   - Admins manage user access via live toggle checkboxes in **App Management -> Whitelisted Users**.

---

## 4. Authentication Engine (Telegram OTP & PIN Auth)

### 📲 Dual Authentication Pathways

1. **Telegram Contact Verification (Zero Password):**
   - User taps **Verify Telegram** on `/login.html`.
   - Redirected to `@TTSStrategiesBot` with a unique transient token.
   - User shares verified contact card. Webhook (`/api/telegram-webhook.js`) verifies contact number against `whitelist` hash and sets session.
2. **6-Digit PIN Verification (`/loginpin.html`):**
   - User submits phone number and 6-digit PIN.
   - `/api/login-pin.js` validates PIN against Redis `whitelist` hash.
   - Returns 30-day HTTP-only `session_token` cookie signed via HMAC-SHA256 (`JWT_SECRET`).

---

## 5. Admin Management, WhatsApp Sync & Security Controls

Accessed via `/admin.html` or top bar `⚙️ App Management` button (for logged-in Admins).

### 🛠️ Admin Facilities
- **Whitelisted Users Management:**
  - View all whitelisted phone numbers and PINs (`👁️ Show` / `🔒 Hide`).
  - Toggle feature access checkboxes: `[x] Strategy Catalog` and `[x] Trade Journal`.
  - Add new user, regenerate 6-digit PIN, or remove user.
  - Export active whitelist as `whitelist.json`.
- **📱 WhatsApp Group Sync:**
  - Connects to OpenWA REST API endpoint to pull group participants and auto-whitelist numbers.
- **Strategy & Holiday Configurator:**
  - Edit or add strategies with strategy categories (`0_adjustment`, `discretionary`, `adjustments`).
  - Set `z-index: 2000` to allow child modal dialogs (`+ Add New Strategy`) to stack cleanly above App Management modal.
- **Audit Logs:**
  - View real-time authentication logs with sorting and clear features.

---

## 6. Strategy Engine & Master Catalog (Card & List Views)

### 🎴 Dual View Layouts
Users can toggle between two presentation modes in the Strategy Catalog:
1. **🎴 Card View:** Rich grid cards displaying strategy details, index badges, DTE entry windows, setup overview, and rule highlights.
2. **📋 Single Line List View:** Compact, high-density table view rendering Strategy Name, Category Badge, Index/Expiry, DTE/Entry, Overview snippet, and View Details action button.

### 📊 Strategy Classification
- `⚡ 0-Adjustment Strategies` (Non-Discretionary rule-based strategies)
- `🎯 Discretionary Strategies` (Rule-guided discretionary strategies)
- `🛠️ Adjustment & Repair Protocols` (Trade repair and defensive adjustment rules)

---

## 7. Trade Journal & Multi-Level RoI Analytics Engine

### 📔 Trade Journal Features
- **Record Live Trades:** Record strategy name, entry/exit dates, margin utilized, status (`OPEN` / `CLOSED`), leg strikes/quantities/entry/exit prices, brokerage, taxes, and 3-way operational notes.
- **Interactive Record Editing:** Full support to edit open or closed trade records via `editTradeRecord(tradeId)`.
- **Sub-Tabs:** `All Trades`, `Open Positions`, `Closed Trades`, and `Performance & RoI Analytics`.

### 📈 Multi-Level RoI Analytics Sub-Tab
Computes real-time performance metrics across 4 structured analytical levels:
1. **Multi-Level Performance Summary:** Total Realized Net P&L (₹), Portfolio Realized RoI %, Win Rate %, Profit Factor, and Total Brokerage & Taxes.
2. **Category Level RoI Breakdown:** Monthly, Bi-Weekly/Weekly, STBT, and Discretionary category performance.
3. **Strategy Level Performance & RoI:** Win Rate %, Margin Used, Net P&L, and Realized RoI % per strategy.
4. **Timeframe Performance Breakdown:** Performance breakdown selectable by `Monthly`, `Weekly`, `Daily`, `Quarterly`, or `Annually`. High-contrast dropdown styling for dark/light themes.

---

## 8. Knowledge Base & Notes System (Collapsible Accordion)

### 📝 Resizable Notes System
- **Normalized Category Grouping:** Left-hand sidebar categorizes all notes into normalized category headers:
  - `📌 GENERIC (N)`
  - `⚡ STRATEGY (N)`
  - `🎯 DISCRETIONARY (N)`
  - `🛠️ ADJUSTMENTS (N)`
- **Collapsible & Expandable Accordion:** Interactive section headers with arrow indicators (`▼` expanded / `▶` collapsed). Clicking a header toggles list items. Selecting a note auto-expands its parent category.
- **Pro Tip Editor:** Markdown editor with live preview and direct clipboard screenshot paste (`Ctrl + V`).

---

## 9. Capital Allocation & Expected RoI Planner

Integrated sub-tab calculating capital requirements, margin buffers, peak margin utilization, and target RoI across portfolio tiers (Monthly, Bi-Weekly, STBT, Discretionary).

---

## 10. App Guide & User Interface Experience

- **❓ App Guide Modal:** Comprehensive documentation modal accessible from top bar covering all 9 major features.
- **Logged-In User Badge:** Header bar badge displaying `👤 <phone_number>` next to `🚪 Logout`.
- **Theme Support:** Modern dark theme default with glassmorphism and full light-theme CSS overrides.

---

## 11. Troubleshooting & Maintenance Checklist

| Symptom | Cause | Resolution |
|---|---|---|
| Strategy Catalog / Journal hidden | User permission flag disabled | Admin enables `[x] Catalog` or `[x] Journal` in App Management -> Whitelisted Users. |
| Timeframe dropdown text unreadable | Missing option text contrast | Fixed with global `select option` high-contrast styling in `style.css`. |
| Add Strategy modal behind App Management | Z-index stacking issue | Fixed with `z-index: 2000` on `#edit-strategy-modal`. |
| Analytics table empty | JavaScript exception in loop | Resolved with `sWinRate` calculation guard in `app.js`. |
