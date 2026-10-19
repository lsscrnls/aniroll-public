// Writes CHANGELOG.md from the "What's new" entries in js/whatsnew.js, so GitHub shows the same as the app.
// Run by scripts/release.sh; by hand: node scripts/changelog.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js', 'whatsnew.js'), 'utf8');
const start = source.indexOf('const CHANGES = [');
const end = source.indexOf('\n];', start);
if (start < 0 || end < 0) throw new Error('CHANGES not found in js/whatsnew.js');
const changes = new Function(`${source.slice(start, end + 3)}\nreturn CHANGES;`)();
const release = source.match(/RELEASE = '([\d.]+)'/)?.[1] || '';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', nbsp: ' ', mdash: '—', ndash: '–' };
const markdown = (html) => String(html)
    .replace(/<(strong|b)>(.*?)<\/\1>/g, '**$2**')
    .replace(/<(em|i)>(.*?)<\/\1>/g, '*$2*')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g, '[$2]($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&([a-z]+|#\d+);/g, (m, e) => ENTITIES[e] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
const dateOf = (id) => String(id).split('.')[0];
const pretty = (id) => new Date(`${dateOf(id)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const lines = ['# Changelog', '', `What changed in AniRoll, newest first: the same as "What's new" in the app. Current release: ${release}.`, ''];
for (const entry of changes) {
    lines.push(`## ${pretty(entry.id)}${entry.title ? ` – ${markdown(entry.title)}` : ''}`, '');
    // Items added later in the day come first in the app; the order is kept
    for (const item of entry.items || []) lines.push(`- ${markdown(typeof item === 'string' ? item : item.text)}`);
    lines.push('');
}
fs.writeFileSync(path.join(root, 'CHANGELOG.md'), lines.join('\n'));
console.log(`CHANGELOG.md: ${changes.length} days`);
