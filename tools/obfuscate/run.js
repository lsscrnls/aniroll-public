// Obfuscates the given files in place: node run.js <file>...
// Used by scripts/deploy.sh on a copy of the site, for the modules that make AniRoll AniRoll (see
// PROTECTED in deploy.sh). The browser needs the code, so this only makes it hard to read, not secret.
// No property renaming: other modules import these by name and read their objects.
const fs = require('fs');
const JavaScriptObfuscator = require('javascript-obfuscator');

const OPTIONS = {
    target: 'browser',
    compact: true,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.8,
    splitStrings: true,
    splitStringsChunkLength: 10,
    transformObjectKeys: true,
    numbersToExpressions: true,
    // Light enough for the reel's animation frames
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.25,
    deadCodeInjection: false,
    selfDefending: false,
    debugProtection: false,
};

for (const file of process.argv.slice(2)) {
    const src = fs.readFileSync(file, 'utf8');
    const out = JavaScriptObfuscator.obfuscate(src, { ...OPTIONS, seed: 1 }).getObfuscatedCode();
    fs.writeFileSync(file, out);
    console.log(`obfuscated ${file}: ${src.length} -> ${out.length} bytes`);
}
