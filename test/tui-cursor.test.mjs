// Regression test: pressing space must NOT reset the table cursor to the top.
// Navigate to row 3, press space twice. If the cursor is preserved, the same
// component is toggled on then off (0 selected). If it jumps to the top after
// the first toggle, the second space hits a different row (2 selected).
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

const DOWN = '\x1b[B';
const timer = setTimeout(() => { console.log('CURSOR FAIL: timed out'); process.exit(2); }, 9000);

const p = runTui({ store, loadComponents, orgs: [] });

const at = (ms, fn) => setTimeout(fn, ms);
at(350, () => input.write('\r'));   // open ApexClass, focus table at row 1
at(500, () => input.write(DOWN));   // -> row 2
at(580, () => input.write(DOWN));   // -> row 3
at(700, () => input.write(' '));    // toggle the row-3 component ON
at(850, () => input.write(' '));    // toggle the SAME component OFF (if cursor kept)
at(1050, () => input.write('b'));   // build

const result = await p;
clearTimeout(timer);
Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });

const entries = result?.entries || [];
console.log('action:', result?.action, '| entries:', entries.map((e) => e.fullName).join(', ') || '(none)');
const ok = result?.action === 'build' && entries.length === 0;
console.log(ok ? 'CURSOR PASS (cursor preserved across toggle)' : 'CURSOR FAIL (cursor jumped — selected wrong/extra rows)');
process.exit(ok ? 0 : 1);
