// ============================================================
//  Story Engine Backend — server.js  v2.1
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

// ── تحميل كل الإعدادات من DB عند الإقلاع ────────────────────
async function loadConfigFromDB() {
    try {
        const { supabase } = require('./services/supabase');
        const { data } = await supabase.from('config').select('key, value');
        if (!data) return;

        // خريطة كاملة: مفتاح DB → متغير بيئة
        const map = {
            gemini_api_key:     'GEMINI_API_KEY',
            openai_api_key:     'OPENAI_API_KEY',
            anthropic_api_key:  'ANTHROPIC_API_KEY',
            openrouter_api_key: 'OPENROUTER_API_KEY',
            gemini_model:       'GEMINI_MODEL',
            openai_model:       'OPENAI_MODEL',
            anthropic_model:    'ANTHROPIC_MODEL',
            openrouter_model:   'OPENROUTER_MODEL',
            active_provider:    'DEFAULT_AI_PROVIDER',
            frontend_url:       'FRONTEND_URL',
        };

        let loaded = 0;
        data.forEach(row => {
            const envKey = map[row.key];
            if (envKey && row.value && row.value.trim()) {
                // دائماً اكتب فوق — قيمة DB أولوية على .env
                process.env[envKey] = row.value.trim();
                loaded++;
            }
        });

        console.log(`✅ تم تحميل ${loaded} إعداد من قاعدة البيانات`);

        // تسجيل حالة المزوّدين
        const providers = ['GEMINI_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY','OPENROUTER_API_KEY'];
        providers.forEach(k => {
            if (process.env[k]) console.log(`  🔑 ${k}: مضبوط`);
        });
        console.log(`  🤖 DEFAULT_AI_PROVIDER: ${process.env.DEFAULT_AI_PROVIDER || 'gemini (افتراضي)'}`);

    } catch (e) {
        console.warn('⚠️  خطأ في تحميل الإعدادات من DB:', e.message);
    }
}

// ── CORS ─────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
    'https://vireon.rf.gd',
    'https://www.vireon.rf.gd',
    'http://localhost:3000',
    'http://localhost:5500',
    'http://localhost:8080',
    'http://127.0.0.1:5500',
    'http://127.0.0.1:8080',
    'null', // file:// للتطوير المحلي
].filter(Boolean);

app.use((req, res, next) => {
    const dynamicOrigins = [process.env.FRONTEND_URL].filter(Boolean);
    const allOrigins = [...ALLOWED_ORIGINS, ...dynamicOrigins];

    cors({
        origin: (origin, callback) => {
            // طلبات بدون origin (server-to-server، curl)
            if (!origin) return callback(null, true);
            const clean = origin.replace(/\/$/, '');
            const allowed = allOrigins.some(a => a.replace(/\/$/, '') === clean);
            if (allowed) return callback(null, true);
            callback(new Error('CORS: غير مسموح — ' + origin));
        },
        credentials: true,
        methods:      ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders:['Content-Type', 'Authorization'],
    })(req, res, next);
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Rate Limiting ─────────────────────────────────────────────
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200, // زيادة الحد العام
    message: { ok: false, error: 'كثير من الطلبات، انتظر قليلاً' },
    standardHeaders: true,
    legacyHeaders: false,
}));

const generateLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 30,
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

// ── Health ────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    const { PROVIDERS } = require('./services/ai');
    const provStatus = {};
    Object.entries(PROVIDERS).forEach(([k, p]) => {
        provStatus[k] = p.enabled() ? '✅' : '❌';
    });
    res.json({
        ok:        true,
        service:   'Story Engine Backend',
        version:   '2.1.0',
        provider:  process.env.DEFAULT_AI_PROVIDER || 'not set',
        providers: provStatus,
        time:      new Date().toISOString(),
    });
});

app.get('/ping', (req, res) => res.status(200).send('pong'));
app.get('/',     (req, res) => res.json({ ok: true, message: 'Story Engine API v2.1 🚀' }));

// ── 404 & Errors ──────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ ok: false, error: 'غير موجود: ' + req.path }));
app.use((err, req, res, next) => {
    if (err.message?.startsWith('CORS'))
        return res.status(403).json({ ok: false, error: err.message });
    console.error('❌ خطأ داخلي:', err.message);
    res.status(500).json({ ok: false, error: 'خطأ داخلي في الخادم' });
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

async function start() {
    await loadConfigFromDB();
    app.listen(PORT, () => {
        console.log(`\n🚀 Story Engine Backend — port ${PORT}`);
        console.log(`🌍 Frontend: ${process.env.FRONTEND_URL || '(not set)'}`);
    });
}

start();
