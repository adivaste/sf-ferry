// Ctrl+B / Alt+B toggle the side panels without crashing the relayout, and the
// app still quits cleanly afterward.
import { PassThrough } from 'node:stream';
import { runTui } from '../src/tui.js';
import { createStore, setTypes, setComponents } from '../src/store.js';
import { DEMO_TYPES, DEMO_COMPONENTS } from '../src/demo.js';

const input = new PassThrough();
input.setRawMode = () => {};
input.isTTY = true;
const output = new PassThrough();
output.columns = 140; output.rows = 40; output.isTTY = true; output.resume();
process.env.TERM = process.env.TERM || 'xterm';

const store = createStore({ sourceOrg: 'DEMO', targetOrg: 'DEMO-prod' });
setTypes(store, DEMO_TYPES);
const loadComponents = async (type) => setComponents(store, type, DEMO_COMPONENTS[type] || []);

const realIn = process.stdin;
const realOut = process.stdout;
Object.defineProperty(process, 'stdin', { value: input, configurable: true });
Object.defineProperty(process, 'stdout', { value: output, configurable: true });

const timer = setTimeout(() => { console.log('TOGGLE FAIL: timed out'); process.exit(2); }, 9000);
const p = runTui({ store, loadComponents, orgs: [] });
const at = (ms, fn) => setTimeout(fn, ms);

at(300, () => input.write('\r'));    // open a type, focus table
at(450, () => input.write('\x02'));  // Ctrl+B  -> hide left
at(550, () => input.write('\x02'));  // Ctrl+B  -> show left
at(650, () => input.write('\x1bb')); // Alt+B   -> hide right
at(750, () => input.write('\x1bb')); // Alt+B   -> show right
at(850, () => input.write('\x02'));  // hide left again (stay collapsed)
at(1000, () => input.write('q'));    // quit

const result = await p;
clearTimeout(timer);
Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });

console.log('final action =', result?.action);
const ok = result?.action === 'quit';
console.log(ok ? 'TOGGLE PASS' : 'TOGGLE FAIL');
process.exit(ok ? 0 : 1);
