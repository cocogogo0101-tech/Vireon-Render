// ============================================================
//  Story Engine Backend — server.js
//  يحتاج فقط: SUPABASE_URL، SUPABASE_SERVICE_KEY، APP_PASSWORD
//  كل الباقي يُحمَّل من قاعدة البيانات
// ============================================================
require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// ── تحقق من المتغيرات الإلزامية الثلاثة ─────────────────────
const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'APP_PASSWORD'];
const missing  = required.filter(k => !process.env[k]);
if (missing.length) {
    console.error('❌ متغيرات مفقودة في Render:', missing.join(', '));
    process.exit(1);
}

// ── توليد JWT_SECRET تلقائياً إن لم يُضبط ────────────────────
if (!process.env.JWT_SECRET) {
    const crypto = require('crypto');
    process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
    console.log('⚠️  JWT_SECRET غير مضبوط — تم توليده تلقائياً (مؤقت)');
    console.log('   أضفه في Render للثبات عبر إعادة التشغيل.');
}

// ── تحميل الإعدادات من قاعدة البيانات عند البدء ─────────────
async function loadConfigFromDB() {
    try {
        const { supabase } = require('./services/supabase');
        const { data } = await supabase.from('config').select('key, value');
        if (!data) return;

        const cfg = {};
        data.forEach(r => { cfg[r.key] = r.value; });

        // مفاتيح AI — تُحمَّل من DB إن لم تكن في env
        if (!process.env.GEMINI_API_KEY    && cfg.gemini_api_key)    process.env.GEMINI_API_KEY    = cfg.gemini_api_key;
        if (!process.env.OPENAI_API_KEY    && cfg.openai_api_key)    process.env.OPENAI_API_KEY    = cfg.openai_api_key;
        if (!process.env.ANTHROPIC_API_KEY && cfg.anthropic_api_key) process.env.ANTHROPIC_API_KEY = cfg.anthropic_api_key;
        if (!process.env.GEMINI_MODEL      && cfg.gemini_model)      process.env.GEMINI_MODEL      = cfg.gemini_model;
        if (!process.env.OPENAI_MODEL      && cfg.openai_model)      process.env.OPENAI_MODEL      = cfg.openai_model;
        if (!process.env.ANTHROPIC_MODEL   && cfg.anthropic_model)   process.env.ANTHROPIC_MODEL   = cfg.anthropic_model;
        if (!process.env.DEFAULT_AI_PROVIDER && cfg.active_provider) process.env.DEFAULT_AI_PROVIDER = cfg.active_provider;

        // FRONTEND_URL للـ CORS
        if (!process.env.FRONTEND_URL && cfg.frontend_url) process.env.FRONTEND_URL = cfg.frontend_url;

        console.log('✅ تم تحميل الإعدادات من قاعدة البيانات');
    } catch (e) {
        console.warn('⚠️  لم يتم تحميل الإعدادات من DB:', e.message);
    }
}

// ── CORS (يُحدَّث من DB كل تشغيل) ───────────────────────────
function getCorsOptions() {
    return {
        origin: function(origin, callback) {
            if (!origin) return callback(null, true);
            const allowed = [
                process.env.FRONTEND_URL,
                'http://localhost:3000',
                'http://localhost:5500',
                'http://127.0.0.1:5500',
            ].filter(Boolean);
            if (allowed.includes(origin)) return callback(null, true);
            // في وضع التطوير اسمح بكل شيء (احذف هذا في الإنتاج)
            if (process.env.NODE_ENV !== 'production') return callback(null, true);
            callback(new Error('CORS: النطاق غير مسموح — ' + origin));
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    };
}

app.use((req, res, next) => cors(getCorsOptions())(req, res, next));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Rate Limiting ─────────────────────────────────────────────
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { ok: false, error: 'كثير من الطلبات — انتظر قليلاً' },
    standardHeaders: true,
}));

const generateLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 20,
    message: { ok: false, error: 'تجاوزت حد التوليد — انتظر 10 دقائق' },
});

// ── Routes ────────────────────────────────────────────────────
const authRoutes       = require('./routes/auth');
const chaptersRoutes   = require('./routes/chapters');
const generateRoutes   = require('./routes/generate');
const charactersRoutes = require('./routes/characters');
const libraryRoutes    = require('./routes/library');
const wizardRoutes     = require('./routes/wizard');
const configRoutes     = require('./routes/config');
const exportRoutes     = require('./routes/export');

app.use('/api/auth',       authRoutes);
app.use('/api/chapters',   chaptersRoutes);
app.use('/api/generate',   generateLimiter, generateRoutes);
app.use('/api/characters', charactersRoutes);
app.use('/api/library',    libraryRoutes);
app.use('/api/wizard',     wizardRoutes);
app.use('/api/config',     configRoutes);
app.use('/api/export',     exportRoutes);

// ── Health & Ping ─────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({
        ok:       true,
        service:  'Story Engine Backend',
        version:  '2.0.0',
        provider: process.env.DEFAULT_AI_PROVIDER || 'not set',
        time:     new Date().toISOString(),
    });
});

// UptimeRobot يستخدم هذا: https://your-app.onrender.com/ping
app.get('/ping', (req, res) => res.status(200).send('pong'));

app.get('/', (req, res) => res.json({ ok: true, message: 'Story Engine API 🚀' }));

// ── 404 & Error Handler ───────────────────────────────────────
app.use((req, res) => res.status(404).json({ ok: false, error: 'المسار غير موجود: ' + req.path }));

app.use((err, req, res, next) => {
    console.error('Server Error:', err.message);
    if (err.message?.startsWith('CORS')) return res.status(403).json({ ok: false, error: err.message });
    res.status(500).json({ ok: false, error: 'خطأ داخلي في الخادم' });
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

async function start() {
    await loadConfigFromDB();
    app.listen(PORT, () => {
        console.log(`✅ Story Engine Backend — port ${PORT}`);
        console.log(`🤖 AI Provider: ${process.env.DEFAULT_AI_PROVIDER || 'not set yet — اضبطه من الإعدادات'}`);
        console.log(`🌍 Frontend URL: ${process.env.FRONTEND_URL || 'not set yet — اضبطه من الإعدادات'}`);
    });
}

start();


const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');

const app = express();

// ── CORS ──────────────────────────────────────────────────────
const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'http://localhost:5500',
    // أضف نطاقك هنا
].filter(Boolean);

app.use(cors({
    origin: function(origin, callback) {
        // السماح بطلبات بدون origin (Postman, mobile)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error('CORS: النطاق غير مسموح — ' + origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
}));

// ── Helmet (HTTP Security Headers) ───────────────────────────
app.use(helmet({
    contentSecurityPolicy: false, // نتحكم فيه من الـ frontend
}));

// ── Body Parsing ──────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Rate Limiting ─────────────────────────────────────────────
// عام: 100 طلب / 15 دقيقة
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { ok: false, error: 'كثير من الطلبات — انتظر قليلاً' },
    standardHeaders: true,
}));

// للتوليد: 20 طلب / 10 دقائق
const generateLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 20,
    message: { ok: false, error: 'تجاوزت حد التوليد — انتظر 10 دقائق' },
});

// ── Routes ────────────────────────────────────────────────────
const authRoutes       = require('./routes/auth');
const chaptersRoutes   = require('./routes/chapters');
const generateRoutes   = require('./routes/generate');
const charactersRoutes = require('./routes/characters');
const libraryRoutes    = require('./routes/library');
const wizardRoutes     = require('./routes/wizard');
const configRoutes     = require('./routes/config');
const exportRoutes     = require('./routes/export');

app.use('/api/auth',       authRoutes);
app.use('/api/chapters',   chaptersRoutes);
app.use('/api/generate',   generateLimiter, generateRoutes);
app.use('/api/characters', charactersRoutes);
app.use('/api/library',    libraryRoutes);
app.use('/api/wizard',     wizardRoutes);
app.use('/api/config',     configRoutes);
app.use('/api/export',     exportRoutes);

// ── Health Check (Render يستخدمه للـ ping) ───────────────────
app.get('/health', (req, res) => {
    res.json({
        ok:      true,
        service: 'Story Engine Backend',
        version: '2.0.0',
        time:    new Date().toISOString(),
    });
});

// ── Ping endpoint (UptimeRobot يستخدمه كل 5 دقائق) ──────────
// أضف هذا الرابط في UptimeRobot:
// https://your-app.onrender.com/ping
// نوع المراقبة: HTTP(s) — كل 5 دقائق
app.get('/ping', (req, res) => {
    res.status(200).send('pong');
});

app.get('/', (req, res) => {
    res.json({ ok: true, message: 'Story Engine API is running 🚀' });
});

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({ ok: false, error: 'المسار غير موجود: ' + req.path });
});

// ── Error Handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('Server Error:', err.message);
    if (err.message && err.message.startsWith('CORS')) {
        return res.status(403).json({ ok: false, error: err.message });
    }
    res.status(500).json({ ok: false, error: 'خطأ داخلي في الخادم' });
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Story Engine Backend running on port ${PORT}`);
    console.log(`🌍 Frontend URL: ${process.env.FRONTEND_URL || 'not set'}`);
    console.log(`🤖 Default AI: ${process.env.DEFAULT_AI_PROVIDER || 'gemini'}`);
});
