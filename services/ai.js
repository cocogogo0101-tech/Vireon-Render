// ============================================================
//  Story Engine — services/ai.js
//  Gemini + OpenAI + Anthropic + OpenRouter مع Streaming وFailover
// ============================================================
const fetch = require('node-fetch');

// ── أفضل نماذج OpenRouter المجانية لكتابة الروايات ──────────
const OPENROUTER_FREE_MODELS = [
    { id: 'deepseek/deepseek-chat:free',               label: 'DeepSeek V3 (مجاني) — ممتاز للروايات' },
    { id: 'deepseek/deepseek-r1:free',                 label: 'DeepSeek R1 (مجاني) — تفكير عميق' },
    { id: 'meta-llama/llama-3.3-70b-instruct:free',    label: 'Llama 3.3 70B (مجاني) — قوي ومتوازن' },
    { id: 'google/gemini-2.0-flash-exp:free',          label: 'Gemini 2.0 Flash Exp (مجاني) — سريع' },
    { id: 'qwen/qwen-2.5-72b-instruct:free',           label: 'Qwen 2.5 72B (مجاني) — جيد للعربي' },
    { id: 'microsoft/phi-4:free',                       label: 'Microsoft Phi-4 (مجاني)' },
    { id: 'mistralai/mistral-nemo:free',               label: 'Mistral Nemo (مجاني)' },
];

// ── Provider Config ───────────────────────────────────────────
const PROVIDERS = {
    gemini: {
        name:    'Gemini',
        url:     'https://generativelanguage.googleapis.com/v1beta/models/',
        model:   () => process.env.GEMINI_MODEL || 'gemini-2.0-flash',
        key:     () => process.env.GEMINI_API_KEY,
        enabled: () => !!process.env.GEMINI_API_KEY,
    },
    openai: {
        name:    'OpenAI',
        url:     'https://api.openai.com/v1/chat/completions',
        model:   () => process.env.OPENAI_MODEL || 'gpt-4o',
        key:     () => process.env.OPENAI_API_KEY,
        enabled: () => !!process.env.OPENAI_API_KEY,
    },
    anthropic: {
        name:    'Anthropic',
        url:     'https://api.anthropic.com/v1/messages',
        model:   () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
        key:     () => process.env.ANTHROPIC_API_KEY,
        enabled: () => !!process.env.ANTHROPIC_API_KEY,
    },
    openrouter: {
        name:    'OpenRouter',
        url:     'https://openrouter.ai/api/v1/chat/completions',
        model:   () => process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat:free',
        key:     () => process.env.OPENROUTER_API_KEY,
        enabled: () => !!process.env.OPENROUTER_API_KEY,
    },
};

// ── قائمة Failover ────────────────────────────────────────────
function getProviderOrder() {
    const primary   = process.env.DEFAULT_AI_PROVIDER || 'gemini';
    const all       = Object.keys(PROVIDERS);
    const fallbacks = all.filter(p => p !== primary && PROVIDERS[p].enabled());
    return [primary, ...fallbacks];
}

// ════════════════════════════════════════════════════════════
//  GENERATE (بدون Streaming)
// ════════════════════════════════════════════════════════════
async function generate(prompt, options = {}) {
    const maxTokens = options.max_tokens || 4096;
    const order     = getProviderOrder();

    for (const providerName of order) {
        const provider = PROVIDERS[providerName];
        if (!provider.enabled()) continue;

        try {
            const result = await callProvider(providerName, prompt, maxTokens, false);
            return { ok: true, text: result.text, provider: providerName, model: provider.model() };
        } catch (err) {
            console.warn(`⚠️ ${provider.name} failed: ${err.message} — trying next...`);
        }
    }

    return { ok: false, error: 'كل مزوّدي AI فشلوا. تحقق من مفاتيح API.' };
}

// ════════════════════════════════════════════════════════════
//  STREAM — إرسال النص تدريجياً (SSE)
// ════════════════════════════════════════════════════════════
async function stream(prompt, res, options = {}) {
    const maxTokens = options.max_tokens || 4096;
    const order     = getProviderOrder();

    res.setHeader('Content-Type',      'text/event-stream');
    res.setHeader('Cache-Control',     'no-cache');
    res.setHeader('Connection',        'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const sendEvent = (event, data) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    for (const providerName of order) {
        const provider = PROVIDERS[providerName];
        if (!provider.enabled()) continue;

        try {
            sendEvent('start', { provider: providerName, model: provider.model() });
            let fullText = '';

            if (providerName === 'gemini') {
                fullText = await streamGemini(prompt, maxTokens, c => sendEvent('chunk', { text: c }));
            } else if (providerName === 'openai') {
                fullText = await streamOpenAI(prompt, maxTokens, c => sendEvent('chunk', { text: c }));
            } else if (providerName === 'anthropic') {
                fullText = await streamAnthropic(prompt, maxTokens, c => sendEvent('chunk', { text: c }));
            } else if (providerName === 'openrouter') {
                fullText = await streamOpenRouter(prompt, maxTokens, c => sendEvent('chunk', { text: c }));
            }

            sendEvent('done', { ok: true, text: fullText, provider: providerName, model: provider.model(), chars: fullText.length });
            res.end();
            return;

        } catch (err) {
            console.warn(`⚠️ Stream ${providerName} failed: ${err.message}`);
            sendEvent('error', { provider: providerName, error: err.message });
        }
    }

    sendEvent('fatal', { error: 'كل مزوّدي AI فشلوا' });
    res.end();
}

// ── Gemini Non-Streaming ──────────────────────────────────────
async function callGemini(prompt, maxTokens) {
    const key   = process.env.GEMINI_API_KEY;
    const model = PROVIDERS.gemini.model();
    const url   = `${PROVIDERS.gemini.url}${model}:generateContent?key=${key}`;
    const body  = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.85, topP: 0.95 },
        safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
    };
    const res  = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), timeout:120000 });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error?.message || `HTTP ${res.status}`);
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error(`Gemini لم يُعِد نصاً (${data.candidates?.[0]?.finishReason || 'UNKNOWN'})`);
    return text;
}

async function streamGemini(prompt, maxTokens, onChunk) {
    const key = process.env.GEMINI_API_KEY;
    const model = PROVIDERS.gemini.model();
    const url = `${PROVIDERS.gemini.url}${model}:streamGenerateContent?alt=sse&key=${key}`;
    const body = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.85 },
        safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
    };
    const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), timeout:180000 });
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).substring(0,200)}`);
    let fullText = '', buffer = '';
    for await (const chunk of res.body) {
        buffer += chunk.toString();
        const lines = buffer.split('\n'); buffer = lines.pop();
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') continue;
            try {
                const text = JSON.parse(raw).candidates?.[0]?.content?.parts?.[0]?.text || '';
                if (text) { fullText += text; onChunk(text); }
            } catch (e) {}
        }
    }
    return fullText;
}

// ── OpenAI Non-Streaming ──────────────────────────────────────
async function callOpenAI(prompt, maxTokens) {
    const res  = await fetch(PROVIDERS.openai.url, {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},
        body:JSON.stringify({ model:PROVIDERS.openai.model(), messages:[{role:'user',content:prompt}], max_tokens:maxTokens, temperature:0.85 }),
        timeout:120000,
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error?.message || `HTTP ${res.status}`);
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('OpenAI لم يُعِد نصاً');
    return text;
}

async function streamOpenAI(prompt, maxTokens, onChunk) {
    const res = await fetch(PROVIDERS.openai.url, {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},
        body:JSON.stringify({ model:PROVIDERS.openai.model(), messages:[{role:'user',content:prompt}], max_tokens:maxTokens, temperature:0.85, stream:true }),
        timeout:180000,
    });
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
    let fullText = '', buffer = '';
    for await (const chunk of res.body) {
        buffer += chunk.toString();
        const lines = buffer.split('\n'); buffer = lines.pop();
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') continue;
            try {
                const text = JSON.parse(raw).choices?.[0]?.delta?.content || '';
                if (text) { fullText += text; onChunk(text); }
            } catch (e) {}
        }
    }
    return fullText;
}

// ── Anthropic ─────────────────────────────────────────────────
async function callAnthropic(prompt, maxTokens) {
    const res  = await fetch(PROVIDERS.anthropic.url, {
        method:'POST',
        headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
        body:JSON.stringify({ model:PROVIDERS.anthropic.model(), max_tokens:maxTokens, messages:[{role:'user',content:prompt}] }),
        timeout:120000,
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error?.message || `HTTP ${res.status}`);
    const text = data.content?.[0]?.text;
    if (!text) throw new Error('Anthropic لم يُعِد نصاً');
    return text;
}

async function streamAnthropic(prompt, maxTokens, onChunk) {
    const res = await fetch(PROVIDERS.anthropic.url, {
        method:'POST',
        headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
        body:JSON.stringify({ model:PROVIDERS.anthropic.model(), max_tokens:maxTokens, stream:true, messages:[{role:'user',content:prompt}] }),
        timeout:180000,
    });
    if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`);
    let fullText = '', buffer = '';
    for await (const chunk of res.body) {
        buffer += chunk.toString();
        const lines = buffer.split('\n'); buffer = lines.pop();
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
                const parsed = JSON.parse(line.slice(6));
                if (parsed.type === 'content_block_delta') {
                    const text = parsed.delta?.text || '';
                    if (text) { fullText += text; onChunk(text); }
                }
            } catch (e) {}
        }
    }
    return fullText;
}

// ── OpenRouter (يدعم OpenAI-compatible API + Streaming) ───────
async function callOpenRouter(prompt, maxTokens) {
    const res = await fetch(PROVIDERS.openrouter.url, {
        method:'POST',
        headers:{
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'HTTP-Referer':  process.env.FRONTEND_URL || 'https://story-engine.app',
            'X-Title':       'Story Engine',
        },
        body:JSON.stringify({
            model:       PROVIDERS.openrouter.model(),
            messages:    [{ role:'user', content:prompt }],
            max_tokens:  maxTokens,
            temperature: 0.85,
        }),
        timeout:180000,
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error?.message || `HTTP ${res.status}`);
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('OpenRouter لم يُعِد نصاً');
    return text;
}

async function streamOpenRouter(prompt, maxTokens, onChunk) {
    const res = await fetch(PROVIDERS.openrouter.url, {
        method:'POST',
        headers:{
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'HTTP-Referer':  process.env.FRONTEND_URL || 'https://story-engine.app',
            'X-Title':       'Story Engine',
        },
        body:JSON.stringify({
            model:       PROVIDERS.openrouter.model(),
            messages:    [{ role:'user', content:prompt }],
            max_tokens:  maxTokens,
            temperature: 0.85,
            stream:      true,
        }),
        timeout:180000,
    });
    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`OpenRouter HTTP ${res.status}: ${errText.substring(0,200)}`);
    }
    let fullText = '', buffer = '';
    for await (const chunk of res.body) {
        buffer += chunk.toString();
        const lines = buffer.split('\n'); buffer = lines.pop();
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') continue;
            try {
                const text = JSON.parse(raw).choices?.[0]?.delta?.content || '';
                if (text) { fullText += text; onChunk(text); }
            } catch (e) {}
        }
    }
    return fullText;
}

// ── callProvider موحّد ────────────────────────────────────────
async function callProvider(providerName, prompt, maxTokens) {
    if (providerName === 'gemini')      return { text: await callGemini(prompt, maxTokens) };
    if (providerName === 'openai')      return { text: await callOpenAI(prompt, maxTokens) };
    if (providerName === 'anthropic')   return { text: await callAnthropic(prompt, maxTokens) };
    if (providerName === 'openrouter')  return { text: await callOpenRouter(prompt, maxTokens) };
    throw new Error('مزوّد غير معروف: ' + providerName);
}

// ── اختبار مزوّد ─────────────────────────────────────────────
async function testProvider(providerName) {
    const provider = PROVIDERS[providerName];
    if (!provider) return { ok: false, error: 'مزوّد غير موجود' };
    if (!provider.enabled()) return { ok: false, error: 'المفتاح غير مضبوط' };
    try {
        const result = await callProvider(providerName, 'قل "مرحبا" فقط.', 30);
        return { ok: true, response: result.text.substring(0, 60), model: provider.model() };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

module.exports = { generate, stream, testProvider, getProviderOrder, PROVIDERS, OPENROUTER_FREE_MODELS };
