// > opens the diff viewer for the highlighted component, fed by the injected
// getDiffSources provider; f toggles view mode; esc closes.
import { PassThrough } from 'node:stream';
import { runTui } from '../src/tui.js';
import { createStore, setTypes, setComponents } from '../src/store.js';
import { DEMO_TYPES, DEMO_COMPONENTS } from '../src/demo.js';

const input = new PassThrough();
input.setRawMode = () => {};
input.isTTY = true;
const output = new PassThrough();
output.columns = 160;
output.rows = 48;
output.isTTY = true;
output.resume();
process.env.TERM = process.env.TERM || 'xterm';

const store = createStore({ sourceOrg: 'DEMO', targetOrg: 'DEMO-prod' });
setTypes(store, DEMO_TYPES);
const loadComponents = async (type) => setComponents(store, type, DEMO_COMPONENTS[type] || []);

let asked = null;
const getDiffSources = async (type, fullName) => {
    asked = { type, fullName };
    return {
        supported: true,
        targetBody: 'line1\nlineTwo\nline3',
        sourceBody: 'line1\nlineTWO\nline3\nline4',
    };
};

const realIn = process.stdin;
const realOut = process.stdout;
Object.defineProperty(process, 'stdin', { value: input, configurable: true });
Object.defineProperty(process, 'stdout', { value: output, configurable: true });

const timer = setTimeout(() => {
    console.log('DIFF FAIL: timed out');
    process.exit(2);
}, 9000);
const p = runTui({ store, loadComponents, orgs: [], getDiffSources });
const at = (ms, fn) => setTimeout(fn, ms);

at(300, () => input.write('\r')); // open ApexClass, focus table
at(500, () => input.write('>')); // open diff for the highlighted component
at(900, () => input.write('f')); // toggle full <-> changes-only
at(1100, () => input.write('\x1b')); // esc closes the viewer
at(1300, () => input.write('q')); // quit
at(1450, () => input.write('y'));

const result = await p;
clearTimeout(timer);
Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });

console.log(
    'provider asked for =',
    asked && `${asked.type}/${asked.fullName}`,
    '| final action =',
    result?.action,
);
const ok = result?.action === 'quit' && asked && asked.type === 'ApexClass' && !!asked.fullName;
console.log(ok ? 'DIFF PASS' : 'DIFF FAIL');
process.exit(ok ? 0 : 1);
