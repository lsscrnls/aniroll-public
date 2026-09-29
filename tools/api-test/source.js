// Loads top-level functions and constants straight from a source file into a sandbox, so
// code that is not exported (api/server.js starts a server when required) can be tested.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');

// names: `function name(...) {...}` or `const name = ...;` at the top level of `file`.
// context: globals the extracted code may use (modules, stubs). Returns the sandbox.
function loadFunctions(file, names, context = {}) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    const parts = names.map(name => {
        const oneLine = src.match(new RegExp(`^(?:export )?function ${name}\\(.*\\{.*\\}$`, 'm'));
        const fn = oneLine || src.match(new RegExp(`^(?:export )?function ${name}\\([^]*?^}`, 'm'));
        const constant = src.match(new RegExp(`^(?:export )?const ${name} = .*;$`, 'm'));
        const found = (fn || constant || [])[0];
        if (!found) throw new Error(`${name} not found in ${file} — renamed? update the test`);
        return found.replace(/^export /, '');
    });
    const sandbox = { ...context };
    vm.runInNewContext(parts.join('\n') + '\n;' + names.map(n => `this.${n} = ${n};`).join(''), sandbox);
    return sandbox;
}

module.exports = { loadFunctions };
