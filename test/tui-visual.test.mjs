// Visual range-select: V drops an anchor, move extends the range, space
// (de)selects the whole run at once.
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
    console.log('VISUAL FAIL: timed out');
    process.exit(2);
}, 9000);
const p = runTui({ store, loadComponents, orgs: [] });
const at = (ms, fn) => setTimeout(fn, ms);

at(300, () => input.write('\r')); // open ApexClass (5 rows), focus table
at(450, () => input.write('V')); // start visual range at row 0
at(550, () => input.write('j')); // extend to row 1
at(650, () => input.write('j')); // extend to row 2
at(800, () => input.write(' ')); // apply -> select rows 0..2 (3 rows)
at(1000, () => input.write('q')); // quit
at(1150, () => input.write('y'));

const result = await p;
clearTimeout(timer);
Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });

const count = (result?.entries || []).length;
console.log('selected via visual range =', count, '(want 3)');
const ok = result?.action === 'quit' && count === 3;
console.log(ok ? 'VISUAL PASS' : 'VISUAL FAIL');
process.exit(ok ? 0 : 1);
