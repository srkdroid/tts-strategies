const { verifyToken, verifyAdminToken, parseCookies } = require('./common/auth');
const { queryKV } = require('./common/redis');

const SEED_NOTES = [
    {
        id: "note-master-general-rules",
        title: "General Margin & Adjustment Rules",
        category: "Generic",
        strategyId: null,
        updatedAt: "2026-07-28T10:00:00.000Z",
        content: `# General Margin & Adjustment Rules\n\nWelcome to the **TTS Strategy Knowledge Base**. Below are general operational rules applicable across all index option strategies.\n\n---\n\n### 1. Credit Range & Margin Controls\n- **Target Credit:** Always aim for **5% to 6%** net credit deployment.\n- **Refinement Rule:** If initial credit exceeds **6%**, shift all legs **100 points OTM** until credit falls below 6%.\n- **Adjustment Sequence:** Always adjust the **CE side first**, verify credit, and then shift the **PE side** if necessary.\n\n---\n\n### 2. Market Event & Gap Up Protocols\n> [!IMPORTANT]\n> Avoid STBT deployments prior to major RBI policy announcements or union budget releases.\n\n- **Gap Up Notice:** On 1%+ index gap-up opens, do not panic-exit. Allow **15 minutes** for initial volatility contraction before rolling hedges.\n- **Blue Line Refinement:** Overhedge the CE side such that at the CE Buy strike, the position shows only slightly more loss than the PE side.\n`
    },
    {
        id: "note-batman-guidelines",
        title: "Batman 1:3:2 — Trade Blueprints",
        category: "Strategy",
        strategyId: "monthly-batman",
        updatedAt: "2026-07-28T11:30:00.000Z",
        content: `# Batman 1:3:2 — Operational Guidelines\n\nThe **Batman 1:3:2** strategy is deployed on monthly Nifty options **39 to 44 DTE** before expiry.\n\n---\n\n### 🎯 Leg Structure & Ratios\n- **PE Side:** Buy 1 ATM-400 | Sell 3 ATM-600 | Buy 2 ATM-1400\n- **CE Side:** Buy 1 ATM+400 | Sell 3 ATM+600 | Buy 2 ATM+1400\n\n---\n\n### ⚡ Exit Triggers\n| Parameter | Value | Notes |\n|---|---|---|\n| **Target Profit** | 2.0 % | Exit immediately when target hit |\n| **Stop Loss** | 2.5 % | Mandatory risk cutoff |\n| **Holding Duration** | 10 to 15 days | Hold max until 7th of expiry month |\n\n---\n\n### 📸 Execution Screenshot\n> [!TIP]\n> Keep CE hedge Buy lots adjusted to balance delta profile.\n`
    },
    {
        id: "note-nifty-sniper",
        title: "Sniper Nifty Strategy",
        category: "Discretionary",
        strategyId: "discretionary-nifty-sniper",
        updatedAt: "2026-08-03T17:46:00.000Z",
        content: `# Nifty sniper\n\n### Strategy Overview\n- **"Nifty Sniper"**: discretionary intraday strategy using Fixed Range Volume Profile on Nifty Futures\n- **Core concept**: trade fakeouts at the POC (Point of Control), not breakouts\n- **POC** = price level with maximum contracts traded on the previous day\n- Draw POC the evening before using 5-min chart, first to last candle of prior session\n- After marking the line, delete the volume profile to keep the chart clean\n\n---\n\n### 🎯 Setup & Execution Rules\n- **Instrument**: Credit spread on weekly Nifty options (at-the-money short leg, hedge 200 points away)\n- **Bullish Signal**: Breakdown below POC followed by a fakeout back above POC → Sell ATM Put (Bull Put Spread)\n- **Bearish Signal**: Breakout above POC followed by a fakeout back below POC → Sell ATM Call (Bear Call Spread)\n- **Rule**: Do not trade simple reversals at support/resistance; wait for the trap.\n- **Timing Window**: Only trade signals that trigger **before 1:00 PM**; post-1:00 PM signals are skipped (market needs time to move).\n\n---\n\n### ⚡ Exit Triggers\n- **Target Profit**: 1.0% Profit\n- **Stop Loss**: Recent high/low of the fakeout candle\n`
    },
    {
        id: "note-volcano-calendar",
        title: "Volcano calendar strategy",
        category: "Discretionary",
        strategyId: "discretionary-volcano-calendar",
        updatedAt: "2026-10-03T17:47:00.000Z",
        content: `# Low-VIX Rationale and Strategy Context\n\n- **India VIX stuck at 10–12 for ~1.5 months**: premiums too thin for standard option selling\n- **Both positional and intraday sellers struggling**; cash drag compounds the problem\n- **Volcano Calendar designed to work specifically in this low-IV environment**\n  - Positive Vega means rising IV benefits the trade, not hurts it\n  - Ideal entry: VIX in 10–12 range, where IV expansion is more likely than further compression\n  - Caution: deploying when VIX is already elevated risks Vega working against the position\n\n---\n\n# Strategy Identity and Entry Rules\n\n- **Name**: Volcano Calendar (named for the volcano-shaped payoff graph)\n- **Instrument**: Nifty only\n- **Expiry legs**: monthly + next-month (calendar spread component)\n- **Holding period**: 15–20 days maximum\n- **Entry timing**:\n  - Day: last Friday of the month\n  - Live deployment: 3:30–3:35 PM\n  - Backtest benchmark: 3:16 PM (prior market close time; acceptable to use 3:15 PM+)\n`
    }
];

module.exports = async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const cookies = parseCookies(req.headers.cookie);
    const userPhone = verifyToken(cookies.session_token || cookies.auth_token);
    const isAdmin = verifyAdminToken(cookies.admin_token);

    if (!userPhone && !isAdmin) {
        return res.status(401).json({ error: 'Unauthorized. Please login.' });
    }

    if (!isAdmin) {
        let adminOnlyMode = false;
        try {
            const aomRes = await queryKV(['GET', 'system:admin_only_mode']);
            adminOnlyMode = aomRes === 'true' || aomRes === '1';
        } catch (e) {}

        if (adminOnlyMode) {
            return res.status(503).json({
                error: 'System Under Maintenance',
                maintenance: true,
                adminOnlyMode: true,
                message: 'TTS Strategies is temporarily restricted to administrators.'
            });
        }
    }

    try {
        let notesData = null;
        const kvNotes = await queryKV(['GET', 'notes']);
        if (kvNotes) {
            try {
                notesData = JSON.parse(kvNotes);
            } catch (e) {
                console.error("Corrupted KV notes, falling back to seed:", e);
            }
        }

        if (!notesData || !Array.isArray(notesData) || notesData.length === 0) {
            notesData = SEED_NOTES;
            await queryKV(['SET', 'notes', JSON.stringify(SEED_NOTES)]);
        } else {
            let notesMerged = false;
            SEED_NOTES.forEach(sn => {
                if (!notesData.some(n => n && (n.id === sn.id || n.title === sn.title))) {
                    notesData.push(sn);
                    notesMerged = true;
                }
            });
            if (notesMerged) {
                try {
                    await queryKV(['SET', 'notes', JSON.stringify(notesData)]);
                } catch (e) {
                    console.error("Failed to save merged seed notes:", e);
                }
            }
        }

        // Role-based visibility: non-admins only see public notes
        const visibleNotes = isAdmin ? notesData : notesData.filter(n => !n.isAdminOnly);

        return res.status(200).json({
            success: true,
            notes: visibleNotes,
            isAdmin: isAdmin
        });
    } catch (error) {
        console.error("Failed to fetch notes:", error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
