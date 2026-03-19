const express = require('express');
const router  = express.Router();
const { requireAuth }   = require('../middleware/auth');
const { generate }      = require('../services/ai');
const { supabase, setConfig } = require('../services/supabase');

function parseJson(text) {
    const clean = text.replace(/```json\s*/gi,'').replace(/```/g,'').trim();
    const s = clean.indexOf('{'), e = clean.lastIndexOf('}');
    if (s < 0 || e < 0) return null;
    try { return JSON.parse(clean.substring(s, e+1)); } catch(err) { return null; }
}

// POST /api/wizard/concept
router.post('/concept', requireAuth, async (req, res) => {
    const { seed_idea, chapter_count = 20 } = req.body;
    if (!seed_idea) return res.status(400).json({ ok: false, error: 'الفكرة مطلوبة' });

    const prompt = `أنت مستشار أدبي. ولّد تصوراً كاملاً لرواية عربية من هذه الفكرة: "${seed_idea}" (${chapter_count} فصل).
أجب بـ JSON فقط:
{"novel_title":"...","genre":"واقعي|خيال_علمي|تشويق_غموض|رومانسي|فانتازيا|تاريخي|رعب|مغامرة","tagline":"...","narrative_style":"...","time_setting":"...","main_theme":"...","plot_summary":"...","act_1":"...","act_2":"...","act_3":"...","tone":"...","unique_element":"...","author_style_notes":"..."}`;

    const result = await generate(prompt, { max_tokens: 1500 });
    if (!result.ok) return res.status(500).json(result);

    const concept = parseJson(result.text);
    if (!concept)  return res.status(500).json({ ok: false, error: 'فشل تحليل الاستجابة' });

    // حفظ جلسة
    const sessionKey = require('crypto').randomBytes(16).toString('hex');
    await supabase.from('wizard_sessions').insert({
        session_key: sessionKey, step: 1,
        concept: JSON.stringify(concept),
    }).catch(() => {});

    res.json({ ok: true, session_key: sessionKey, concept });
});

// POST /api/wizard/characters
router.post('/characters', requireAuth, async (req, res) => {
    const { session_key, user_edits = {} } = req.body;
    if (!session_key) return res.status(400).json({ ok: false, error: 'session_key مطلوب' });

    const { data: session } = await supabase.from('wizard_sessions').select('*').eq('session_key', session_key).single();
    if (!session) return res.status(404).json({ ok: false, error: 'الجلسة غير موجودة' });

    const concept = { ...JSON.parse(session.concept), ...user_edits };

    const prompt = `أنت روائي. أنشئ شخصيات لرواية "${concept.novel_title}" (${concept.genre}).
الحبكة: ${concept.plot_summary}
أجب بـ JSON فقط:
{"characters":[{"name":"...","role":"...","age":"...","status":"alive","personality":"...","motivation":"...","arc":"...","is_main":true,"first_appearance_chapter":1}]}
أنشئ 3-5 شخصيات رئيسية و2-3 ثانوية.`;

    const result = await generate(prompt, { max_tokens: 2000 });
    if (!result.ok) return res.status(500).json(result);

    const data = parseJson(result.text);
    if (!data?.characters) return res.status(500).json({ ok: false, error: 'فشل تحليل الشخصيات' });

    await supabase.from('wizard_sessions').update({
        step: 2, concept: JSON.stringify(concept), characters: JSON.stringify(data),
    }).eq('session_key', session_key);

    res.json({ ok: true, session_key, characters: data.characters, concept });
});

// POST /api/wizard/plan
router.post('/plan', requireAuth, async (req, res) => {
    const { session_key, chapter_count = 20, user_edits = {} } = req.body;
    if (!session_key) return res.status(400).json({ ok: false, error: 'session_key مطلوب' });

    const { data: session } = await supabase.from('wizard_sessions').select('*').eq('session_key', session_key).single();
    if (!session) return res.status(404).json({ ok: false, error: 'الجلسة غير موجودة' });

    const concept   = JSON.parse(session.concept);
    const charsData = JSON.parse(session.characters || '{"characters":[]}');
    if (user_edits.characters) charsData.characters = user_edits.characters;

    const charList = charsData.characters.map(c => `- ${c.name}: ${c.role}`).join('\n');

    const prompt = `خطط ${chapter_count} فصلاً لرواية "${concept.novel_title}".
الحبكة: ${concept.plot_summary}
الشخصيات:
${charList}
ف١: ${concept.act_1} | ف٢: ${concept.act_2} | ف٣: ${concept.act_3}
أجب بـ JSON فقط:
{"chapter_plan":[{"chapter_num":1,"title":"...","goal":"...","key_events":"...","arc":"act_1","tone":"...","ends_with":"..."}]}`;

    const result = await generate(prompt, { max_tokens: 3000 });
    if (!result.ok) return res.status(500).json(result);

    const planData = parseJson(result.text);
    if (!planData?.chapter_plan) return res.status(500).json({ ok: false, error: 'فشل تحليل الخطة' });

    // حفظ كل شيء في Supabase
    try {
        // إعدادات الرواية
        await setConfig('novel_title',   concept.novel_title);
        await setConfig('default_genre', concept.genre);
        await setConfig('author_style',  concept.author_style_notes || '');
        await setConfig('chapter_plan',  JSON.stringify(planData.chapter_plan));
        await setConfig('wizard_novel_meta', JSON.stringify({
            tagline:         concept.tagline,
            narrative_style: concept.narrative_style,
            time_setting:    concept.time_setting,
            main_theme:      concept.main_theme,
            unique_element:  concept.unique_element,
            tone:            concept.tone,
        }));

        // حذف الشخصيات القديمة وإضافة الجديدة
        await supabase.from('characters').delete().neq('id', 0);
        for (const char of charsData.characters) {
            await supabase.from('characters').insert({
                name:  char.name, role: char.role, status: 'alive',
                notes: [char.personality, char.motivation, char.arc].filter(Boolean).join(' | '),
                first_appearance_chapter: char.first_appearance_chapter || 1,
            });
        }

        // تحديث الجلسة
        await supabase.from('wizard_sessions').update({
            step: 3, chapter_plan: JSON.stringify(planData), status: 'completed',
        }).eq('session_key', session_key);

    } catch (e) {
        return res.status(500).json({ ok: false, error: 'خطأ في الحفظ: ' + e.message });
    }

    res.json({
        ok: true,
        chapter_plan: planData.chapter_plan,
        characters:   charsData.characters,
        concept,
        saved: true,
    });
});

module.exports = router;
