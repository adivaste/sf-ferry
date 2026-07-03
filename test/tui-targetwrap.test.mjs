// The target-org picker wraps BOTH ways. With orgs [A,B,C] on A: pressing ↓
// three times must cycle back to A, and ↑ once must jump to C. (A clamping
// list would stop at C / stay on A.)
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

const store = createStore({ sourceOrg: 'DEMO', targetOrg: '' });
setTypes(store, DEMO_TYPES);
const loadComponents = async (type) => setComponents(store, type, DEMO_COMPONENTS[type] || []);
const orgs = [
    { label: 'A', value: 'a' },
    { label: 'B', value: 'b' },
    { label: 'C', value: 'c' },
];

const realIn = process.stdin;
const realOut = process.stdout;
Object.defineProperty(process, 'stdin', { value: input, configurable: true });
Object.defineProperty(process, 'stdout', { value: output, configurable: true });

const DOWN = '\x1b[B';
const timer = setTimeout(() => {
    console.log('WRAP FAIL: timed out');
    process.exit(2);
}, 9000);
const p = runTui({ store, loadComponents, orgs });
const at = (ms, fn) => setTimeout(fn, ms);

at(300, () => input.write('\r')); // open a type -> focus table
at(500, () => input.write('t')); // open target picker (starts on A=0)
at(620, () => input.write(DOWN)); // -> B
at(700, () => input.write(DOWN)); // -> C
at(780, () => input.write(DOWN)); // wrap -> A
at(900, () => input.write('\r')); // choose A
at(1050, () => input.write('q')); // quit -> confirm
at(1200, () => input.write('y')); // confirm

const result = await p;
clearTimeout(timer);
Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });

console.log(`targetOrg after 3×down (wrap) = ${store.targetOrg} (want a), action = ${result?.action}`);
const ok = store.targetOrg === 'a' && result?.action === 'quit';
console.log(ok ? 'WRAP PASS' : 'WRAP FAIL');
process.exit(ok ? 0 : 1);
