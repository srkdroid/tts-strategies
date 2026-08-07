# 📘 TTS Strategy Calendar — Comprehensive Implementation & Technical Guide

This guide provides a complete, step-by-step technical implementation reference, system architecture, database schema, API documentation, and feature walkthrough for the **TTS Strategy Calendar, Trade Journal & Capital Allocation System**.

---

## 📑 Table of Contents
1. [Architecture Overview & Technology Stack](#1-architecture-overview--technology-stack)
2. [Database Schema & Redis Key Structures](#2-database-schema--redis-key-structures)
3. [User Access Control & Permission Flags](#3-user-access-control--permission-flags)
4. [Authentication Engine (Telegram OTP & PIN Auth)](#4-authentication-engine-telegram-otp--pin-auth)
5. [Admin Management, WhatsApp Sync & Bulk Permissions](#5-admin-management-whatsapp-sync--bulk-permissions)
6. [Strategy Engine & Master Catalog (Cards & List Views)](#6-strategy-engine--master-catalog-cards--list-views)
7. [Initiate Trade Dispatch & Execution Controls](#7-initiate-trade-dispatch--execution-controls)
8. [Trade Journal & Multi-Level RoI Analytics Engine](#8-trade-journal--multi-level-roi-analytics-engine)
9. [Knowledge Base & Notes System (Cross-Linked Strategy Badge)](#9-knowledge-base--notes-system-cross-linked-strategy-badge)
10. [Capital Allocation & Expected RoI Planner](#10-capital-allocation--expected-roi-planner)
11. [App Guide, UI Design System & Theme Support](#11-app-guide-ui-design-system--theme-support)
12. [Troubleshooting & Maintenance Checklist](#12-troubleshooting--maintenance-checklist)

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
| `app_notes` | **KV JSON** | Array of strategy and generic notes markdown objects with `strategyId` cross-links. |
| `strategies` | **KV JSON** | Master strategy definitions array (Index, Expiry, DTE, Rules, Setup Legs, Notes). |
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
4. **Admin Access & Bulk Management:**
   - Admins automatically receive full access (`{ catalog: true, journal: true }`).
   - Admins can toggle individual permissions or use **Table Header Select-All Checkboxes** (`[x] Strategy Catalog` and `[x] Trade Journal`) for bulk updates across all whitelisted users.

---

## 4. Authentication Engine (Telegram OTP & PIN Auth)

### 📲 Dual Authentication Pathways

1. **Telegram Contact Verification (Zero Password):**
   - User taps **Verify Telegram** on `/login.html`.
   - Redirected to `@TTSStrategiesBot` with a unique transient token.
   - User shares verified contact card. Webhook (`/api/telegram-webhook.js`) verifies contact number against `whitelist` hash and sets session.
2. **6-Digit PIN Verification (`/loginpin.html`):**
   - User submits phone number and 6-digit PIN.
   - `/api/login-pin.js` validates PIN against Redis `whitelist` hash without IP rate-limiting locks.
   - Returns 30-day HTTP-only `session_token` cookie signed via HMAC-SHA256 (`JWT_SECRET`).

---

## 5. Admin Management, WhatsApp Sync & Bulk Permissions

Accessed via `/admin.html` or top bar `⚙️ App Management` button (for logged-in Admins).

### 🛠️ Admin Facilities
- **Whitelisted Users & Bulk Permissions:**
  - View all whitelisted phone numbers and PINs (`👁️ Show` / `🔒 Hide`).
  - Interactive table header select-all checkboxes (`📖 Strategy Catalog` and `📔 Trade Journal`) with full indeterminate state support.
  - Action `bulk_update_user_permissions` in `/api/admin/save.js` updates all whitelisted user records in Redis KV.
  - Add new user, regenerate 6-digit PIN, or remove user.
  - Export active whitelist as `whitelist.json`.
- **📱 WhatsApp Group Sync:**
  - Connects to OpenWA REST API endpoint to pull group participants and auto-whitelist numbers.
- **Strategy & Holiday Configurator:**
  - Edit or add strategies with expanded options:
    - **Deployment Day:** `Mon`, `Tue`, `Wed`, `Thu`, `Fri`, or `Any`.
    - **Position Type:** `Both sides`, `CE Only`, `PE Only`, or `Either CE or PE`.
    - **Setup Notes:** Supports `"notes"` string inside Setup Legs JSON rendered universally for all strategy categories.
  - `z-index: 2000` on `#edit-strategy-modal` ensures child forms stack above the App Management modal.
- **Audit Logs:**
  - View real-time authentication logs with sorting and clear features.

---

## 6. Strategy Engine & Master Catalog (Cards & List Views)

### 🗂️ Dual View Layouts
Users can toggle between two presentation modes in the Strategy Catalog:
1. **🗂️ Cards View:** Rich grid cards displaying strategy details, index badges, DTE entry windows, setup overview (mapping all CE & PE legs with color badges `CE:` `#60a5fa` / `PE:` `#f87171` inside scrollable containers), setup notes, and rule highlights.
2. **📋 List View:** High-density table view rendering Strategy Name, Category Badge, Index/Expiry, DTE/Entry, Setup Overview snippet, and View Details action button.

### 📊 Strategy Classification
- `⚡ 0-Adjustment Strategies` (Non-Discretionary rule-based strategies)
- `🎯 Discretionary Strategies` (Rule-guided discretionary strategies)
- `🛠️ Adjustment & Repair Protocols` (Trade repair and defensive adjustment rules)

---

## 7. Initiate Trade Dispatch & Execution Controls

Inside the Strategy Details modal, an admin control card labeled **`⚡ Initiate Trade`** provides instant operational execution actions:
- `🚀 Webhook`: Dispatches strategy payload to configured Webhook URL.
- `🔗 Open App`: Opens external trading platform URL pre-populated with strategy parameters.
- `📋 Copy JSON`: Copies strategy setup legs and execution parameters to clipboard.

---

## 8. Trade Journal & Multi-Level RoI Analytics Engine

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

## 9. Knowledge Base & Notes System (Cross-Linked Strategy Badge)

### 📝 Resizable Notes System
- **Normalized Category Grouping:** Left-hand sidebar categorizes all notes into normalized category headers:
  - `📌 GENERIC (N)`
  - `⚡ STRATEGY (N)`
  - `🎯 DISCRETIONARY (N)`
  - `🛠️ ADJUSTMENTS (N)`
- **Collapsible Accordion:** Interactive section headers with arrow indicators (`▼` expanded / `▶` collapsed). Selecting a note auto-expands its parent category.
- **Associated Strategy Cross-Linking:**
  - Dropdown includes default `-- None (Generic / Unlinked) --` option.
  - Preserves `strategyId` association across all note categories (`Strategy`, `Discretionary`, `Adjustments`, `Generic`).
  - Note Reader view displays **`🎯 Open Strategy: <Strategy Name>`** badge whenever `strategyId` is set, allowing 1-click modal navigation.
- **Pro Tip Editor:** Markdown editor with live preview and direct clipboard screenshot paste (`Ctrl + V`).

---

## 10. Capital Allocation & Expected RoI Planner

Integrated sub-tab calculating capital requirements, margin buffers, peak margin utilization, and target RoI across portfolio tiers (Monthly, Bi-Weekly, STBT, Discretionary).

---

## 11. App Guide, UI Design System & Theme Support

- **❓ App Guide Modal:** Comprehensive documentation modal accessible from top bar covering all major features.
- **Logged-In User Badge:** Header bar badge displaying `👤 <phone_number>` next to `🚪 Logout`.
- **Theme Support & Beta Badge:**
  - Modern dark theme default with glassmorphism and light-theme CSS overrides.
  - High-contrast `.light-theme .beta-badge` styling (`#4338ca` text with explicit `-webkit-text-fill-color` override).
- **Cache Invalidation:** Version query string `?v=3.0` on script and stylesheet links in `index.html`.

---

## 12. Troubleshooting & Maintenance Checklist

| Symptom | Cause | Resolution |
|---|---|---|
| Strategy Catalog / Journal hidden | User permission flag disabled | Admin enables `[x] Catalog` or `[x] Journal` in App Management -> Whitelisted Users. |
| Timeframe dropdown text unreadable | Missing option text contrast | Fixed with global `select option` high-contrast styling in `style.css`. |
| Add Strategy modal behind App Management | Z-index stacking issue | Fixed with `z-index: 2000` on `#edit-strategy-modal`. |
| Beta badge text invisible in light theme | WebKit `-webkit-text-fill-color: transparent` inherited from `h1` | Fixed with explicit `-webkit-text-fill-color: #4338ca` in `style.css`. |
| View Details modal unresponsive | `TypeError: legsContainer.appendChild(leg)` (string instead of Node) | Fixed to `legsContainer.appendChild(li)` in `app.js`. |
| Note strategy link missing | Category restricted to `'Strategy'` | Updated `renderNoteViewer()` to show `🎯 Open Strategy` whenever `note.strategyId` exists. |
| Setup note missing in multi-leg modal | Setup note renderer trapped inside single-sided `else` block | Moved setup note rendering outside `if/else` block in `app.js`. |
