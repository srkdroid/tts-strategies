# 📖 TTS Strategy Calendar — User Guide & Manual

**Version**: 5.6  
**Audience**: Members, Traders & Administrators

Welcome to the **TTS Strategy Calendar, Trade Journal & Capital Allocation System**! This manual walks you through all views, tools, calculations, and features available in the platform.

---

## 📑 Table of Contents
1. [Getting Started & Authentication](#1-getting-started--authentication)
2. [Navigation & View Modes](#2-navigation--view-modes)
3. [Options Strategy Calendar Grid](#3-options-strategy-calendar-grid)
4. [Capital Flow Timeline (Gantt Chart)](#4-capital-flow-timeline-gantt-chart)
5. [Capital Allocation & Expected RoI Planner](#5-capital-allocation--expected-roi-planner)
6. [Knowledge Base & Strategy Notes](#6-knowledge-base--strategy-notes)
7. [Strategy Master Catalog](#7-strategy-master-catalog)
8. [Trade Journal & Performance Analytics](#8-trade-journal--performance-analytics)
9. [Options Strike Calculator & Strategy Details Modal](#9-options-strike-calculator--strategy-details-modal)
10. [Personalized Portfolio Star Filtering](#10-personalized-portfolio-star-filtering)
11. [Theme Customization (Dark & Light Modes)](#11-theme-customization-dark--light-modes)
12. [Keyboard Shortcuts & Tips](#12-keyboard-shortcuts--tips)

---

## 1. Getting Started & Authentication

The platform supports two convenient login methods:

### Method A: 6-Digit PIN Login (Recommended)
1. Open the login page (`loginpin.html`).
2. Enter your **registered 10-digit mobile number** (e.g. `9876543210`).
3. Enter your **6-digit confidential PIN**.
4. Click **Sign In with PIN**.
   > *Security Note: The system allows up to 5 attempts per 15-minute window before temporarily locking to prevent brute-force attacks.*

### Method B: Telegram OTP Verification
1. Open the Telegram login page (`login.html`).
2. Enter your phone number and click **Verify via Telegram**.
3. Tap the Telegram bot link or scan the QR code.
4. Tap **Share Contact** in the Telegram bot chat.
5. The web page will automatically detect verification and log you in.

---

## 2. Navigation & View Modes

Use the top navigation bar to switch between the 6 primary application views:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  [❓ App Guide] [📝 Notes] [📖 Strategy Catalog] [📔 Trade Journal] [💰 Capital Planner]  [☀️] │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

- **📅 Calendar Grid**: Monthly multi-view calendar showing scheduled trade deployments and expiry dates.
- **📊 Capital Flow**: Gantt timeline showing active overlapping positions throughout the month.
- **💰 Capital Planner**: Mathematical capital allocation matrix and expectancy calculator.
- **📝 Notes & Knowledge Base**: 25/75 split-screen markdown reference with search, strategy deep-linking, and private screenshot uploads.
- **📖 Strategy Catalog**: Filterable card grid and tabular catalog of all 0-Adjustment, Discretionary, and Adjustment strategies.
- **📔 Trade Journal**: Performance tracking log, trade entry/exit records, and RoI analytics dashboard.

---

## 3. Options Strategy Calendar Grid

The Calendar view displays **Current Month**, **Next Month**, and **Previous Month** grids side-by-side:

### Color-Coded Strategy Badges
- 🟣 **Purple**: Monthly Strategies (e.g. Iron Fly, Batman, Iron Condor, Calendar Spread)
- 🔵 **Blue**: Bi-Weekly Strategies
- 🟢 **Emerald**: STBT / Short-Term Positional Strategies
- 🔴 **Red**: Market Holidays (BSE/NSE non-trading days)
- 🟡 **Amber**: Holiday-Shifted Deployments (automatically shifted to the preceding trading day)

### Filter Controls Bar
- **Index Filter**: Filter by `All Indices`, `NIFTY`, `BANKNIFTY`, `FINNIFTY`, `MIDCPNIFTY`, or `SENSEX`.
- **Strategy Type**: Filter by `All Types`, `Monthly`, `Bi-Weekly`, or `STBT`.
- **View Filter**: Display `Both Deployments & Exits`, `Deployments Only`, or `Exits Only`.
- **⭐ My Portfolio Only**: Focus exclusively on your starred watchlist strategies.

---

## 4. Capital Flow Timeline (Gantt Chart)

The **Capital Flow** view plots all strategy deployments as continuous horizontal Gantt bars across the month:
- **Left Edge**: Entry date & time.
- **Bar Width**: Duration in Days to Expiration (DTE).
- **Right Edge**: Exit / Expiry date.
- **Overlap Analysis**: Visually inspect which strategies run concurrently to avoid margin concentration on specific expiry weeks.
- **Month Navigation**: Use **◀ Prev Month** and **Next Month ▶** to navigate forward and backward in time.

---

## 5. Capital Allocation & Expected RoI Planner

The **Capital Allocation Planner** helps you manage portfolio risk across three distinct buckets:

### Priority Sequencing Model (₹50 Lakh Benchmark)
1. **P1 — Monthly Strategies (68% Allocation / ₹34 Lakhs)**: Target 80% Win Rate. Low-maintenance core capital foundation.
2. **P2 — Bi-Weekly Strategies (24% Allocation / ₹12 Lakhs)**: Target 75% Win Rate. Directional momentum and theta capture.
3. **P3 — STBT Positional (8% Allocation / ₹4 Lakhs)**: Target 70% Win Rate. High-turnover overnight alpha.

### Mathematical Expectancy Calculation
The planner computes your portfolio mathematical expectancy factor:
$$\text{Expectancy Factor} = (2 \times \text{Win Rate}) - 1$$

---

## 6. Knowledge Base & Strategy Notes

A built-in markdown editor and knowledge base for trading rules and adjustment playbooks:

### Key Capabilities
- **25/75 Split Screen**: Collapsible category sidebar on the left with instant search filtering; full reading and editing pane on the right.
- **📸 Private Screenshot Pasting (Ctrl+V)**: Paste charts directly from your clipboard. Images are automatically compressed to lightweight WebP format and saved to an **authenticated private store** (only logged-in members can view them).
- **Strategy Cross-Linking**: When viewing any strategy in the Calendar or Catalog, click **📖 Notes** to immediately jump to its specific adjustment playbook.
- **Capital Allocation Guidance**: Click the **"Capital Allocation Guidance"** button in the Capital Planner to open the master sequencing note.

---

## 7. Strategy Master Catalog

The **Strategy Master Catalog** allows comprehensive exploration of all options playbooks:

- **Category Filters**:
  - `⚡ 0-Adjustment`: High-probability mechanical strategies requiring zero active management.
  - `🎯 Discretionary`: Market-condition dependent setups (Trending vs. Range-bound).
  - `🛠️ Adjustments`: Firefighting and profit-locking playbooks (Roll up/down, Debit Invert, Straddle shift).
- **Layout Switcher**:
  - **🗂️ Cards View**: Rich visual cards highlighting ATM strike offsets, DTE, setup legs, and target profit/loss metrics.
  - **📋 List View**: Dense single-line tabular view for rapid cross-strategy comparison.

---

## 8. Trade Journal & Performance Analytics

Track execution discipline and analyze your realized returns:

### Recording a Trade
1. Click **+ Record New Trade**.
2. Select the strategy—the modal automatically populates default index, entry time, and leg configurations.
3. Adjust lot sizes and enter executed option strike prices.
4. Enter deployed margin and click **💾 Save Trade Record**.

### Logging Trade Exit
1. When closing a trade, click **🏁 Exit** on the trade row.
2. Enter exit prices, final exit date/time, and brokerage charges.
3. The system calculates **Gross P&L**, **Net P&L**, and **Realized RoI %**.

### Analytics Sub-Tab
- Track your **Win Rate %**, **Profit Factor**, **Average Win / Average Loss**, and **Cumulative Equity Growth Curve**.

---

## 9. Options Strike Calculator & Strategy Details Modal

Clicking on any strategy badge anywhere in the app opens the **Strategy Detail Modal**:

- **Real-Time ATM Strike Calculator**: Enter the current index spot price (or click **Current Spot**)—the modal automatically calculates all Call (CE) and Put (PE) leg strike prices based on the strategy's exact offset formula.
- **Setup & Rules**: Detailed bulleted guidelines for entry timing, stop loss threshold, profit targets, and exit criteria.
- **Adjustment Playbook**: Step-by-step contingency rules if the market tests your breakeven points.
- **Admin Dispatch (Admins Only)**: Generate pre-formatted execution alerts for instant WhatsApp or Telegram channel broadcast.

---

## 10. Personalized Portfolio Star Filtering

- Click the **⭐ Star Icon** on any strategy card or inside the detail modal to add it to your personal portfolio watchlist.
- Starred preferences are saved in your browser's local storage.
- Toggle the **⭐ My Portfolio** checkbox in the top filter bar to instantly hide all non-starred strategies across the Calendar and Flow timeline.

---

## 11. Theme Customization (Dark & Light Modes)

- Click the **☀️ / 🌙 Theme Button** in the top header.
- **Dark Theme (Default)**: Optimized for multi-monitor trading desks and reduced eye fatigue.
- **Light Theme**: High-contrast, clean paper-like appearance with WCAG AA compliant text contrast.
- Your theme preference is preserved automatically across all pages (`index.html`, `login.html`, `loginpin.html`, `admin.html`).

---

## 12. Keyboard Shortcuts & Tips

| Shortcut / Action | Function |
|---|---|
| `Ctrl + V` (in Notes Editor) | Pastes and auto-compresses clipboard screenshots into secure private WebP media links. |
| `Esc` | Closes any open modal dialog. |
| `Ctrl + Shift + R` | Hard refresh to force browser to load latest cached stylesheets and scripts. |
| Click outside modal | Dismisses the modal backdrop. |
| Horizontal Swipe (on Mobile) | Smoothly scrolls wide calendar tables and flow timeline charts. |
