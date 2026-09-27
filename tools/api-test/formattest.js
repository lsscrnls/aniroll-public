// Social posts: AniList markdown rendering (js/pages/social.js), and above all that nothing a
// post contains can become markup of its own. Runs the real functions from the source.
const { loadFunctions } = require('./source');

const { esc } = loadFunctions('js/store.js', ['ESC_MAP', 'esc']);
const f = loadFunctions('js/pages/social.js',
    ['MEDIA_URL', 'HEADING', 'RULE', 'BULLET', 'NUMBERED', 'QUOTE', 'mediaLinkAttrs', 'formatInline',
        'formatActivityText', 'formatCentered', 'splitBlocks', 'formatActivityLines'], { esc });
const render = f.formatActivityText;

let failed = 0;
function check(name, ok, detail) {
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '\n      ' + detail}`);
}
const has = (name, text, ...parts) => {
    const html = render(text);
    check(name, parts.every(p => html.includes(p)), html);
};

// Markdown
has('heading', '# Big news\nrest', '<div class="activity-heading activity-h1">Big news</div>rest');
has('smaller heading', '### Small', 'activity-h3');
has('bullet list, no stray breaks', 'intro\n- one\n- two\nafter',
    'intro<ul class="activity-list"><li>one</li><li>two</li></ul>after');
has('numbered list', '1. first\n2) second', '<ol class="activity-list"><li>first</li><li>second</li></ol>');
has('list switches kind', '- a\n1. b', '</ul><ol class="activity-list">');
has('blockquote keeps its lines', '> line one\n> line two\nme', '<blockquote class="activity-quote">line one\nline two</blockquote>me');
has('rule', 'a\n---\nb', 'a<hr class="activity-rule">b');
has('centred block, also across lines', '~~~\nimg(https://x.test/a.png)\n~~~', '<div class="activity-center"><img class="activity-img" src="https://x.test/a.png"');
has('no blank lines around a centred block', 'before\n~~~\nmiddle\n~~~\nafter', 'before<div class="activity-center">middle</div>after');
has('inline code keeps links and emphasis out', 'run `__init__ https://a.test`', '<code class="activity-code">__init__ https://a.test</code>');
has('formatting inside list items', '- **bold** @someone', '<li><strong>bold</strong> <a href="#/user/someone"');
has('spoiler around a list', '~!\n- secret\n!~', '<span class="activity-spoiler"', '<li>secret</li>');
check('italics at line start is not a list', !render('*wow* great').includes('<ul'), render('*wow* great'));
check('negative number is not a list', !render('-5 degrees').includes('<ul'), render('-5 degrees'));
check('hashtag is not a heading', !render('#1 anime').includes('activity-heading'), render('#1 anime'));
has('existing media card still a block', 'watched\nhttps://anilist.co/anime/21\nnice', 'watched<div class="activity-embed loading" data-media-id="21"', '</div>nice');

// Nothing in a post becomes markup
const attacks = [
    '# <img src=x onerror=alert(1)>',
    '- <script>alert(1)</script>',
    '> <a href="javascript:alert(1)">x</a>',
    '~~~<svg onload=alert(1)>~~~',
    '`<b>` </code><img src=x onerror=alert(1)>',
    '[click](javascript:alert(1))',
    '1. [x](https://a.test" onmouseover="alert(1))',
    'img(https://a.test/x.png" onerror="alert(1))',
];
// Every real tag in the output must be one the renderer makes, without handlers or script URLs.
// (Checking for "onerror=" in the text would also hit correctly escaped text.)
const ALLOWED = new Set(['div', 'span', 'a', 'img', 'strong', 'em', 'code', 'ul', 'ol', 'li', 'blockquote', 'hr']);
function unsafeTags(html) {
    return [...html.matchAll(/<\/?([a-zA-Z][\w-]*)([^>]*)>/g)]
        .filter(([, name, attrs]) => !ALLOWED.has(name.toLowerCase()) || /\son\w+\s*=|javascript:/i.test(attrs))
        .map(m => m[0]);
}
for (const text of attacks) {
    const html = render(text);
    const bad = unsafeTags(html);
    check(`escaped: ${text}`, !bad.length, bad.join(' ') + '   in   ' + html);
}
check('tag check itself catches a handler', unsafeTags('<img src="a" onerror="x">').length === 1, 'detector broken');
check('escaping sanity', esc('<a>') === '&lt;a&gt;', esc('<a>'));

process.exitCode = failed ? 1 : 0;
