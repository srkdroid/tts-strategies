/**
 * Shared Authentication Utilities
 * 
 * Extracted from duplicated copies across api/_lib handlers.
 * Provides cookie parsing, member session verification, and admin token verification.
 */
const crypto = require('crypto');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
    throw new Error("JWT_SECRET environment variable is missing");
}

const ADMIN_SECRET = process.env.ADMIN_JWT_SECRET;
if (!ADMIN_SECRET) {
    throw new Error("ADMIN_JWT_SECRET environment variable is missing");
}

/**
 * Parse HTTP Cookie header into a key-value object.
 * @param {string} cookieHeader - Raw Cookie header string
 * @returns {Object} Parsed cookies
 */
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

/**
 * Verify a member session token (HMAC-SHA256 signed).
 * @param {string} token - Base64-encoded session token from cookie
 * @returns {string|null} Phone number if valid, null otherwise
 */
function verifyToken(token) {
    if (!token) return null;
    try {
        const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
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

/**
 * Verify an admin session token (HMAC-SHA256 signed).
 * @param {string} token - Base64-encoded admin token from cookie
 * @returns {boolean} true if valid admin session
 */
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
        if (!parsed.expires || parsed.expires < Date.now()) return false;
        return parsed.role === 'admin';
    } catch (e) {
        return false;
    }
}

/**
 * Generate a member session token (30-day expiry).
 * @param {string} phone - Normalized phone number
 * @returns {string} Base64-encoded signed token
 */
function generateToken(phone) {
    const expires = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
    const data = JSON.stringify({ phone, expires });
    const hmac = crypto.createHmac('sha256', SECRET);
    hmac.update(data);
    const signature = hmac.digest('hex');
    return Buffer.from(JSON.stringify({ data, signature })).toString('base64');
}

/**
 * Generate an admin session token (2-hour expiry).
 * @returns {string} Base64-encoded signed token
 */
function generateAdminToken() {
    const expires = Date.now() + 2 * 60 * 60 * 1000; // 2 hours
    const data = JSON.stringify({ role: 'admin', expires });
    const hmac = crypto.createHmac('sha256', ADMIN_SECRET);
    hmac.update(data);
    const signature = hmac.digest('hex');
    return Buffer.from(JSON.stringify({ data, signature })).toString('base64');
}

/**
 * Normalize an international phone number to +91XXXXXXXXXX format.
 * @param {string} phone - Raw phone input
 * @returns {string} Normalized phone number
 */
function normalizePhoneNumber(phone) {
    if (!phone) return "";
    let cleaned = phone.replace(/[^\d+]/g, '');
    if (!cleaned.startsWith('+')) {
        if (cleaned.length === 10) {
            cleaned = '+91' + cleaned;
        } else {
            cleaned = '+' + cleaned;
        }
    }
    return cleaned;
}

module.exports = {
    parseCookies,
    verifyToken,
    verifyAdminToken,
    generateToken,
    generateAdminToken,
    normalizePhoneNumber
};
