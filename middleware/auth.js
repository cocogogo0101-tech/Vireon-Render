// ============================================================
//  Story Engine — middleware/auth.js
// ============================================================
const crypto = require('crypto');

// ── توليد توكن بسيط ──────────────────────────────────────────
function generateToken() {
    const payload = {
        authenticated: true,
        iat: Date.now(),
        exp: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 أيام
    };
    const data    = JSON.stringify(payload);
    const secret  = process.env.JWT_SECRET || 'default-secret-change-this';
    const sig     = crypto.createHmac('sha256', secret).update(data).digest('hex');
    return Buffer.from(data).toString('base64') + '.' + sig;
}

// ── التحقق من التوكن ─────────────────────────────────────────
function verifyToken(token) {
    try {
        if (!token) return false;
        const parts   = token.split('.');
        if (parts.length !== 2) return false;
        const data    = Buffer.from(parts[0], 'base64').toString();
        const secret  = process.env.JWT_SECRET || 'default-secret-change-this';
        const sig     = crypto.createHmac('sha256', secret).update(data).digest('hex');
        if (sig !== parts[1]) return false;
        const payload = JSON.parse(data);
        if (Date.now() > payload.exp) return false;
        return true;
    } catch (e) {
        return false;
    }
}

// ── Middleware للتحقق من المصادقة ─────────────────────────────
function requireAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token      = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token || !verifyToken(token)) {
        return res.status(401).json({ ok: false, error: 'غير مصرح — يرجى تسجيل الدخول' });
    }
    next();
}

module.exports = { generateToken, verifyToken, requireAuth };
