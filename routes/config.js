const express = require('express');
const router  = express.Router();
const { requireAuth }          = require('../middleware/auth');
const { supabase }             = require('../services/supabase');
const { getConfig, setConfig } = require('../services/supabase');
const { testProvider, PROVIDERS, OPENROUTER_FREE_MODELS } = require('../services/ai');

// مفاتيح DB → متغيرات البيئة
const ENV_MAP = {
    gemini_api_key:       'GEMINI_API_KEY',
    openai_api_key:       'OPENAI_API_KEY',
    anthropic_api_key:    'ANTHROPIC_API_KEY',
    openrouter_api_key:   'OPENROUTER_API_KEY',
    gemini_model:         'GEMINI_MODEL',
    openai_model:         'OPENAI_MODEL',
    anthropic_model:      'ANTHROPIC_MODEL',
    openrouter_model:     'OPENROUTER_MODEL',
    active_provider:      'DEFAULT_AI_PROVIDER',
    frontend_url:         'FRONTEND_URL',
};

// GET /api/config
router.get('/', requireAuth, async (req, res) => {
    try {
        const { data } = await supabase.from('config').select('key, value');
        const cfg = {};
        (data || []).forEach(r => { cfg[r.key] = r.value; });
        res.json({ ok: true, config: cfg });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// POST /api/config
router.post('/', requireAuth, async (req, res) => {
    try {
        const { settings } = req.body;
        if (!settings || typeof settings !== 'object')
            return res.status(400).json({ ok: false, error: 'settings مطلوب' });

        for (const [key, value] of Object.entries(settings)) {
            const val = String(value);
            await setConfig(key, val);
            if (ENV_MAP[key] && val) process.env[ENV_MAP[key]] = val;
        }
        res.json({ ok: true, saved: Object.keys(settings).length });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// POST /api/config/test-ai
router.post('/test-ai', requireAuth, async (req, res) => {
    const { provider } = req.body;
    if (!provider) return res.status(400).json({ ok: false, error: 'provider مطلوب' });
    res.json(await testProvider(provider));
});

// GET /api/config/providers — يشمل OpenRouter والنماذج المجانية
router.get('/providers', requireAuth, (req, res) => {
    const list = Object.entries(PROVIDERS).map(([key, p]) => ({
        key, name: p.name, model: p.model(), enabled: p.enabled(),
    }));
    res.json({
        ok: true,
        providers: list,
        active: process.env.DEFAULT_AI_PROVIDER || 'gemini',
        openrouter_free_models: OPENROUTER_FREE_MODELS,
    });
});

module.exports = router;
