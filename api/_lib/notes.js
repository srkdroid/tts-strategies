const crypto = require('crypto');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
    throw new Error("JWT_SECRET environment variable is missing");
}

function verifyToken(token) {
    try {
        const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
        const { data, signature } = decoded;
        const hmac = crypto.createHmac('sha256', SECRET);
        hmac.update(data);
        const expectedSignature = hmac.digest('hex');
        if (signature !== expectedSignature) return null;
        
        const { phone, expires } = JSON.parse(data);
        if (!expires || Date.now() > expires) return null;
        return phone;
    } catch (e) {
        return null;
    }
}

const ADMIN_SECRET = process.env.ADMIN_JWT_SECRET;
if (!ADMIN_SECRET) {
    throw new Error("ADMIN_JWT_SECRET environment variable is missing");
}

function verifyAdminToken(token) {
    if (!token) return false;
    try {
        const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
        const { data, signature } = decoded;
        const hmac = crypto.createHmac('sha256', ADMIN_SECRET);
        hmac.update(data);
        const expectedSignature = hmac.digest('hex');
        if (signature !== expectedSignature) return false;
        
        const parsed = JSON.parse(data);
        if (parsed.expires < Date.now()) return false;
        return parsed.role === 'admin';
    } catch (e) {
        return false;
    }
}

function parseCookies(cookieHeader) {
    const list = {};
    if (!cookieHeader) return list;
    cookieHeader.split(';').forEach(cookie => {
        let [name, ...rest] = cookie.split('=');
        name = name?.trim();
        if (!name) return;
        const value = rest.join('=').trim();
        if (!value) return;
        list[name] = decodeURIComponent(value);
    });
    return list;
}

async function queryKV(command) {
    const KV_REST_API_URL = process.env.KV_REST_API_URL;
    const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

    if (!KV_REST_API_URL || !KV_REST_API_TOKEN) {
        return null;
    }

    const response = await fetch(KV_REST_API_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${KV_REST_API_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(command),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data.result;
}

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
    }
];

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const cookies = parseCookies(req.headers.cookie);
    const userPhone = verifyToken(cookies.session_token || cookies.auth_token);
    const isAdmin = verifyAdminToken(cookies.admin_token);

    if (!userPhone && !isAdmin) {
        return res.status(401).json({ error: 'Unauthorized. Please login.' });
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
        }

        return res.status(200).json({
            success: true,
            notes: notesData,
            isAdmin: isAdmin
        });
    } catch (error) {
        console.error("Failed to fetch notes:", error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
