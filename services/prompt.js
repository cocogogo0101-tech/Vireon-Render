// ============================================================
//  Story Engine — services/prompt.js
//  بناء الـ Prompt
// ============================================================
const { fetchAll, fetchOne, getConfig } = require('./supabase');

// ── Prompt الرئيسي لتوليد فصل ────────────────────────────────
async function buildChapterPrompt(data) {
    const {
        chapter_num, title = '', goal, genre = 'واقعي',
        min_chars = 2000, max_chars = 8000,
        custom_rules = '', novel_title = '', author_style = '',
    } = data;

    // جلب السياق من قاعدة البيانات
    const [prevSummaries, charsList, superSummary, styleProfile] = await Promise.all([
        getPreviousSummaries(chapter_num),
        getCharactersList(),
        getSuperSummary(chapter_num),
        getActiveStyleProfile(),
    ]);

    const novelTitleFinal  = novel_title || await getConfig('novel_title', 'روايتي');
    const authorStyleFinal = author_style || await getConfig('author_style', '');
    const chapterPlan      = await getChapterPlan(chapter_num);

    let prompt = `أنت روائي عربي خبير ومتمرس. مهمتك كتابة فصل جديد من رواية عربية بجودة أدبية عالية.

═══════════════════════════════════════════════════════
معلومات الرواية:
  • اسم الرواية: ${novelTitleFinal}
  • النوع الأدبي: ${genre}
  • الفصل: ${chapter_num}${title ? ' — ' + title : ''}
  • هدف هذا الفصل: ${goal}`;

    if (authorStyleFinal) prompt += `\n  • الأسلوب المطلوب: ${authorStyleFinal}`;
    if (styleProfile)     prompt += `\n  • بصمة أسلوبية: ${styleProfile}`;

    if (chapterPlan) {
        prompt += `\n\n═══════════════════════════════════════════════════════
خطة الفصل المحددة مسبقاً:
  • الأحداث الرئيسية: ${chapterPlan.key_events || ''}
  • النبرة: ${chapterPlan.tone || ''}
  • ينتهي بـ: ${chapterPlan.ends_with || ''}`;
    }

    if (superSummary) {
        prompt += `\n\n═══════════════════════════════════════════════════════
ملخص القوس السردي السابق:
${superSummary}`;
    }

    if (prevSummaries) {
        prompt += `\n\n═══════════════════════════════════════════════════════
ملخصات الفصول السابقة (الأحدث أولاً):
${prevSummaries}`;
    }

    if (charsList) {
        prompt += `\n\n═══════════════════════════════════════════════════════
الشخصيات:
${charsList}`;
    }

    prompt += `\n\n═══════════════════════════════════════════════════════
قواعد النوع الأدبي — ${genre}:
${getGenreRules(genre)}

═══════════════════════════════════════════════════════
تعليمات إلزامية:
  1. اكتب بين ${min_chars} و${max_chars} حرف.
  2. اكتب بالعربية الفصحى المعاصرة.
  3. لا تُعِد إحياء شخصية مات ذكر موتها.
  4. حافظ على تناسق الأسماء والصفات.
  5. اجعل الفصل يبدأ بجملة جاذبة وينتهي بخطاف أو إغلاق مُشبع.
  6. الحوار يجب أن يعكس شخصية المتحدث.`;

    if (custom_rules) prompt += `\n  7. تعليمات إضافية: ${custom_rules}`;

    prompt += `\n\n═══════════════════════════════════════════════════════
التنسيق:
اكتب نص الفصل مباشرةً.
في نهاية النص، في سطر منفصل، أضف:
SUMMARY: [ملخص 2-3 جمل عن الأحداث الرئيسية]

لا تضف أي نص قبل الفصل أو بعد سطر SUMMARY.`;

    return prompt;
}

// ── Prompt فحص التناسق ───────────────────────────────────────
async function buildConsistencyPrompt(chapterText, chapterNum) {
    const [charsList, deadChars] = await Promise.all([
        getCharactersList(),
        getDeadCharacters(),
    ]);

    let prompt = `أنت محرر أدبي. افحص نص الفصل ${chapterNum} وأبلغ عن مشاكل التناسق.

نص الفصل:
${chapterText.substring(0, 4000)}`;

    if (deadChars) prompt += `\n\nالشخصيات المتوفية (يجب ألا تظهر حية):\n${deadChars}`;
    if (charsList) prompt += `\n\nقائمة الشخصيات:\n${charsList}`;

    prompt += `\n\nأجب بـ JSON فقط:
{"issues":[{"type":"resurrection|name_conflict|timeline|other","description":"...","severity":"high|medium|low"}],"overall":"ok|warning|critical"}`;

    return prompt;
}

// ── دوال مساعدة ──────────────────────────────────────────────
async function getPreviousSummaries(currentChapter) {
    if (currentChapter <= 1) return '';
    try {
        const rows = await fetchAll('chapters',
            {},
            'chapter_num, title, summary',
        );
        const filtered = rows
            .filter(r => r.chapter_num < currentChapter && r.summary)
            .sort((a, b) => b.chapter_num - a.chapter_num)
            .slice(0, 15);

        return filtered.reverse().map(r => {
            const t = r.title ? ` — ${r.title}` : '';
            return `  الفصل ${r.chapter_num}${t}: ${r.summary}`;
        }).join('\n');
    } catch (e) { return ''; }
}

async function getCharactersList() {
    try {
        const rows = await fetchAll('characters', {}, 'name, role, status, notes');
        return rows.map(r => {
            const s = r.status === 'alive' ? '(حي)' : r.status === 'dead' ? '(ميت)' : '(مجهول)';
            const n = r.notes ? ` — ${r.notes.substring(0, 80)}` : '';
            return `  • ${r.name} ${s}: ${r.role}${n}`;
        }).join('\n');
    } catch (e) { return ''; }
}

async function getDeadCharacters() {
    try {
        const rows = await fetchAll('characters', { status: 'dead' }, 'name');
        return rows.map(r => r.name).join('، ');
    } catch (e) { return ''; }
}

async function getActiveStyleProfile() {
    try {
        const row = await fetchOne('style_profiles', { is_active: true }, 'profile');
        return row ? row.profile : '';
    } catch (e) { return ''; }
}

async function getSuperSummary(currentChapter) {
    try {
        const arcNum = Math.floor((currentChapter - 1) / 10);
        const row    = await fetchOne('config', { key: `super_summary_${arcNum}` }, 'value');
        return row ? row.value : '';
    } catch (e) { return ''; }
}

async function getChapterPlan(chapterNum) {
    try {
        const row  = await fetchOne('config', { key: 'chapter_plan' }, 'value');
        if (!row)  return null;
        const plan = JSON.parse(row.value);
        return Array.isArray(plan) ? plan.find(p => p.chapter_num === chapterNum) : null;
    } catch (e) { return null; }
}

// ── قواعد الأنواع ─────────────────────────────────────────────
function getGenreRules(genre) {
    const rules = {
        'خيال_علمي':   ['اجعل التكنولوجيا جزءاً من الحبكة','تخيل عواقب التقدم العلمي','حافظ على منطقية القوانين العلمية'],
        'تشويق_غموض': ['اجعل كل فصل ينتهي بخطاف','وزّع الأدلة بذكاء','حافظ على التوتر المتصاعد'],
        'رومانسي':     ['طوّر العلاقات تدريجياً','الحوار يعكس عمق المشاعر','لحظات قريب وبعيد تخلق توتراً'],
        'فانتازيا':    ['حافظ على قواعد السحر','الأسطورة جزء من النسيج','تصاعد الخطر على العالم'],
        'واقعي':       ['ركّز على عمق الشخصيات','الأحداث من الحياة الفعلية','الحوار طبيعي ويعكس الثقافة'],
        'تاريخي':      ['الدقة التاريخية في العادات','الأحداث الحقيقية خلفية','الشخصيات تعكس قيم عصرها'],
        'رعب':         ['ابنِ الرعب تدريجياً','الخوف النفسي أقوى','ادمج الحواس: أصوات وروائح'],
        'مغامرة':      ['الإيقاع سريع','كل فصل يدفع نحو الهدف','الوصف الجغرافي جزء من الإثارة'],
    };
    const r = rules[genre] || rules['واقعي'];
    return r.map(rule => `  • ${rule}`).join('\n');
}

// ── استخراج SUMMARY من النص ──────────────────────────────────
function extractSummary(text) {
    const match = text.match(/\nSUMMARY:\s*(.+)$/su);
    if (match) {
        const summary     = match[1].trim().substring(0, 400);
        const chapterText = text.replace(/\nSUMMARY:.*$/su, '').trim();
        return { text: chapterText, summary };
    }
    return { text: text.trim(), summary: text.substring(0, 200) + '...' };
}

module.exports = { buildChapterPrompt, buildConsistencyPrompt, extractSummary, getGenreRules };
