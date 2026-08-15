/**
 * AI Handler — TTS Strategy Co-Pilot, Daily Pre-Market Briefing & Capital Allocation Explainer
 * 
 * Powered by Google Gemini (Gemini 2.5 Flash / Flash-Lite) on Free Tier.
 * 
 * Security & Multi-Tenant Isolation:
 * - getScopedContext(): Single unified context engine strictly isolating admin notes & journal records
 * - Two-tier rate limiting: Global daily circuit breaker (1,300/day) + per-user cap (25/day member, 100/day admin)
 * - Timing-safe CRON_SECRET auth for scheduled briefing triggers
 * - Native Gemini responseSchema JSON output with whitelisted action targets
 * - Prompt injection armor using <retrieved_context> XML boundaries
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { verifyToken, verifyAdminToken, parseCookies } = require('./common/auth');
const { queryKV, queryKVSafe } = require('./common/redis');

// Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const GLOBAL_DAILY_LIMIT = 1300;
const USER_DAILY_LIMIT = 25;
const ADMIN_DAILY_LIMIT = 100;
const RATE_LIMIT_TTL_SECS = 86400; // 24 hours

// Action Whitelists
const ALLOWED_VIEW_TARGETS = ['calendar', 'flow', 'planner', 'notes', 'catalog', 'journal'];

/**
 * Timing-safe comparison of bearer tokens for Cron triggers.
 */
function verifyCronSecret(authHeader) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || !authHeader) return false;
    const expected = Buffer.from(`Bearer ${cronSecret}`);
    const actual = Buffer.from(authHeader);
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
}

/**
 * Two-Tier Rate Limiting Pre-Check & Increment
 * @param {string} phoneKey - '+91...' or 'admin'
 * @param {boolean} isAdmin - Admin flag
 * @returns {Promise<{allowed: boolean, reason?: string}>}
 */
async function checkAndIncrementAiRateLimit(phoneKey, isAdmin) {
    const today = new Date().toISOString().split('T')[0];
    
    // 1. Global Account-Wide Circuit Breaker (Pre-check before per-user increment)
    const globalKey = `rate_limit:ai:global:${today}`;
    const globalCount = await queryKVSafe(['GET', globalKey]);
    if (globalCount && parseInt(globalCount, 10) >= GLOBAL_DAILY_LIMIT) {
        return {
            allowed: false,
            reason: 'Daily system-wide AI quota reached. Standard analytics are displayed below.'
        };
    }

    // 2. Per-User Quota Check
    const userKey = isAdmin ? `rate_limit:ai:admin:${today}` : `rate_limit:ai:user:${phoneKey}:${today}`;
    const userLimit = isAdmin ? ADMIN_DAILY_LIMIT : USER_DAILY_LIMIT;

    const userCount = await queryKVSafe(['INCR', userKey]);
    if (userCount === 1) {
        await queryKVSafe(['EXPIRE', userKey, RATE_LIMIT_TTL_SECS]);
    }

    if (userCount > userLimit) {
        return {
            allowed: false,
            reason: `You have reached your daily limit of ${userLimit} AI queries. Quota resets tomorrow.`
        };
    }

    // Increment global counter
    const gCount = await queryKVSafe(['INCR', globalKey]);
    if (gCount === 1) {
        await queryKVSafe(['EXPIRE', globalKey, RATE_LIMIT_TTL_SECS]);
    }

    return { allowed: true };
}

/**
 * Load master data fallbacks from disk if Redis keys are empty.
 */
function loadDiskFallbacks() {
    let strategies = [];
    let holidays = {};

    try {
        const stratPath = path.join(process.cwd(), 'strategies.js');
        if (fs.existsSync(stratPath)) {
            const content = fs.readFileSync(stratPath, 'utf8');
            const match = content.match(/(?:const|let)?\s*strategiesData\s*=\s*(\[[\s\S]*\])\s*;?/);
            if (match) strategies = JSON.parse(match[1]);
        }
    } catch (e) {}

    try {
        const holPath = path.join(process.cwd(), 'holidays.js');
        if (fs.existsSync(holPath)) {
            const content = fs.readFileSync(holPath, 'utf8');
            const match = content.match(/(?:const|let)\s+marketHolidays2026\s*=\s*(\{[\s\S]*?\});/);
            if (match) holidays = JSON.parse(match[1]);
        }
    } catch (e) {}

    return { strategies, holidays };
}

/**
 * Single Unified Scoped Context Engine
 * 
 * Guarantees that:
 * 1. Non-admin sessions NEVER receive `isAdminOnly: true` notes.
 * 2. Non-journal permitted users NEVER receive `user_trades` context.
 * 3. Search query filters down to top 5 most relevant notes to conserve prompt tokens.
 */
async function getScopedContext(caller, { includeNotes = true, includeTrades = false, query = '' } = {}) {
    const { strategies: diskStrat, holidays: diskHol } = loadDiskFallbacks();

    // 1. Fetch Master Strategies and Holidays
    let strategies = diskStrat;
    let holidays = diskHol;
    try {
        const kvStrat = await queryKV(['GET', 'strategies']);
        if (kvStrat) strategies = JSON.parse(kvStrat);
        const kvHol = await queryKV(['GET', 'holidays']);
        if (kvHol) holidays = JSON.parse(kvHol);
    } catch (e) {}

    // 2. Fetch Notes with Strict Role Scoping
    let permittedNotes = [];
    if (includeNotes) {
        try {
            const kvNotes = await queryKV(['GET', 'notes']);
            let rawNotes = [];
            if (kvNotes) rawNotes = JSON.parse(kvNotes);
            if (Array.isArray(rawNotes)) {
                // Admin gets all notes; regular member only gets public notes
                permittedNotes = caller.isAdmin ? rawNotes : rawNotes.filter(n => !n.isAdminOnly);

                // If query is provided, rank by relevance to top 5
                if (query && query.trim()) {
                    const q = query.toLowerCase();
                    permittedNotes = permittedNotes.filter(n => {
                        const titleMatch = (n.title || '').toLowerCase().includes(q);
                        const catMatch = (n.category || '').toLowerCase().includes(q);
                        const stratMatch = (n.strategyId || '').toLowerCase().includes(q);
                        const contentMatch = (n.content || '').toLowerCase().includes(q);
                        return titleMatch || catMatch || stratMatch || contentMatch;
                    }).slice(0, 5);
                } else {
                    permittedNotes = permittedNotes.slice(0, 10);
                }
            }
        } catch (e) {}
    }

    // 3. Fetch Trade Journal with Strict Permission Scoping
    let userTrades = null;
    if (includeTrades && caller.phone && caller.phone !== 'Admin') {
        try {
            let hasJournal = caller.isAdmin;
            if (!hasJournal) {
                const permStr = await queryKV(['HGET', 'user_permissions', caller.phone]);
                if (permStr) {
                    const parsed = JSON.parse(permStr);
                    hasJournal = parsed.journal === true;
                }
            }

            if (hasJournal) {
                const kvTrades = await queryKV(['HGET', 'user_trades', caller.phone]);
                if (kvTrades) userTrades = JSON.parse(kvTrades);
            }
        } catch (e) {}
    }

    return {
        strategies,
        holidays,
        notes: permittedNotes,
        userTrades,
        callerRole: caller.isAdmin ? 'admin' : 'member'
    };
}

/**
 * Call Google Gemini with native responseSchema for structured JSON output
 */
async function callGeminiStructured(systemInstruction, userPrompt) {
    if (!GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY_NOT_CONFIGURED");
    }

    const payload = {
        systemInstruction: {
            parts: [{ text: systemInstruction }]
        },
        contents: [
            {
                role: 'user',
                parts: [{ text: userPrompt }]
            }
        ],
        generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    answer: { 
                        type: "STRING", 
                        description: "Clear, concise markdown explanation or answer" 
                    },
                    actions: {
                        type: "ARRAY",
                        description: "Optional clickable interactive action chips to suggest to user",
                        items: {
                            type: "OBJECT",
                            properties: {
                                type: { 
                                    type: "STRING", 
                                    enum: ["open_note", "open_strike_calc", "switch_view"] 
                                },
                                targetId: { 
                                    type: "STRING", 
                                    description: "Note ID, Strategy ID, or view name (calendar, flow, planner, notes, catalog, journal)" 
                                },
                                label: { 
                                    type: "STRING", 
                                    description: "Button label, e.g. '📖 Open Batman Note'" 
                                }
                            },
                            required: ["type", "targetId", "label"]
                        }
                    }
                },
                required: ["answer", "actions"]
            }
        }
    };

    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API returned ${response.status}: ${errText}`);
    }

    const resJson = await response.json();
    const textOut = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textOut) {
        throw new Error("Empty response from Gemini");
    }

    try {
        return JSON.parse(textOut);
    } catch (parseErr) {
        return {
            answer: textOut,
            actions: []
        };
    }
}

/**
 * Sanitize and whitelist returned actions before sending to client
 */
function sanitizeActions(actions, permittedNotes, strategies) {
    if (!Array.isArray(actions)) return [];
    
    const validNoteIds = new Set(permittedNotes.map(n => n.id));
    const validStrategyIds = new Set(strategies.map(s => s.id));

    return actions.filter(action => {
        if (!action || typeof action !== 'object') return false;
        const { type, targetId, label } = action;
        if (!type || !targetId || !label) return false;

        if (type === 'switch_view') {
            return ALLOWED_VIEW_TARGETS.includes(targetId.toLowerCase());
        }
        if (type === 'open_note') {
            return validNoteIds.has(targetId);
        }
        if (type === 'open_strike_calc') {
            return validStrategyIds.has(targetId);
        }
        return false;
    });
}

// -------------------------------------------------------------
// MAIN API DISPATCHER
// -------------------------------------------------------------

module.exports = async (req, res) => {
    // Determine action from query or path
    let action = (req.query && req.query.action) ? req.query.action : '';
    if (!action && req.url) {
        const urlObj = new URL(req.url, 'http://localhost');
        action = urlObj.searchParams.get('action') || urlObj.pathname.split('/').filter(Boolean).pop();
    }

    // 1. CRON / DAILY BRIEFING ENDPOINT (Supports Vercel Cron with CRON_SECRET or session auth)
    if (action === 'daily-brief') {
        try {
            const today = new Date().toISOString().split('T')[0];
            const cacheKey = `daily_brief:shared:${today}`;

            // Check Idempotency / Cache First (0 LLM cost on subsequent hits)
            const cachedBrief = await queryKVSafe(['GET', cacheKey]);
            if (cachedBrief) {
                return res.status(200).json({
                    success: true,
                    date: today,
                    brief: JSON.parse(cachedBrief),
                    cached: true
                });
            }

            // Auth Check: Either Bearer CRON_SECRET or logged in session
            const authHeader = req.headers['authorization'];
            const isCronAuth = verifyCronSecret(authHeader);

            const cookies = parseCookies(req.headers.cookie);
            const userPhone = cookies.session_token ? verifyToken(cookies.session_token) : null;
            const isAdmin = verifyAdminToken(cookies.admin_token);

            if (!isCronAuth && !userPhone && !isAdmin) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            // Check if market is closed today (Weekend or NSE Holiday)
            const { holidays } = loadDiskFallbacks();
            const now = new Date();
            const dayOfWeek = now.getDay(); // 0 = Sun, 6 = Sat
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            const holidayName = holidays[today];

            if (isWeekend || holidayName) {
                const closedNotice = {
                    headline: `Market Closed Today (${isWeekend ? 'Weekend' : holidayName})`,
                    status: 'CLOSED',
                    bullets: [
                        `Indian equity markets (NSE/BSE) are closed today for ${isWeekend ? 'the weekend' : holidayName}.`,
                        "No options deployments or strategy adjustments are scheduled for today.",
                        "Use non-trading days to review your Trade Journal performance and weekly capital sequencing."
                    ]
                };
                await queryKVSafe(['SET', cacheKey, JSON.stringify(closedNotice), 'EX', 86400]);
                return res.status(200).json({
                    success: true,
                    date: today,
                    brief: closedNotice,
                    marketClosed: true
                });
            }

            // Check Global Rate Limit
            const rateCheck = await checkAndIncrementAiRateLimit('system_cron', true);
            if (!rateCheck.allowed) {
                return res.status(429).json({ error: rateCheck.reason });
            }

            // Generate Generic Shared Daily Briefing via Gemini
            const { strategies } = loadDiskFallbacks();
            const systemPrompt = `You are the Pre-Market Intelligence Assistant for TTS Options Strategy Calendar.
Analyze today's trading day (${today}, ${now.toLocaleDateString('en-US', { weekday: 'long' })}).
Create a concise, punchy 3-bullet pre-market briefing summarizing:
1. Scheduled deployment focus for today based on typical monthly/weekly cycles.
2. Market risk factors to watch (e.g. gap openings, volatility discipline).
3. Core execution reminder (e.g. 5-6% credit range rule, CE hedge first).

Output JSON with keys "headline", "status", and "bullets" (array of exactly 3 strings). Keep bullets short and actionable.`;

            const userPrompt = `Generate today's pre-market briefing for ${today}. Active strategies count: ${strategies.length}.`;
            const briefResult = await callGeminiStructured(systemPrompt, userPrompt);

            // Cache in Redis for 24 hours
            await queryKVSafe(['SET', cacheKey, JSON.stringify(briefResult), 'EX', 86400]);

            return res.status(200).json({
                success: true,
                date: today,
                brief: briefResult,
                cached: false
            });

        } catch (err) {
            console.error("Daily Brief Error:", err);
            return res.status(500).json({ 
                error: 'Failed to generate daily briefing',
                fallback: {
                    headline: "Today's Trading Schedule",
                    status: "ACTIVE",
                    bullets: [
                        "Review active monthly and weekly calendar deployments for today.",
                        "Verify net credit range between 5% and 6% before finalizing strikes.",
                        "Stick to pre-defined stop loss and profit targets in Trade Journal."
                    ]
                }
            });
        }
    }

    // 2. AUTHENTICATE ALL INTERACTIVE ENDPOINTS (Chat & Allocate)
    const cookies = parseCookies(req.headers.cookie);
    const sessionToken = cookies['session_token'];
    const adminToken = cookies['admin_token'];
    const userPhone = sessionToken ? verifyToken(sessionToken) : null;
    const isAdmin = verifyAdminToken(adminToken);

    if (!userPhone && !isAdmin) {
        return res.status(401).json({ error: 'Unauthorized: Please log in to use AI Co-Pilot.' });
    }

    const caller = {
        phone: userPhone || 'admin',
        isAdmin: !!isAdmin
    };

    // 3. CHAT ENDPOINT (Interactive Strategy Co-Pilot)
    if (action === 'chat' || req.method === 'POST') {
        try {
            const body = req.body || {};
            const userMessage = (body.message || '').trim();

            if (!userMessage) {
                return res.status(400).json({ error: 'Message is required' });
            }

            // Rate Limit Check
            const rateCheck = await checkAndIncrementAiRateLimit(caller.phone, caller.isAdmin);
            if (!rateCheck.allowed) {
                return res.status(429).json({ 
                    error: rateCheck.reason,
                    rateLimited: true
                });
            }

            // Build Role-Scoped Context
            const context = await getScopedContext(caller, {
                includeNotes: true,
                includeTrades: true,
                query: userMessage
            });

            // Format context string safely with XML boundaries
            const contextText = `
<retrieved_context>
[USER_ROLE]: ${context.callerRole}
[MASTER_STRATEGIES]:
${JSON.stringify(context.strategies.map(s => ({ id: s.id, name: s.name, index: s.index, dte: s.dte, exit: s.exit })), null, 2)}

[PERMITTED_KNOWLEDGE_NOTES]:
${context.notes.map(n => `### Note: ${n.title} (ID: ${n.id}, Category: ${n.category})\n${n.content}`).join('\n\n')}

${context.userTrades ? `[USER_ACTIVE_TRADES]:\n${JSON.stringify(context.userTrades, null, 2)}` : ''}
</retrieved_context>`;

            const systemPrompt = `You are TTS Strategy Co-Pilot, an expert AI trading assistant for the TTS Options Strategy Calendar & Trade Journal platform.
You assist traders with options strategies (Iron Fly, Batman 1:3:2, No Brainer, HNI, STBT, Blaze Butterfly, etc.), rule execution, strike calculations, adjustments, and capital management.

CRITICAL OPERATIONAL RULES:
1. Ground your answers strictly in the verified knowledge provided in <retrieved_context>.
2. Do not invent strikes or rules not present in the master strategies or notes.
3. If asked about admin-only notes, private playbooks, or secrets, politely reply that you only have access to permitted public playbooks.
4. When suggesting relevant actions (like viewing a note or opening a strike calculator), include them in the "actions" array with valid IDs.
5. Format your answer in clean, readable Markdown with bullet points, bold headers, and code tags where appropriate.`;

            const fullPrompt = `${contextText}\n\nUser Question: ${userMessage}`;
            const result = await callGeminiStructured(systemPrompt, fullPrompt);

            // Sanitize actions against permitted IDs
            result.actions = sanitizeActions(result.actions, context.notes, context.strategies);

            return res.status(200).json({
                success: true,
                answer: result.answer,
                actions: result.actions
            });

        } catch (chatErr) {
            console.error("AI Chat Error:", chatErr);
            if (chatErr.message && chatErr.message.includes("429")) {
                return res.status(429).json({
                    error: "AI service is currently busy. Please try again in a few moments."
                });
            }
            return res.status(500).json({
                error: chatErr.message || "Failed to generate AI response."
            });
        }
    }

    // 4. ALLOCATE ENDPOINT (Deterministic Math + AI Narrative)
    if (action === 'allocate') {
        try {
            const body = req.body || {};
            const capital = parseFloat(body.capital) || 5000000;
            const openMargin = parseFloat(body.openMargin) || 0;
            const p1Util = parseFloat(body.p1Utilization) || 0;
            const p2Util = parseFloat(body.p2Utilization) || 0;
            const p3Util = parseFloat(body.p3Utilization) || 0;

            // Rate Limit Check
            const rateCheck = await checkAndIncrementAiRateLimit(caller.phone, caller.isAdmin);
            if (!rateCheck.allowed) {
                return res.status(429).json({ 
                    error: rateCheck.reason,
                    rateLimited: true
                });
            }

            const systemPrompt = `You are the Capital Allocation Risk Advisor for TTS Strategy Calendar.
You evaluate pre-computed portfolio allocation metrics and provide a 2-3 paragraph executive narrative on portfolio balance, concentration risk, and upcoming deployment recommendations.

RULES:
1. NEVER alter or recalculate the provided numbers. Treat all numbers as ground truth.
2. Highlight if any bucket (P1 Monthly: 68%, P2 Weekly: 24%, P3 STBT: 8%) is over-allocated or under-allocated.
3. Recommend holding cash buffer if overall utilization exceeds 85%.`;

            const prompt = `Total Capital: ₹${capital.toLocaleString('en-IN')}\nDeployed Margin: ₹${openMargin.toLocaleString('en-IN')}\nP1 (Monthly) Utilization: ${p1Util}%\nP2 (Weekly) Utilization: ${p2Util}%\nP3 (STBT) Utilization: ${p3Util}%`;

            const result = await callGeminiStructured(systemPrompt, prompt);
            return res.status(200).json({
                success: true,
                narrative: result.answer,
                actions: result.actions || []
            });

        } catch (allocErr) {
            console.error("AI Allocate Error:", allocErr);
            return res.status(500).json({
                error: "Failed to generate allocation insights"
            });
        }
    }

    return res.status(400).json({ error: 'Invalid AI action specified' });
};
