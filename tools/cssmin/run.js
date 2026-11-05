// Minifies every stylesheet under css/ in place, in the deploy copy (cwd): node run.js
// Only whitespace, comments and shorter spellings: no targets, so nothing is rewritten for older browsers
// and modern syntax (@property, color-mix, :has) goes up as written. Any parse error stops the deploy.
const fs = require('fs');
const path = require('path');
const { transform } = require('lightningcss');

let before = 0, after = 0;
for (const name of fs.readdirSync('css').filter(f => f.endsWith('.css'))) {
    const file = path.join('css', name);
    const code = fs.readFileSync(file);
    let out;
    try { out = transform({ filename: file, code, minify: true, errorRecovery: false }); } catch (e) {
        console.error(`cssmin: ${file}:${e.loc?.line}:${e.loc?.column}: ${e.message}`);
        process.exit(1);
    }
    for (const w of out.warnings) console.error(`cssmin: ${file}: ${w.message}`);
    fs.writeFileSync(file, out.code);
    before += code.length; after += out.code.length;
}
console.log(`cssmin: ${Math.round(before / 1024)} KB -> ${Math.round(after / 1024)} KB`);
