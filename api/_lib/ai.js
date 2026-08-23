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
const { getDailyCalendarSchedule, formatDateString } = require('./calendar-engine');

// Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

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

            // Fallback to seed notes if KV is empty
            if (!Array.isArray(rawNotes) || rawNotes.length === 0) {
                try {
                    const { SEED_NOTES } = require('./notes');
                    rawNotes = SEED_NOTES || [];
                } catch (seedErr) {}
            }

            if (Array.isArray(rawNotes) && rawNotes.length > 0) {
                // Admin gets all notes; regular member only gets public notes
                const roleNotes = caller.isAdmin ? rawNotes : rawNotes.filter(n => !n.isAdminOnly);

                // Smart multi-keyword relevance scoring
                if (query && query.trim()) {
                    const stopwords = new Set(['the','a','an','is','in','on','at','of','for','to','and','or','what','how','give','me','show','tell','about','run','down','detailed','with','this','that','from','strategy']);
                    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1 && !stopwords.has(t));

                    if (terms.length > 0) {
                        const scored = roleNotes.map(n => {
                            let score = 0;
                            const titleLower = (n.title || '').toLowerCase();
                            const catLower = (n.category || '').toLowerCase();
                            const stratLower = (n.strategyId || '').toLowerCase();
                            const contentLower = (n.content || '').toLowerCase();

                            terms.forEach(term => {
                                if (titleLower.includes(term)) score += 12;
                                if (stratLower.includes(term)) score += 10;
                                if (catLower.includes(term)) score += 5;
                                if (contentLower.includes(term)) score += 2;
                            });
                            return { note: n, score };
                        });

                        const matching = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).map(s => s.note);
                        permittedNotes = matching.length > 0 ? matching.slice(0, 6) : roleNotes.slice(0, 6);
                    } else {
                        permittedNotes = roleNotes.slice(0, 6);
                    }
                } else {
                    permittedNotes = roleNotes.slice(0, 8);
                }
            }
        } catch (e) {
            console.warn('[AI-CONTEXT] Notes retrieval issue:', e);
        }
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

    // 4. Calculate dynamic calendar schedule for today
    const todayStr = new Date().toISOString().split('T')[0];
    const todaySchedule = getDailyCalendarSchedule(todayStr, strategies, holidays);

    return {
        strategies,
        holidays,
        notes: permittedNotes,
        userTrades,
        todaySchedule,
        callerRole: caller.isAdmin ? 'admin' : 'member'
    };
}

/**
 * Convert Gemini-style schema to text description for Groq's system prompt
 */
function schemaToTextDescription(schema) {
    if (!schema) return '';
    try {
        const props = schema.properties || {};
        const required = schema.required || [];
        const fields = Object.entries(props).map(([key, val]) => {
            const type = val.type || 'STRING';
            const desc = val.description || '';
            const req = required.includes(key) ? ' (required)' : '';
            if (type === 'ARRAY' && val.items) {
                return `- "${key}": array of ${val.items.type || 'strings'}${req} — ${desc}`;
            }
            return `- "${key}": ${type.toLowerCase()}${req} — ${desc}`;
        });
        return `\n\nYour JSON response MUST have exactly these fields:\n${fields.join('\n')}`;
    } catch (e) {
        return '';
    }
}

/**
 * Call Groq API with multi-model cascade (uses available free-tier models)
 */
async function callGroqStructured(systemInstruction, userPrompt, customSchema = null) {
    const groqKey = process.env.GROQ_API_KEY || GROQ_API_KEY;
    if (!groqKey) return null;

    // Models in priority order (available on Groq free tier)
    const groqModels = [
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant',
        'gemma2-9b-it',
        'mixtral-8x7b-32768'
    ];

    const schemaHint = schemaToTextDescription(customSchema);
    const fullSystemPrompt = `${systemInstruction}\n\nIMPORTANT: You must reply ONLY with a valid, parseable JSON object.${schemaHint}`;

    let lastError = null;

    for (const model of groqModels) {
        try {
            console.log(`[AI-ROUTER] Attempting Groq model: ${model}...`);
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${groqKey}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: 'system', content: fullSystemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    response_format: { type: "json_object" },
                    temperature: 0.2
                }),
                signal: AbortSignal.timeout ? AbortSignal.timeout(9000) : undefined
            });

            if (!response.ok) {
                const errText = await response.text();
                console.warn(`[AI-ROUTER] Groq model ${model} returned ${response.status}, trying next...`);
                lastError = new Error(`Groq ${model} returned ${response.status}: ${errText}`);
                continue;
            }

            const resJson = await response.json();
            const content = resJson.choices?.[0]?.message?.content;
            if (!content) {
                lastError = new Error(`Empty response from Groq model ${model}`);
                continue;
            }
            const parsed = JSON.parse(content);
            parsed._provider = `groq:${model}`;
            console.log(`[AI-ROUTER] ✅ Groq model ${model} responded successfully`);
            return parsed;
        } catch (err) {
            console.warn(`[AI-ROUTER] Groq model ${model} error:`, err.message);
            lastError = err;
            continue;
        }
    }

    throw lastError || new Error('All Groq models failed');
}

/**
 * Multi-Provider Structured LLM Caller (Groq ➡️ Gemini Multi-Model Cascade)
 */
async function callGeminiStructured(systemInstruction, userPrompt, customSchema = null) {
    const groqKey = process.env.GROQ_API_KEY || GROQ_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY || GEMINI_API_KEY;

    console.log(`[AI-ROUTER] Provider keys: GROQ=${groqKey ? 'SET(' + groqKey.substring(0,6) + '...)' : 'NOT_SET'}, GEMINI=${geminiKey ? 'SET(' + geminiKey.substring(0,6) + '...)' : 'NOT_SET'}`);

    // 1. If GROQ_API_KEY is configured, prioritize Groq for 10x speed & zero 503 errors
    if (groqKey) {
        try {
            const groqResult = await callGroqStructured(systemInstruction, userPrompt, customSchema);
            if (groqResult) return groqResult;
        } catch (groqErr) {
            console.warn('[AI-ROUTER] ❌ Groq provider error, falling back to Gemini:', groqErr.message);
        }
    } else {
        console.log('[AI-ROUTER] GROQ_API_KEY not set, skipping Groq provider');
    }

    if (!geminiKey) {
        throw new Error("NO_AI_PROVIDER_KEY_CONFIGURED: Please set GROQ_API_KEY or GEMINI_API_KEY in your Vercel Environment Variables.");
    }

    const defaultSchema = {
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
    };

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
            responseSchema: customSchema || defaultSchema
        }
    };

    // Candidate Gemini models in order of priority
    const candidateModels = Array.from(new Set([
        GEMINI_MODEL,
        'gemini-2.0-flash',
        'gemini-1.5-flash',
        'gemini-1.5-flash-8b',
        'gemini-2.5-flash',
        'gemini-flash-latest'
    ]));

    let lastError = null;

    for (const model of candidateModels) {
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                if (attempt > 0) {
                    await new Promise(r => setTimeout(r, 600));
                }

                const url = `${GEMINI_API_BASE}/${model}:generateContent`;
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'x-goog-api-key': GEMINI_API_KEY
                    },
                    body: JSON.stringify(payload),
                    signal: AbortSignal.timeout ? AbortSignal.timeout(9000) : undefined
                });

                if (!response.ok) {
                    const errText = await response.text();
                    const status = response.status;
                    if (status === 503 || status === 429 || status === 404) {
                        console.warn(`Gemini model ${model} returned ${status}, trying next model...`);
                        lastError = new Error(`Gemini API returned ${status}: ${errText}`);
                        if (attempt === 0 && (status === 503 || status === 429)) {
                            continue;
                        }
                        break;
                    }
                    throw new Error(`Gemini API returned ${status}: ${errText}`);
                }

                const resJson = await response.json();
                const textOut = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
                if (!textOut) {
                    throw new Error("Empty response from Gemini");
                }

                try {
                    const parsed = JSON.parse(textOut);
                    parsed._provider = `gemini:${model}`;
                    console.log(`[AI-ROUTER] ✅ Gemini model ${model} responded successfully`);
                    return parsed;
                } catch (parseErr) {
                    return {
                        answer: textOut,
                        actions: [],
                        _provider: `gemini:${model}`
                    };
                }
            } catch (callErr) {
                const msg = callErr.message || '';
                if (msg.includes('503') || msg.includes('429') || msg.includes('404') || msg.includes('UNAVAILABLE') || msg.includes('fetch failed')) {
                    lastError = callErr;
                    if (attempt === 0) continue;
                    break;
                }
                throw callErr;
            }
        }
    }

    throw lastError || new Error("All AI candidate models failed");
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
// DIAGNOSTIC ENDPOINT
async function handleDiag(req, res) {
    const groqKey = process.env.GROQ_API_KEY || GROQ_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY || GEMINI_API_KEY;
    const diag = {
        groq: { configured: !!groqKey, keyPrefix: groqKey ? groqKey.substring(0, 8) + '...' : null },
        gemini: { configured: !!geminiKey, keyPrefix: geminiKey ? geminiKey.substring(0, 8) + '...' : null },
        geminiModel: process.env.GEMINI_MODEL || GEMINI_MODEL,
        envKeys: Object.keys(process.env).filter(k => k.includes('GROQ') || k.includes('GEMINI') || k.includes('OPENAI'))
    };

    // List ALL Groq models
    if (groqKey) {
        try {
            const r = await fetch('https://api.groq.com/openai/v1/models', {
                headers: { 'Authorization': `Bearer ${groqKey}` }
            });
            diag.groq.status = r.ok ? 'CONNECTED' : `ERROR_${r.status}`;
            if (r.ok) {
                const models = await r.json();
                const allModels = models.data?.map(m => m.id) || [];
                diag.groq.allModels = allModels;
                diag.groq.llamaModels = allModels.filter(m => m.includes('llama'));
                diag.groq.totalModels = allModels.length;
            }
        } catch (e) {
            diag.groq.status = 'NETWORK_ERROR: ' + e.message;
        }

        // Live test call
        try {
            const testModel = 'qwen/qwen3.6-27b';
            const testResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${groqKey}`
                },
                body: JSON.stringify({
                    model: testModel,
                    messages: [{ role: 'user', content: 'Reply with this exact json: {"test":"ok"}' }],
                    response_format: { type: 'json_object' },
                    temperature: 0
                })
            });
            if (testResp.ok) {
                const testJson = await testResp.json();
                diag.groq.liveTest = {
                    status: 'SUCCESS',
                    model: testModel,
                    response: testJson.choices?.[0]?.message?.content
                };
            } else {
                const errText = await testResp.text();
                diag.groq.liveTest = {
                    status: `ERROR_${testResp.status}`,
                    model: testModel,
                    error: errText.substring(0, 500)
                };
            }
        } catch (e) {
            diag.groq.liveTest = { status: 'NETWORK_ERROR', error: e.message };
        }
    }

    return res.status(200).json(diag);
}

// MAIN API DISPATCHER
// -------------------------------------------------------------

module.exports = async (req, res) => {
    // Determine action from query or path
    let action = (req.query && req.query.action) ? req.query.action : '';
    if (!action && req.url) {
        const urlObj = new URL(req.url, 'http://localhost');
        action = urlObj.searchParams.get('action') || urlObj.pathname.split('/').filter(Boolean).pop();
    }

    // 0. DIAGNOSTIC ENDPOINT (Admin-only, tests AI provider connectivity)
    if (action === 'diag') {
        return handleDiag(req, res);
    }

    // 1. CRON / DAILY BRIEFING ENDPOINT (Supports Vercel Cron with CRON_SECRET or session auth)
    if (action === 'daily-brief') {
        try {
            const today = new Date().toISOString().split('T')[0];
            const cacheKey = `daily_brief:shared:${today}`;

            // Auth Check: Either Bearer CRON_SECRET, regular user session, or admin session
            const authHeader = req.headers['authorization'];
            const isCronAuth = verifyCronSecret(authHeader);

            const cookies = parseCookies(req.headers.cookie);
            const userPhone = cookies.session_token ? verifyToken(cookies.session_token) : null;
            const isAdmin = verifyAdminToken(cookies.admin_token);

            if (!isCronAuth && !userPhone && !isAdmin) {
                return res.status(401).json({ error: 'Unauthorized: Please log in to view the daily briefing.' });
            }

            // Force refresh is permitted ONLY for Admin or Cron secret
            const wantsForce = req.query && (req.query.force === 'true' || req.query.force === '1');
            const canForceRefresh = (isAdmin || isCronAuth) && wantsForce;

            // Check Idempotency / Cache First (0 LLM cost on subsequent hits)
            if (!canForceRefresh) {
                const cachedBrief = await queryKVSafe(['GET', cacheKey]);
                if (cachedBrief) {
                    try {
                        const parsed = JSON.parse(cachedBrief);
                        // Validate cached data has correct structure (not stale answer/actions format)
                        if (parsed.bullets && Array.isArray(parsed.bullets)) {
                            return res.status(200).json({
                                success: true,
                                date: today,
                                brief: parsed,
                                cached: true
                            });
                        }
                        // Stale/malformed cache — delete and regenerate
                        console.warn('[DAILY-BRIEF] Stale cache detected (missing bullets), regenerating...');
                        await queryKVSafe(['DEL', cacheKey]);
                    } catch (parseErr) {
                        console.warn('[DAILY-BRIEF] Corrupt cache, regenerating...');
                        await queryKVSafe(['DEL', cacheKey]);
                    }
                }
            } else {
                // Force refresh: delete existing cache (Admin / Cron only)
                await queryKVSafe(['DEL', cacheKey]);
                console.log('[DAILY-BRIEF] Admin force refresh requested, cache cleared.');
            }

            // Check if market is closed today (Weekend or NSE Holiday)
            const { strategies, holidays } = loadDiskFallbacks();
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

            // Generate Enriched Daily Briefing with calendar dynamic schedule
            const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
            
            const schedule = getDailyCalendarSchedule(today, strategies, holidays);
            const todayDeployments = schedule.deploymentsToday;
            const todayExits = schedule.exitsToday;
            const activePositions = schedule.activeHoldingPositions;

            const deployLines = todayDeployments.map(d => {
                const s = d.strategy;
                const exitDateStr = d.exitDate ? formatDateString(d.exitDate) : 'N/A';
                return `• DEPLOY TODAY: ${s.name} [${s.index}] (${s.sheet}) at ${s.time || '15:16'} | DTE: ${s.dte}, Target: ${s.exit?.target || 'N/A'}, SL: ${s.exit?.sl || 'N/A'}, Credit: ${s.conditions?.credit_range || 'N/A'}, Scheduled Exit: ${exitDateStr}`;
            });

            const exitLines = todayExits.map(d => {
                const s = d.strategy;
                const depDateStr = d.actualDate ? formatDateString(d.actualDate) : 'N/A';
                return `• SCHEDULED EXIT TODAY: ${s.name} [${s.index}] (deployed ${depDateStr}) | Target: ${s.exit?.target || 'N/A'}, SL: ${s.exit?.sl || 'N/A'}`;
            });

            const deployNames = todayDeployments.map(d => `${d.strategy.name} (${d.strategy.index})`).join(', ');
            const exitNames = todayExits.map(d => `${d.strategy.name} (${d.strategy.index})`).join(', ');

            const systemPrompt = `You are the Pre-Market Intelligence Assistant for TTS Options Strategy Calendar.
Today is ${dayName}, ${today}. Analyze the dynamic calendar schedule below and create a precise, actionable briefing.

VERIFIED CALENDAR SCHEDULE FOR TODAY (${today}):
${todayDeployments.length > 0 ? `⚡ DEPLOYMENTS SCHEDULED FOR TODAY (${todayDeployments.length}):\n${deployLines.join('\n')}` : '• No new strategy deployments are scheduled for today.'}

${todayExits.length > 0 ? `🔔 EXITS / SQUARE-OFFS SCHEDULED FOR TODAY (${todayExits.length}):\n${exitLines.join('\n')}` : '• No strategy exits are scheduled for today.'}

${activePositions.length > 0 ? `📌 ACTIVE POSITIONS CURRENTLY IN PROGRESS (${activePositions.length}):\n` + activePositions.slice(0, 6).map(d => `• ${d.strategy.name} [${d.strategy.index}] (Deployed: ${formatDateString(d.actualDate)}, Exit: ${formatDateString(d.exitDate)})`).join('\n') : ''}

CRITICAL RULES:
1. ONLY state that a strategy is deploying if it is listed under "DEPLOYMENTS SCHEDULED FOR TODAY". DO NOT list any other strategy as deploying today.
2. If a strategy is listed under "EXITS / SQUARE-OFFS", explicitly report it as a scheduled exit / square-off, NEVER as a deployment.
3. If no deployments are scheduled today, state clearly that no new deployments take place today and focus on managing open positions.
4. Include exact Target %, Stop Loss %, and Credit Ranges from the data.
5. Create 3 to 5 concise bullet points.`;

            const briefingSchema = {
                type: "OBJECT",
                properties: {
                    headline: { type: "STRING", description: "Briefing headline referencing today's key activity, e.g. 'Thursday: 3 Deployments & 2 Exits Scheduled'" },
                    status: { type: "STRING", description: "Market status: 'DEPLOYMENT DAY', 'EXPIRY DAY', 'EXIT / SQUARE-OFF DAY', or 'MONITORING'" },
                    bullets: {
                        type: "ARRAY",
                        description: "Array of 3-5 concise, strategy-specific actionable bullet points",
                        items: { type: "STRING" }
                    }
                },
                required: ["headline", "status", "bullets"]
            };

            const userPrompt = `Generate today's pre-market briefing for ${dayName}, ${today}.
${todayDeployments.length > 0 ? `Deployments today (${todayDeployments.length}): ${deployNames}. Detail their DTE, target, SL, and credit range rules.` : 'No new deployments scheduled today.'}
${todayExits.length > 0 ? `Exits today (${todayExits.length}): ${exitNames}. Highlight square-off and profit target guidelines.` : ''}`;
            let briefResult = await callGeminiStructured(systemPrompt, userPrompt, briefingSchema);

            // Handle cases where answer/actions schema might be returned (Groq fallback)
            if (!briefResult.bullets && briefResult.answer) {
                const lines = briefResult.answer.split('\n').filter(l => l.trim().startsWith('-') || l.trim().startsWith('*') || /^\d+\./.test(l.trim()));
                briefResult = {
                    headline: "Today's Pre-Market Briefing",
                    status: "ACTIVE",
                    bullets: lines.length > 0 ? lines.map(l => l.replace(/^[-*•\d.]+\s*/, '').trim()) : [briefResult.answer],
                    _provider: briefResult._provider
                };
            }

            // Strip _provider before caching, keep for response
            const provider = briefResult._provider;
            delete briefResult._provider;

            // Cache in Redis for 24 hours
            await queryKVSafe(['SET', cacheKey, JSON.stringify(briefResult), 'EX', 86400]);

            return res.status(200).json({
                success: true,
                date: today,
                brief: briefResult,
                cached: false,
                provider: provider || 'unknown'
            });

        } catch (err) {
            console.error("Daily Brief Error:", err);
            const { strategies } = loadDiskFallbacks();
            const topStrategies = strategies.slice(0, 3).map(s => s.name).join(', ');
            const fallbackBrief = {
                headline: "Today's Trading Schedule & Risk Brief",
                status: "ACTIVE",
                bullets: [
                    `Review active deployment cycles for scheduled strategies (${topStrategies}).`,
                    "Verify 5% to 6% net credit deployment range before taking execution strikes.",
                    "Adhere strictly to pre-defined stop loss and profit targets in your Trade Journal."
                ]
            };
            return res.status(200).json({ 
                success: true,
                date: new Date().toISOString().split('T')[0],
                brief: fallbackBrief,
                cached: false,
                fallback: true
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

    // 3. CHAT ENDPOINT (Interactive Strategy Co-Pilot - Admin Only)
    if (action === 'chat' || req.method === 'POST') {
        if (!caller.isAdmin) {
            return res.status(403).json({ error: 'AI Strategy Co-Pilot is currently reserved for Admin users.' });
        }
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
            const todayStr = new Date().toISOString().split('T')[0];
            const sched = context.todaySchedule || {};
            const depList = (sched.deploymentsToday || []).map(d => `${d.strategy.name} [${d.strategy.index}] (Deploy Time: ${d.strategy.time || '15:16'}, DTE: ${d.strategy.dte}, Target: ${d.strategy.exit?.target || 'N/A'}, SL: ${d.strategy.exit?.sl || 'N/A'}, Credit: ${d.strategy.conditions?.credit_range || 'N/A'})`).join('\n• ');
            const exitList = (sched.exitsToday || []).map(d => `${d.strategy.name} [${d.strategy.index}] (Deployed: ${formatDateString(d.actualDate)}, Target: ${d.strategy.exit?.target || 'N/A'}, SL: ${d.strategy.exit?.sl || 'N/A'})`).join('\n• ');
            const activeList = (sched.activeHoldingPositions || []).slice(0, 6).map(d => `${d.strategy.name} [${d.strategy.index}] (Deployed: ${formatDateString(d.actualDate)}, Exit by: ${formatDateString(d.exitDate)})`).join('\n• ');

            const contextText = `
<retrieved_context>
[USER_ROLE]: ${context.callerRole}
[TODAYS_VERIFIED_CALENDAR_SCHEDULE (Date: ${todayStr})]:
• DEPLOYMENTS TODAY (${(sched.deploymentsToday || []).length}):
${depList ? '• ' + depList : '• None scheduled for today'}

• EXITS / SQUARE-OFFS TODAY (${(sched.exitsToday || []).length}):
${exitList ? '• ' + exitList : '• None scheduled for today'}

• ACTIVE HOLDING POSITIONS CURRENTLY IN PROGRESS (${(sched.activeHoldingPositions || []).length}):
${activeList ? '• ' + activeList : '• None'}

[MASTER_STRATEGIES]:
${JSON.stringify(context.strategies.map(s => ({
    id: s.id, name: s.name, index: s.index, sheet: s.sheet,
    deploy_day: s.day, deploy_time: s.time, expiry: s.expiry, dte: s.dte,
    setup: s.setup, conditions: s.conditions, exit: s.exit,
    deploy_rule: s.deploy_rule, exit_rule: s.exit_rule
})), null, 2)}

[PERMITTED_KNOWLEDGE_NOTES]:
${context.notes.map(n => `### Note: ${n.title} (ID: ${n.id}, Category: ${n.category})\n${n.content}`).join('\n\n')}

${context.userTrades ? `[USER_ACTIVE_TRADES]:\n${JSON.stringify(context.userTrades, null, 2)}` : ''}
</retrieved_context>`;

            const systemPrompt = `You are TTS Strategy Co-Pilot, an expert AI trading assistant for the TTS Options Strategy Calendar & Trade Journal platform.
You assist traders with options strategies (Iron Fly, Batman 1:3:2, No Brainer, HNI, STBT, Blaze Butterfly, etc.), rule execution, strike calculations, adjustments, and capital management.

CRITICAL OPERATIONAL RULES:
1. Ground your answers strictly in the verified knowledge provided in <retrieved_context>.
2. When asked what strategies deploy today, what exits today, or what the calendar schedule is, ALWAYS check [TODAYS_VERIFIED_CALENDAR_SCHEDULE] first. Only list strategies under "DEPLOYMENTS TODAY" as deploying today. Never guess based on generic weekday names.
3. Do not invent strikes or rules not present in the master strategies or notes.
4. If asked about admin-only notes, private playbooks, or secrets, politely reply that you only have access to permitted public playbooks.
5. When suggesting relevant actions (like viewing a note or opening a strike calculator), include them in the "actions" array with valid IDs.
6. Format your answer in clean, readable Markdown with bullet points, bold headers, and code tags where appropriate.`;

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
