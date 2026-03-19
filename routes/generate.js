// ============================================================
//  Story Engine — routes/generate.js
//  توليد الفصول مع Streaming
// ============================================================
const express  = require('express');
const router   = express.Router();
const { requireAuth }         = require('../middleware/auth');
const { buildChapterPrompt, buildConsistencyPrompt, extractSummary } = require('../services/prompt');
const { generate, stream }    = require('../services/ai');
const { insert, update, fetchOne, fetchAll, setConfig } = require('../services/supabase');

// ── POST /api/generate/stream ─────────────────────────────────
// توليد فصل مع Streaming (النص يظهر تدريجياً)
router.post('/stream', requireAuth, async (req, res) => {
    const {
        chapter_num, title = '', goal, genre = 'واقعي',
        min_chars = 2000, max_chars = 8000,
        custom_rules = '',
    } = req.body;

    if (!chapter_num || chapter_num < 1) {
        return res.status(400).json({ ok: false, error: 'رقم الفصل مطلوب' });
    }
    if (!goal || goal.trim().length < 5) {
        return res.status(400).json({ ok: false, error: 'هدف الفصل مطلوب' });
    }

    let prompt;
    try {
        prompt = await buildChapterPrompt({
            chapter_num: parseInt(chapter_num),
            title, goal, genre,
            min_chars: parseInt(min_chars),
            max_chars: parseInt(max_chars),
            custom_rules,
        });
    } catch (e) {
        return res.status(500).json({ ok: false, error: 'خطأ في بناء الـ Prompt: ' + e.message });
    }

    const startTime = Date.now();
    const maxTokens = Math.min(8000, Math.max(1000, Math.ceil(parseInt(max_chars) * 0.4) + 500));

    // Streaming — يرسل النص حرفاً بحرف عبر SSE
    // الـ response يكون SSE، ويُرسل event "done" في النهاية مع كامل النص
    await stream(prompt, res, { max_tokens: maxTokens });

    // ملاحظة: الحفظ في DB يتم من endpoint منفصل بعد انتهاء الـ stream
});

// ── POST /api/generate/save ────────────────────────────────────
// حفظ الفصل بعد انتهاء الـ streaming
router.post('/save', requireAuth, async (req, res) => {
    const {
        chapter_num, title = '', goal = '', genre = 'واقعي',
        text, provider = 'unknown', duration = 0,
    } = req.body;

    if (!text || text.trim().length < 100) {
        return res.status(400).json({ ok: false, error: 'النص قصير جداً' });
    }

    const { text: cleanText, summary } = extractSummary(text);
    const charCount = cleanText.length;

    try {
        // تحقق من وجود الفصل
        const existing = await fetchOne('chapters', { chapter_num: parseInt(chapter_num) });

        let chapter;
        if (existing) {
            const updated = await update('chapters', { chapter_num: parseInt(chapter_num) }, {
                title, summary, content: cleanText, genre, goal,
                char_count: charCount, ai_provider: provider,
                updated_at: new Date().toISOString(),
            });
            chapter = updated[0];
        } else {
            chapter = await insert('chapters', {
                chapter_num: parseInt(chapter_num),
                title, summary, content: cleanText, genre, goal,
                char_count: charCount, ai_provider: provider,
            });
        }

        // سجل التوليد
        await insert('generation_log', {
            chapter_num:  parseInt(chapter_num),
            provider,
            duration_ms:  parseInt(duration),
            status:       'success',
        }).catch(() => {});

        // super-summary كل 10 فصول
        if (parseInt(chapter_num) % 10 === 0) {
            await generateArcSummary(parseInt(chapter_num)).catch(() => {});
        }

        res.json({
            ok:          true,
            chapter_id:  chapter?.id,
            chapter_num: parseInt(chapter_num),
            summary,
            char_count:  charCount,
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'خطأ في الحفظ: ' + e.message });
    }
});

// ── POST /api/generate/check ───────────────────────────────────
// فحص التناسق بعد التوليد
router.post('/check', requireAuth, async (req, res) => {
    const { text, chapter_num } = req.body;
    if (!text) return res.status(400).json({ ok: false, error: 'النص مطلوب' });

    const issues = await runLocalConsistencyCheck(text, parseInt(chapter_num || 1));
    res.json({ ok: true, ...issues });
});

// ── GET /api/generate/next-chapter ────────────────────────────
// جلب معلومات الفصل التالي من الخطة
router.get('/next-chapter', requireAuth, async (req, res) => {
    try {
        const rows = await fetchAll('chapters', {}, 'chapter_num');
        const nums = rows.map(r => r.chapter_num).sort((a, b) => a - b);
        const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;

        // جلب خطة الفصل إن وجدت
        const planRow = await fetchOne('config', { key: 'chapter_plan' }, 'value');
        let planEntry = null;
        if (planRow) {
            try {
                const plan = JSON.parse(planRow.value);
                planEntry  = Array.isArray(plan) ? plan.find(p => p.chapter_num === next) : null;
            } catch (e) {}
        }

        res.json({ ok: true, next_chapter: next, plan: planEntry });
    } catch (e) {
        res.json({ ok: true, next_chapter: 1, plan: null });
    }
});

// ── POST /api/generate/full ────────────────────────────────────
// توليد بدون streaming (fallback للأجهزة القديمة)
router.post('/full', requireAuth, async (req, res) => {
    const {
        chapter_num, title = '', goal, genre = 'واقعي',
        min_chars = 2000, max_chars = 8000, custom_rules = '',
    } = req.body;

    if (!goal) return res.status(400).json({ ok: false, error: 'هدف الفصل مطلوب' });

    const prompt = await buildChapterPrompt({
        chapter_num: parseInt(chapter_num), title, goal, genre,
        min_chars: parseInt(min_chars), max_chars: parseInt(max_chars), custom_rules,
    });

    const maxTokens = Math.min(8000, Math.ceil(parseInt(max_chars) * 0.4) + 500);
    const result    = await generate(prompt, { max_tokens: maxTokens });

    if (!result.ok) return res.status(500).json(result);

    const { text, summary } = extractSummary(result.text);
    res.json({ ok: true, text, summary, provider: result.provider, model: result.model });
});

// ── دوال مساعدة ──────────────────────────────────────────────
async function runLocalConsistencyCheck(text, chapterNum) {
    const issues = [];

    // فحص الشخصيات الميتة
    try {
        const deadChars = await fetchAll('characters', { status: 'dead' }, 'name');
        for (const char of deadChars) {
            const pattern = new RegExp(char.name + '.{0,50}(قال|قالت|فعل|ذهب|يقف|ينظر)', 'u');
            if (pattern.test(text)) {
                issues.push({
                    type:        'resurrection',
                    description: `"${char.name}" متوفية لكنها تبدو حية`,
                    severity:    'high',
                });
            }
        }
    } catch (e) {}

    // فحص الطول
    const textOnly = text.replace(/\nSUMMARY:.*$/su, '');
    const len      = textOnly.length;
    if (len < 500) {
        issues.push({ type: 'length', description: `النص قصير جداً (${len} حرف)`, severity: 'medium' });
    }

    // فحص SUMMARY
    if (!/\nSUMMARY:/i.test(text)) {
        issues.push({ type: 'missing_summary', description: 'لا يوجد سطر SUMMARY', severity: 'medium' });
    }

    const hasCritical = issues.some(i => i.severity === 'high');
    return {
        issues,
        overall:  hasCritical ? 'critical' : issues.length > 0 ? 'warning' : 'ok',
        ok:       !hasCritical,
    };
}

async function generateArcSummary(chapterNum) {
    const arcNum = Math.floor((chapterNum - 1) / 10);
    const start  = arcNum * 10 + 1;
    const end    = start + 9;

    const chapters = await fetchAll('chapters', {}, 'chapter_num, title, summary');
    const filtered = chapters
        .filter(c => c.chapter_num >= start && c.chapter_num <= end && c.summary)
        .sort((a, b) => a.chapter_num - b.chapter_num);

    if (filtered.length === 0) return;

    const superSummary = filtered.map(c => {
        const t = c.title ? ` (${c.title})` : '';
        return `ف${c.chapter_num}${t}: ${c.summary}`;
    }).join(' | ').substring(0, 1500);

    await setConfig(`super_summary_${arcNum}`, superSummary);
}

module.exports = router;
