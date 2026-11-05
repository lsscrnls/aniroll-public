// Compares two computed-style dumps of tools/m3/preview.js (STYLES=<label>):
//   node tools/m3/stylediff.js before after        every shot both runs have
// Exit code 1 when anything differs. Run "before" twice first to see how much the demo itself varies.
const fs = require('fs'), path = require('path');
const dir = label => path.join(__dirname, 'out', 'styles', label);
const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error('usage: stylediff.js <before> <after>'); process.exit(2); }

let total = 0;
for (const file of fs.readdirSync(dir(a)).filter(f => fs.existsSync(path.join(dir(b), f)))) {
    const x = JSON.parse(fs.readFileSync(path.join(dir(a), file)));
    const y = JSON.parse(fs.readFileSync(path.join(dir(b), file)));
    const diffs = [];
    for (const el of new Set([...Object.keys(x), ...Object.keys(y)])) {
        if (!x[el] || !y[el]) { diffs.push(`${x[el] ? '-' : '+'} ${el}`); continue; }
        for (const prop of Object.keys(x[el])) {
            if (x[el][prop] !== y[el][prop]) diffs.push(`  ${el}\n    ${prop}: ${x[el][prop]} → ${y[el][prop]}`);
        }
    }
    total += diffs.length;
    console.log(`${file.replace('.json', '')}: ${diffs.length ? diffs.length + ' differences' : 'same'}`);
    for (const d of diffs.slice(0, 8)) console.log(d);
}
process.exit(total ? 1 : 0);
