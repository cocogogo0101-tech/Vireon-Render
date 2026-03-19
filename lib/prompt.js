// ============================================================
//  Story Engine v2 — lib/prompt.js
//  بناء الـ Prompt
// ============================================================
const { getPreviousSummaries, getCharactersList, getActiveStyle, supabase } = require('./db');

const GENRE_RULES = {
    'خيال_علمي':   ['اجعل التكنولوجيا والعلم جزءاً محورياً.', 'استشرف عواقب التقدم العلمي.', 'الشخصيات تواجه أسئلة وجودية تتعلق بالإنسانية.'],
    'تشويق_غموض': ['أنهِ كل فصل بخطاف (hook).', 'وزّع الأدلة بذكاء.', 'حافظ على وتيرة التوتر التصاعدي.'],
    'رومانسي':    ['طوّر العلاقات تدريجياً.', 'الحوار يعكس عمق المشاعر.', 'لحظات قريبة وأخرى بعيدة تخلق توتراً.'],
    'فانتازيا':   ['التزم بقواعد السحر المحددة.', 'الأسطورة جزء من النسيج السردي.', 'تصاعد الخطر الذي يهدد العالم.'],
    'واقعي':      ['ركّز على عمق الشخصيات النفسي.', 'الحوار طبيعي يعكس ثقافة الشخصيات.', 'تجنب المبالغة.'],
    'تاريخي':     ['حافظ على الدقة التاريخية.', 'الشخصيات تعكس قيم عصرها.', 'الأحداث الحقيقية تشكل الخلفية.'],
    'رعب':        ['ابنِ الرعب تدريجياً من الأجواء.', 'الخوف النفسي أقوى من الجسدي.', 'ادمج التفاصيل الحسية: أصوات، روائح.'],
    'مغامرة':     ['إيقاع سريع وحركة مستمرة.', 'الوصف الجغرافي جزء من الإثارة.', 'العقبات تختبر الشجاعة والذكاء.'],
};

async function buildChapterPrompt(data) {
    const {
        chapter_num, title = '', goal, genre = 'واقعي',
        min_chars = 2000, max_chars = 8000,
        custom_rules = '', novel_title = '', author_style = ''
    } = data;

    const [prevSummaries, charsList, styleProfile] = await Promise.all([
        getPreviousSummaries(chapter_num),
        getCharactersList(),
        getActiveStyle()
    ]);

    // super-summary إن وجد
    const arcNum = Math.floor((chapter_num - 1) / 10);
    let superSummary = '';
    try {
        const { data: cfg } = await supabase
            .from('config')
            .select('value')
            .eq('key', `super_summary_${arcNum}`)
            .single();
        superSummary = cfg ? cfg.value : '';
    } catch (_) {}

    const genreRules = (GENRE_RULES[genre] || GENRE_RULES['واقعي'])
        .map(r => `  • ${r}`).join('\n');

    const titleLine = title ? `عنوان الفصل (مقترح): ${title}` : `الفصل: ${chapter_num}`;

    let prompt = `أنت روائي عربي خبير. مهمتك كتابة فصل جديد من رواية عربية بجودة أدبية عالية.

═══════════════════════════════════════════════════════
معلومات الرواية:
  • اسم الرواية: ${novel_title || 'رواية'}
  • النوع: ${genre}
  • ${titleLine}
  • هدف الفصل: ${goal}`;

    if (author_style) prompt += `\n  • الأسلوب المطلوب: ${author_style}`;
    if (styleProfile) prompt += `\n  • بصمة أسلوبية: ${styleProfile}`;
    if (superSummary) prompt += `\n\n═══════════════════════════════════════════════════════\nملخص القوس السردي:\n${superSummary}`;
    if (prevSummaries) prompt += `\n\n═══════════════════════════════════════════════════════\nملخصات الفصول السابقة:\n${prevSummaries}`;
    if (charsList) prompt += `\n\n═══════════════════════════════════════════════════════\nالشخصيات:\n${charsList}`;

    prompt += `\n\n═══════════════════════════════════════════════════════\nقواعد النوع (${genre}):\n${genreRules}`;

    prompt += `\n\n═══════════════════════════════════════════════════════\nتعليمات إلزامية:
  1. اكتب بين ${min_chars} و${max_chars} حرف.
  2. العربية الفصحى المعاصرة.
  3. لا تُعِد إحياء شخصية ميتة.
  4. حافظ على أسماء الشخصيات وصفاتها بلا تناقض.
  5. ابدأ بشكل شيّق وأنهِ بنهاية مُشبعة أو خطاف.${custom_rules ? `\n  6. تعليمات إضافية: ${custom_rules}` : ''}

أخرج نص الفصل فقط، ثم في سطر منفصل:
SUMMARY: [ملخص من جملتين للأحداث الرئيسية]`;

    return prompt;
}

function extractSummary(text) {
    const match = text.match(/\nSUMMARY:\s*(.+)$/su);
    if (match) {
        return {
            text: text.replace(/\nSUMMARY:.*$/su, '').trim(),
            summary: match[1].trim().substring(0, 400)
        };
    }
    return { text: text.trim(), summary: text.trim().substring(0, 200) + '...' };
}

function getGenres() {
    return Object.keys(GENRE_RULES).reduce((acc, k) => {
        const labels = {
            'خيال_علمي':'الخيال العلمي','تشويق_غموض':'التشويق والغموض',
            'رومانسي':'الرومانسي','فانتازيا':'الفانتازيا','واقعي':'الواقعي',
            'تاريخي':'التاريخي','رعب':'الرعب','مغامرة':'المغامرة'
        };
        acc[k] = labels[k] || k;
        return acc;
    }, {});
}

module.exports = { buildChapterPrompt, extractSummary, getGenres };
