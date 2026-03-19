// ============================================================
//  Story Engine Backend — server.js
// ============================================================
require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// ── تحقق من المتغيرات الإلزامية ──────────────────────────────
const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'APP_PASSWORD'];
const missing  = required.filter(k => !process.env[k]);
if (missing.length) {
    console.error('❌ متغيرات مفقودة:', missing.join(', '));
    process.exit(1);
}

if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = require('crypto').randomBytes(32).toString('hex');
}

// ── تحميل الإعدادات من DB ─────────────────────────────────────
async function loadConfigFromDB() {
    try {
        const { supabase } = require('./services/supabase');
        const { data } = await supabase.from('config').select('key, value');
        if (!data) return;
        const cfg = {};
        data.forEach(r => { cfg[r.key] = r.value; });
        if (!process.env.GEMINI_API_KEY    && cfg.gemini_api_key)    process.env.GEMINI_API_KEY    = cfg.gemini_api_key;
        if (!process.env.OPENAI_API_KEY    && cfg.openai_api_key)    process.env.OPENAI_API_KEY    = cfg.openai_api_key;
        if (!process.env.ANTHROPIC_API_KEY && cfg.anthropic_api_key) process.env.ANTHROPIC_API_KEY = cfg.anthropic_api_key;
        if (!process.env.GEMINI_MODEL      && cfg.gemini_model)      process.env.GEMINI_MODEL      = cfg.gemini_model;
        if (!process.env.OPENAI_MODEL      && cfg.openai_model)      process.env.OPENAI_MODEL      = cfg.openai_model;
        if (!process.env.ANTHROPIC_MODEL   && cfg.anthropic_model)   process.env.ANTHROPIC_MODEL   = cfg.anthropic_model;
        if (!process.env.DEFAULT_AI_PROVIDER && cfg.active_provider) process.env.DEFAULT_AI_PROVIDER = cfg.active_provider;
        if (!process.env.FRONTEND_URL && cfg.frontend_url)           process.env.FRONTEND_URL      = cfg.frontend_url;
        console.log('✅ تم تحميل الإعدادات من قاعدة البيانات');
    } catch (e) {
        console.warn('⚠️  خطأ في تحميل الإعدادات:', e.message);
    }
}

// ── CORS ─────────────────────────────────────────────────────
app.use((req, res, next) => {
    const allowed = [
        'https://vireon.rf.gd',
        'https://www.vireon.rf.gd',
        process.env.FRONTEND_URL,
        'http://localhost:3000',
        'http://localhost:5500',
        'http://127.0.0.1:5500',
    ].filter(Boolean);

    cors({
        origin: function(origin, callback) {
            if (!origin) return callback(null, true);
            const clean = origin.replace(/\/$/, '');
            const ok = allowed.some(a => a && a.replace(/\/$/, '') === clean);
            if (ok) return callback(null, true);
            callback(new Error('CORS: غير مسموح — ' + origin));
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    })(req, res, next);
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Rate Limiting ─────────────────────────────────────────────
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { ok: false, error: 'كثير من الطلبات' },
    standardHeaders: true,
}));

const generateLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 20,
    message: { ok: false, error: 'تجاوزت حد التوليد — انتظر 10 دقائق' },
});

// ── Routes ────────────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/chapters',   require('./routes/chapters'));
app.use('/api/generate',   generateLimiter, require('./routes/generate'));
app.use('/api/characters', require('./routes/characters'));
app.use('/api/library',    require('./routes/library'));
app.use('/api/wizard',     require('./routes/wizard'));
app.use('/api/config',     require('./routes/config'));
app.use('/api/export',     require('./routes/export'));

// ── Health & Ping ─────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
    ok: true, service: 'Story Engine Backend', version: '2.0.0',
    provider: process.env.DEFAULT_AI_PROVIDER || 'not set',
    time: new Date().toISOString(),
}));

app.get('/ping', (req, res) => res.status(200).send('pong'));
app.get('/',     (req, res) => res.json({ ok: true, message: 'Story Engine API 🚀' }));

// ── 404 & Errors ──────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ ok: false, error: 'غير موجود: ' + req.path }));
app.use((err, req, res, next) => {
    if (err.message && err.message.startsWith('CORS'))
        return res.status(403).json({ ok: false, error: err.message });
    res.status(500).json({ ok: false, error: 'خطأ داخلي' });
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

async function start() {
    await loadConfigFromDB();
    app.listen(PORT, () => {
        console.log(`✅ Story Engine Backend — port ${PORT}`);
        console.log(`🤖 AI: ${process.env.DEFAULT_AI_PROVIDER || 'not set'}`);
        console.log(`🌍 Frontend: ${process.env.FRONTEND_URL || 'not set'}`);
    });
}

start();
