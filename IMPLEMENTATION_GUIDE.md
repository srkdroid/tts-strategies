# 📘 TTS Strategy Calendar — Comprehensive Implementation & Architecture Guide

**Version**: 5.6  
**Last Updated**: August 2026  
**Repository**: `srkdroid/tts-strategies`  
**Hosting Platform**: Vercel Serverless (Node.js) + Upstash Redis (Serverless KV)

---

## 📑 Table of Contents
1. [Architecture Overview & Technology Stack](#1-architecture-overview--technology-stack)
2. [Database Schema & Redis Key Structures](#2-database-schema--redis-key-structures)
3. [User Access Control, Authentication & Rate Limiting](#3-user-access-control-authentication--rate-limiting)
4. [Authenticated Private Media Store (WebP Compression)](#4-authenticated-private-media-store-webp-compression)
5. [Frontend Modules & State Architecture](#5-frontend-modules--state-architecture)
6. [Strategy Engine & Dynamic Calendar Scheduling](#6-strategy-engine--dynamic-calendar-scheduling)
7. [Trade Journal & Multi-Level RoI Analytics Engine](#7-trade-journal--multi-level-roi-analytics-engine)
8. [Knowledge Base & Notes System](#8-knowledge-base--notes-system)
9. [Capital Allocation & Expected RoI Planner](#9-capital-allocation--expected-roi-planner)
10. [Admin Console, WhatsApp Community Sync & SSRF Protection](#10-admin-console-whatsapp-community-sync--ssrf-protection)
11. [Security Hardening & Best Practices](#11-security-hardening--best-practices)
12. [CI/CD & Automated Verification Pipeline](#12-cicd--automated-verification-pipeline)

---

## 1. Architecture Overview & Technology Stack

The application is structured as a high-performance, single-page application (SPA) backed by Vercel Serverless API handlers and an Upstash Redis persistence layer.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 FRONTEND (Static / Edge)                                    │
│  - index.html (Main SPA: Calendar, Flow, Planner, Notes, Catalog, Journal)                  │
│  - login.html (Telegram QR & International Phone Auth)                                      │
│  - loginpin.html (6-Digit PIN Auth Portal)                                                  │
│  - admin.html (System Administration Portal)                                                │
│  - Client Logic: app.js, notes.js, strategies.js, holidays.js, capital-planner-data.js     │
│  - CSS System: style.css (CSS Tokens, Theme Engine, Layout Grids, Responsive Breakpoints)  │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │ HTTPS / REST APIs
┌──────────────────────────────────────────────▼──────────────────────────────────────────────┐
│                            BACKEND (Vercel Serverless Functions)                            │
│  - api/index.js (Central API Router & Endpoint Dispatcher)                                  │
│  - api/_lib/login.js & login-pin.js (Authentication & Rate Limiting)                        │
│  - api/_lib/data.js (Session validation, index spot prices, holiday metadata)               │
│  - api/_lib/journal.js (Trade execution CRUD, P&L calculations, journal permission guards)  │
│  - api/_lib/notes.js (Markdown knowledge base & strategy note cross-links)                  │
│  - api/_lib/upload.js (Authenticated private media storage & image serving)                 │
│  - api/_lib/admin.js (Database management, atomic whitelist saves & OpenWA sync)            │
│  - api/_lib/telegram-webhook.js (Telegram Bot contact card verification)                    │
│  - api/_lib/track.js (User activity logging beacon)                                         │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │ Upstash Redis REST API
┌──────────────────────────────────────────────▼──────────────────────────────────────────────┐
│                                PERSISTENCE LAYER (Upstash Redis)                            │
│  - Hash `whitelist`: Phone numbers -> 6-digit PINs                                          │
│  - Hash `user_permissions`: Phone numbers -> { catalog: boolean, journal: boolean }         │
│  - Hash `user_trades:<phone>`: JSON array of executed trade records                         │
│  - Key `app_notes`: Knowledge base articles JSON array                                      │
│  - Key `media:<img_id>`: Authenticated image JSON { id, mimeType, data, uploadedBy }        │
│  - Key `rate_limit:pin:<phone>`: Atomic rate limiter counter with 15-min TTL                │
│  - Key `auth_audit_logs`: Circular audit list of last 1,000 auth events                     │
│  - Keys `strategies` & `holidays`: Active strategy catalog & holiday configurations         │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Database Schema & Redis Key Structures

All persistent application data is stored in **Upstash Redis**. Below is the master key reference:

| Redis Key | Redis Type | Description & Schema |
|---|---|---|
| `whitelist` | **Hash** | Field: `+919876543210`, Value: `"123456"` (6-digit PIN). |
| `user_permissions` | **Hash** | Field: `+919876543210`, Value: `{"catalog": true, "journal": true}`. |
| `user_trades:<phone>` | **KV (JSON)** | Array of user trade objects (Entry Date, Strategy, Lots, Strikes, P&L, Status). |
| `app_notes` | **KV (JSON)** | Array of strategy and generic notes markdown objects with `strategyId` cross-links. |
| `media:<img_id>` | **KV (JSON)** | `{ "id": "img_...", "mimeType": "image/webp", "data": "<base64>", "uploadedBy": "+91..." }`. |
| `rate_limit:pin:<phone>` | **String (Int)** | Integer counter with 900s (15m) TTL. Capped at 5 attempts per window. |
| `strategies` | **KV (JSON)** | Custom / overridden strategy definitions array. |
| `holidays` | **KV (JSON)** | Market trading holidays dictionary for calendar calculation. |
| `auth_audit_logs` | **List** | Log entries: `{"phone":"+91...","method":"pin","timestamp":"..."}`. Max 1,000 entries. |
| `admin_activity_logs` | **List** | User action telemetry logs (Page views, strategy clicks, strike lookups). |

---

## 3. User Access Control, Authentication & Rate Limiting

### Authentication Methods
1. **PIN Login (`loginpin.html` -> `/api/login-pin`)**:
   - International phone number normalization (`+91...`).
   - Atomic Redis rate limiter: `INCR rate_limit:pin:<phone>` with 900s TTL. Blocked after 5 failed attempts with HTTP 429.
   - Verifies against `whitelist` hash in Redis.
   - Issues 30-day HMAC-SHA256 signed `session_token` cookie (`HttpOnly; Secure; SameSite=Strict`).
2. **Telegram OTP (`login.html` -> `/api/login` & `/api/telegram-webhook`)**:
   - Generates random 6-character auth token.
   - User shares Telegram contact card with bot. Webhook verifies phone number against `whitelist` and marks token verified.
   - Client polls `/api/login?token=...` and receives `session_token` cookie.
3. **Admin Auth (`admin.html` -> `/api/admin/login`)**:
   - Verifies master `ADMIN_PASSWORD` from environment.
   - Issues HMAC-SHA256 `admin_token` cookie.

### Feature Access Matrix (`user_permissions`)
- `catalog: true` -> Displays **📖 Strategy Catalog** in navigation.
- `journal: true` -> Displays **📔 Trade Journal** in navigation and unlocks `/api/journal` CRUD endpoints.
- If permissions are revoked, client redirects to Calendar and backend returns `403 Forbidden`.

---

## 4. Authenticated Private Media Store (WebP Compression)

To protect proprietary strategy charts and confidential trading records:

```
[ User Pastes Image (Ctrl+V) ]
            │
            ▼
[ Client WebP Compression ] ──(Max 1920px, 82% quality: 3MB ➔ ~80KB)
            │
            ▼
[ POST /api/upload ] ──(Requires Valid session_token or admin_token)
            │
            ▼
[ Redis: media:img_<id> ] ──(Saves JSON: { id, mimeType, data, uploadedBy })
            │
            ▼
[ Markdown Editor ] ──(Inserts clean link: ![Pasted Screenshot](/api/image?id=img_<id>))
            │
            ▼
[ GET /api/image?id=... ] ──(Validates Session Cookie ➔ Serves WebP Binary Buffer)
```

- **Confidentiality Guaranteed**: Unauthenticated access attempts to `/api/image` return `401 Unauthorized`.
- **Zero Public CDN Leakage**: Images are never exposed on public cloud buckets or CDNs.
- **Ultra-Lightweight Notes**: Notes JSON in Redis only contains 30-byte relative image URLs instead of multi-megabyte Base64 strings.

---

## 5. Frontend Modules & State Architecture

| File | Purpose |
|---|---|
| `index.html` | Semantic single-`<main>` dashboard structure with 6 view sections (`#calendar-view-container`, `#capital-flow-view-container`, `#capital-planner-view-container`, `#notes-view-container`, `#catalog-view-container`, `#journal-view-container`). |
| `app.js` | Core application controller: calendar grid rendering with $O(1)$ Map pre-indexing, strategy modal strike calculator, capital flow Gantt timeline, trade journal analytics engine, and view routing. |
| `notes.js` | Knowledge base manager: multi-category sidebar tree, marked.js markdown rendering with DOMPurify sanitization, paste image handler, and capital allocation guidance deep-linking. |
| `strategies.js` | Master options strategy definitions (leg configurations, ATM offset rules, DTE, target SL/profits, repair guides). |
| `holidays.js` | NSE/BSE market holiday calendar and date shift calculation algorithms (`getHolidayOrWeekend`, `getPreviousTradingDay`). |
| `capital-planner-data.js` | Mathematical capital allocation matrix, priority bucket sequencing (P1 Monthly, P2 Bi-Weekly, P3 STBT), and RoI expectancy formulas. |
| `style.css` | Complete design system with CSS custom property tokens, dark/light theme definitions, responsive layouts, and modal dialog styles. |

---

## 6. Strategy Engine & Dynamic Calendar Scheduling

1. **Expiry & Deployment Calculation**:
   - Evaluates each strategy's deployment timing, index, and DTE.
   - Checks against market holidays. If a scheduled deployment or expiry falls on a trading holiday, dates automatically shift backward to the previous valid trading session (`getPreviousTradingDay`).
2. **Performance Optimization ($O(1)$ Indexing)**:
   - `renderCalendar()` pre-indexes full-year deployments into date-keyed `Map` objects (`deploysByActualDate` and `deploysByExitDate`).
   - Eliminates nested filtering loops, allowing instantaneous rendering across all 3 visible monthly grids.

---

## 7. Trade Journal & Multi-Level RoI Analytics Engine

- **Trade Recording**: Live modal (`#trade-modal`) auto-populates option legs and calculate margin based on selected strategy.
- **Exit Recording**: `#trade-exit-modal` records exit prices, brokerage fees, computes Net P&L and realized RoI %.
- **Performance Analytics**:
  - Win Rate %, Profit Factor, Max Drawdown, Expectancy Ratio.
  - Strategy-wise and category-wise performance breakdown tables.
  - Monthly P&L bar charts and cumulative equity curve visualization.

---

## 8. Knowledge Base & Notes System

- **Category Normalization**: Auto-categorizes notes into `📌 Generic`, `⚡ Strategy`, `🎯 Discretionary`, `🛠️ Adjustments`, and `📁 Custom`.
- **Strategy Deep-Linking**: Clicking **📖 Notes** on any strategy card or modal opens the exact corresponding guidance note.
- **Search Debouncing**: 200ms debounce timer prevents DOM re-creation spikes during typing.
- **Sanitization Guard**: Enforces `DOMPurify.sanitize(marked.parse(content))` to prevent stored XSS vulnerabilities.

---

## 9. Capital Allocation & Expected RoI Planner

- Master portfolio model (Default ₹50,00,000) structured across 3 priority buckets:
  - **P1: Monthly Non-Directional** (68% allocation, 80% win rate target)
  - **P2: Weekly Directional** (24% allocation, 75% win rate target)
  - **P3: STBT Positional** (8% allocation, 70% win rate target)
- Mathematical RoI expectancy formula:
  $$\text{Expectancy} = (\text{WinRate} \times \text{AvgWin}) - (\text{LossRate} \times \text{AvgLoss})$$
- Week-by-week heatmap matrix illustrating optimal margin deployment across expiry weeks.

---

## 10. Admin Console, WhatsApp Community Sync & SSRF Protection

- **Atomic Whitelist Saves**: Admin console writes user whitelists via single batched `HSET` operations, eliminating auth blackout windows.
- **OpenWA WhatsApp Sync**: Syncs phone numbers from active trading community groups.
- **SSRF Protection Engine**:
  - Enforces strict URL scheme validation (`http://` or `https://`).
  - Blocks private IP subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
  - Blocks loopback addresses (`127.0.0.1`, `localhost`, `[::1]`) and cloud metadata endpoints (`169.254.169.254`).

---

## 11. Security Hardening & Best Practices

| Security Domain | Protection Implemented |
|---|---|
| **Credentials in Git** | `whitelist.json` and `.env` removed from Git tracking and added to `.gitignore`. |
| **Secrets Management** | Zero fallback secrets in code; all secrets strictly required via environment variables. |
| **Brute-Force Defense** | Redis-based atomic rate limiter on PIN logins (5 attempts / 15m window). |
| **SSRF Defense** | Strict IP and host validation on all server-side outbound requests. |
| **XSS Defense** | DOMPurify sanitization on markdown rendering; pinned CDN scripts with SHA-384 SRI hashes. |
| **Session Security** | HMAC-SHA256 signed session tokens in `HttpOnly; Secure; SameSite=Strict` cookies. |
| **Media Privacy** | Authenticated private media store requiring active member login session to view images. |

---

## 12. CI/CD & Automated Verification Pipeline

The repository includes an automated GitHub Actions CI workflow [`.github/workflows/ci.yml`](file:///c:/02-PKM/Projects/TTS-Strategies/.github/workflows/ci.yml):
- Executes on every push to `main` and all pull requests.
- Validates JavaScript syntax across all root scripts (`app.js`, `notes.js`, `holidays.js`, `strategies.js`, `capital-planner-data.js`, `local-server.js`).
- Validates all serverless API handlers in `api/` and `api/_lib/*.js`.
- Prevents syntax errors or broken imports from reaching production deployments.
