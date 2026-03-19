// ============================================================
//  Story Engine v2 — lib/ai.js
//  AI Providers: Gemini, OpenAI, Anthropic
//  يدعم: Streaming + Failover + Cache
// ============================================================
const fetch = require('node-fetch');

// ── Cache بسيط في الذاكرة ────────────────────────────────────
const cache = new Map();
const CACHE_TTL = (parseInt(process.env.CACHE_TTL_MINUTES) || 60) * 60 * 1000;

function cacheKey(provider, prompt) {
    // نستخدم أول 200 حرف كمفتاح
    return `${provider}:${prompt.substring(0, 200)}`;
}

function fromCache(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.time > CACHE_TTL) { cache.delete(key); return null; }
    return entry.value;
}

function toCache(key, value) {
    cache.set(key, { value, time: Date.now() });
    // تنظيف Cache إذا تجاوز 100 مدخل
    if (cache.size > 100) {
        const oldest = cache.keys().next().value;
        cache.delete(oldest);
    }
}

// ════════════════════════════════════════════════════════════
//  الدالة الرئيسية — توليد عادي (بدون streaming)
// ════════════════════════════════════════════════════════════
async function generate(prompt, options = {}) {
    const provider  = options.provider || process.env.DEFAULT_AI_PROVIDER || 'gemini';
    const maxTokens = options.maxTokens || 4096;
    const useCache  = options.useCache !== false;

    // تحقق من الـ Cache
    if (useCache) {
        const cached = fromCache(cacheKey(provider, prompt));
        if (cached) return { ok: true, text: cached, provider, fromCache: true };
    }

    // محاولة التوليد مع Failover
    const providers = buildProviderOrder(provider);

    for (const p of providers) {
        try {
            const result = await callProvider(p, prompt, maxTokens);
            if (result.ok) {
                if (useCache) toCache(cacheKey(p, prompt), result.text);
                return { ...result, provider: p };
            }
            console.warn(`[AI] ${p} فشل: ${result.error} — جرب التالي`);
        } catch (err) {
            console.warn(`[AI] ${p} خطأ: ${err.message}`);
        }
    }

    return { ok: false, error: 'فشل جميع مزوّدي AI' };
}

// ════════════════════════════════════════════════════════════
//  Streaming — يُرسل النص تدريجياً عبر SSE
// ════════════════════════════════════════════════════════════
async function generateStream(prompt, res, options = {}) {
    const provider  = options.provider || process.env.DEFAULT_AI_PROVIDER || 'gemini';
    const maxTokens = options.maxTokens || 4096;

    // إعداد SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const sendEvent = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const providers = buildProviderOrder(provider);

    for (const p of providers) {
        try {
            sendEvent('provider', { provider: p });
            const success = await streamProvider(p, prompt, maxTokens, sendEvent);
            if (success) {
                sendEvent('done', { ok: true, provider: p });
                res.end();
                return;
            }
        } catch (err) {
            console.warn(`[Stream] ${p} خطأ: ${err.message}`);
            sendEvent('error', { provider: p, error: err.message });
        }
    }

    sendEvent('error', { error: 'فشل جميع مزوّدي AI' });
    res.end();
}

// ── ترتيب المزوّدين مع Failover ──────────────────────────────
function buildProviderOrder(primary) {
    const all = ['gemini', 'openai', 'anthropic'];
    return [primary, ...all.filter(p => p !== primary)].filter(p => {
        if (p === 'gemini')    return !!process.env.GEMINI_API_KEY;
        if (p === 'openai')    return !!process.env.OPENAI_API_KEY;
        if (p === 'anthropic') return !!process.env.ANTHROPIC_API_KEY;
        return false;
    });
}

// ════════════════════════════════════════════════════════════
//  مزوّدو AI — توليد عادي
// ════════════════════════════════════════════════════════════
async function callProvider(provider, prompt, maxTokens) {
    if (provider === 'gemini')    return callGemini(prompt, maxTokens);
    if (provider === 'openai')    return callOpenAI(prompt, maxTokens);
    if (provider === 'anthropic') return callAnthropic(prompt, maxTokens);
    return { ok: false, error: 'مزوّد غير معروف' };
}

async function callGemini(prompt, maxTokens) {
    const key   = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: maxTokens, temperature: 0.85, topP: 0.95 },
            safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            ]
        })
    });

    const data = await res.json();
    if (data.error) return { ok: false, error: `Gemini: ${data.error.message}` };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return { ok: false, error: `Gemini: لا يوجد نص (${data.candidates?.[0]?.finishReason})` };
    return { ok: true, text, model };
}

async function callOpenAI(prompt, maxTokens) {
    const key   = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || 'gpt-4o';

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: maxTokens,
            temperature: 0.85
        })
    });

    const data = await res.json();
    if (data.error) return { ok: false, error: `OpenAI: ${data.error.message}` };
    const text = data.choices?.[0]?.message?.content;
    if (!text) return { ok: false, error: 'OpenAI: لا يوجد نص' };
    return { ok: true, text, model };
}

async function callAnthropic(prompt, maxTokens) {
    const key   = process.env.ANTHROPIC_API_KEY;
    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            messages: [{ role: 'user', content: prompt }]
        })
    });

    const data = await res.json();
    if (data.error) return { ok: false, error: `Anthropic: ${data.error.message}` };
    const text = data.content?.[0]?.text;
    if (!text) return { ok: false, error: 'Anthropic: لا يوجد نص' };
    return { ok: true, text, model };
}

// ════════════════════════════════════════════════════════════
//  مزوّدو AI — Streaming
// ════════════════════════════════════════════════════════════
async function streamProvider(provider, prompt, maxTokens, sendEvent) {
    if (provider === 'gemini')    return streamGemini(prompt, maxTokens, sendEvent);
    if (provider === 'openai')    return streamOpenAI(prompt, maxTokens, sendEvent);
    if (provider === 'anthropic') return streamAnthropic(prompt, maxTokens, sendEvent);
    return false;
}

async function streamGemini(prompt, maxTokens, sendEvent) {
    const key   = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${key}&alt=sse`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: maxTokens, temperature: 0.85 },
            safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            ]
        })
    });

    if (!res.ok) return false;

    let fullText = '';
    const reader = res.body;

    for await (const chunk of reader) {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
                const data = JSON.parse(line.slice(6));
                const piece = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                if (piece) {
                    fullText += piece;
                    sendEvent('chunk', { text: piece });
                }
            } catch (_) {}
        }
    }

    return fullText.length > 0;
}

async function streamOpenAI(prompt, maxTokens, sendEvent) {
    const key   = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || 'gpt-4o';

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: maxTokens,
            temperature: 0.85,
            stream: true
        })
    });

    if (!res.ok) return false;

    let fullText = '';
    for await (const chunk of res.body) {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
            if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
            try {
                const data  = JSON.parse(line.slice(6));
                const piece = data.choices?.[0]?.delta?.content || '';
                if (piece) {
                    fullText += piece;
                    sendEvent('chunk', { text: piece });
                }
            } catch (_) {}
        }
    }

    return fullText.length > 0;
}

async function streamAnthropic(prompt, maxTokens, sendEvent) {
    const key   = process.env.ANTHROPIC_API_KEY;
    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            stream: true,
            messages: [{ role: 'user', content: prompt }]
        })
    });

    if (!res.ok) return false;

    let fullText = '';
    for await (const chunk of res.body) {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
                const data  = JSON.parse(line.slice(6));
                const piece = data.delta?.text || '';
                if (piece) {
                    fullText += piece;
                    sendEvent('chunk', { text: piece });
                }
            } catch (_) {}
        }
    }

    return fullText.length > 0;
}

module.exports = { generate, generateStream };
