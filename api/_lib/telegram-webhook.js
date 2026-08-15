const { normalizePhoneNumber } = require('./common/auth');
const { queryKV } = require('./common/redis');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function sendTelegramMessage(chatId, text, replyMarkup = null) {
    if (!BOT_TOKEN) {
        console.warn("TELEGRAM_BOT_TOKEN environment variable not configured.");
        return;
    }
    const body = { chat_id: chatId, text };
    if (replyMarkup) {
        body.reply_markup = replyMarkup;
    }
    try {
        await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    } catch (e) {
        console.error("Failed to send telegram message:", e);
    }
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Verify Telegram webhook secret token
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (webhookSecret) {
        const incomingSecret = req.headers['x-telegram-bot-api-secret-token'];
        if (incomingSecret !== webhookSecret) {
            console.warn('Webhook request rejected: invalid or missing secret token');
            return res.status(403).json({ error: 'Forbidden: Invalid webhook secret' });
        }
    }

    try {
        const update = req.body || {};
        const message = update.message;

        if (!message) {
            return res.status(200).json({ success: true, message: 'No action needed (not a message)' });
        }

        const chatId = message.chat.id;
        const fromId = message.from.id;

        // 1. Handle /start <token> command
        if (message.text && message.text.startsWith('/start')) {
            const parts = message.text.split(' ');
            if (parts.length > 1) {
                const token = parts[1].trim();
                
                // Fetch auth token session from KV
                let sessionStr = null;
                try {
                    sessionStr = await queryKV(['GET', `auth_token:${token}`]);
                } catch (err) {
                    console.error("KV query failed, falling back to local simulation:", err.message);
                }

                if (sessionStr) {
                    const session = JSON.parse(sessionStr);
                    // Save active token link for this chat
                    await queryKV(['SET', `tg_session:${chatId}`, JSON.stringify({ token, phone: session.phone }), 'EX', '300']);
                    
                    // Show keyboard contact button
                    const replyMarkup = {
                        keyboard: [
                            [{ text: "📱 Verify Phone Number", request_contact: true }]
                        ],
                        one_time_keyboard: true,
                        resize_keyboard: true
                    };
                    await sendTelegramMessage(
                        chatId, 
                        "Welcome to TTS Options Strategy Calendar!\n\nPlease click the button below to share your registered contact number and complete your login verification.", 
                        replyMarkup
                    );
                } else {
                    await sendTelegramMessage(chatId, "❌ Invalid or expired login token. Please request a new verification link on the website.");
                }
            } else {
                await sendTelegramMessage(chatId, "Welcome! Please open the TTS Options Strategy Calendar website and click 'Verify on Telegram' to login.");
            }
            return res.status(200).json({ success: true });
        }

        // 2. Handle Contact sharing message
        if (message.contact) {
            const contact = message.contact;
            
            // Security Check: Verify user shared their OWN contact
            if (contact.user_id !== fromId) {
                await sendTelegramMessage(chatId, "❌ Security verification failed. You must share your own contact card.");
                return res.status(200).json({ success: true });
            }

            // Fetch session associated with this chat
            let tgSessionStr = null;
            try {
                tgSessionStr = await queryKV(['GET', `tg_session:${chatId}`]);
            } catch (err) {
                console.error("KV query failed:", err.message);
            }

            if (!tgSessionStr) {
                await sendTelegramMessage(chatId, "❌ No active verification session found. Please click 'Verify on Telegram' on the website first.");
                return res.status(200).json({ success: true });
            }

            const tgSession = JSON.parse(tgSessionStr);
            const token = tgSession.token;
            const contactPhone = normalizePhoneNumber(contact.phone_number);
            const sessionPhone = normalizePhoneNumber(tgSession.phone);

            if (contactPhone === sessionPhone) {
                // Verify against whitelist
                let whitelisted = false;
                try {
                    const pin = await queryKV(['HGET', 'whitelist', contactPhone]);
                    if (pin) whitelisted = true;
                } catch (e) {
                    console.error('Whitelist check failed (KV error):', e.message);
                    whitelisted = false; // Fail-closed: deny access on database error
                }

                if (whitelisted) {
                    // Update auth session to verified in KV
                    await queryKV(['SET', `auth_token:${token}`, JSON.stringify({ phone: contactPhone, verified: true }), 'EX', '300']);
                    
                    // Log auth audit event
                    try {
                        const logEntry = { phone: contactPhone, method: 'telegram', timestamp: new Date().toISOString() };
                        await queryKV(['LPUSH', 'auth_audit_logs', JSON.stringify(logEntry)]);
                        await queryKV(['LTRIM', 'auth_audit_logs', 0, 999]);
                    } catch (e) {}

                    // Map Telegram Chat ID to phone number for future one-click widget logins
                    await queryKV(['SET', `tg_user:${fromId}`, contactPhone]);

                    // Cleanup session
                    await queryKV(['DEL', `tg_session:${chatId}`]);

                    await sendTelegramMessage(chatId, "✅ Verification successful! Please return to your browser. You can close this chat.", { remove_keyboard: true });
                } else {
                    await sendTelegramMessage(chatId, "❌ Phone number is not in the whitelisted list. Access denied.", { remove_keyboard: true });
                }
            } else {
                await sendTelegramMessage(chatId, `❌ Verification failed. Shared number (${contactPhone}) does not match the login number (${sessionPhone}).`, { remove_keyboard: true });
            }
            return res.status(200).json({ success: true });
        }

        // Generic response
        await sendTelegramMessage(chatId, "Hello! Please follow the login link on the website to verify your account.");
        return res.status(200).json({ success: true });

    } catch (error) {
        console.error('Webhook error:', error);
        return res.status(200).json({ success: true, error: 'Internal server error' }); // Always return 200 to Telegram to prevent retries
    }
};
