// p builds and shows the package.xml the current selection would generate
// (pulls SDR lazily), and closes cleanly without crashing the UI.
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

// SDR import can take a couple of seconds the first time — be generous.
const timer = setTimeout(() => {
    console.log('PREVIEW FAIL: timed out');
    process.exit(2);
}, 15000);
const p = runTui({ store, loadComponents, orgs: [], apiVersion: '62.0' });
const at = (ms, fn) => setTimeout(fn, ms);

at(300, () => input.write('\r')); // open ApexClass, focus table
at(450, () => input.write(' ')); // select a component
at(650, () => input.write('p')); // build + open the package.xml preview
at(4500, () => input.write('q')); // close the preview (q while modal)
at(5000, () => input.write('q')); // quit ferry -> confirm
at(5200, () => input.write('y'));

const result = await p;
clearTimeout(timer);
Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });

console.log('final action =', result?.action, '| still selected =', (result?.entries || []).length);
const ok = result?.action === 'quit' && (result?.entries || []).length === 1;
console.log(ok ? 'PREVIEW PASS' : 'PREVIEW FAIL');
process.exit(ok ? 0 : 1);
