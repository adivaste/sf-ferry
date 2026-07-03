// Quitting offers a third option — save & quit — which resolves with save:true
// so the caller checkpoints the selection instead of discarding it.
import { PassThrough } from 'node:stream';
import { runTui } from '../src/tui.js';
import { createStore, setTypes, setComponents } from '../src/store.js';
import { DEMO_TYPES, DEMO_COMPONENTS } from '../src/demo.js';

const input = new PassThrough();
input.setRawMode = () => {};
input.isTTY = true;
const output = new PassThrough();
output.columns = 140;
output.rows = 40;
output.isTTY = true;
output.resume();
process.env.TERM = process.env.TERM || 'xterm';

const store = createStore({ sourceOrg: 'DEMO', targetOrg: 'DEMO-prod' });
setTypes(store, DEMO_TYPES);
const loadComponents = async (type) => setComponents(store, type, DEMO_COMPONENTS[type] || []);

const realIn = process.stdin;
const realOut = process.stdout;
Object.defineProperty(process, 'stdin', { value: input, configurable: true });
Object.defineProperty(process, 'stdout', { value: output, configurable: true });

const timer = setTimeout(() => {
    console.log('SAVEQUIT FAIL: timed out');
    process.exit(2);
}, 9000);
const p = runTui({ store, loadComponents, orgs: [] });
const at = (ms, fn) => setTimeout(fn, ms);

at(300, () => input.write('\r')); // open ApexClass, focus table
at(450, () => input.write(' ')); // select a component
at(650, () => input.write('q')); // quit -> confirm dialog
at(850, () => input.write('s')); // save & quit

const result = await p;
clearTimeout(timer);
Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });

console.log(
    'action =',
    result?.action,
    '| save =',
    result?.save,
    '| entries =',
    (result?.entries || []).length,
);
const ok = result?.action === 'quit' && result?.save === true && (result?.entries || []).length === 1;
console.log(ok ? 'SAVEQUIT PASS' : 'SAVEQUIT FAIL');
process.exit(ok ? 0 : 1);
