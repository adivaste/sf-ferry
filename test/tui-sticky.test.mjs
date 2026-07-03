// f pins the row filter so it survives switching metadata types (for migrating
// everything named e.g. "Account" across ApexClass, CustomField, Layout, …).
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
    console.log('STICKY FAIL: timed out');
    process.exit(2);
}, 9000);
const p = runTui({ store, loadComponents, orgs: [] });
const at = (ms, fn) => setTimeout(fn, ms);

at(300, () => input.write('\r')); // open ApexClass, focus table
at(450, () => input.write('/')); // focus the filter box
at(550, () => input.write('a')); // type a filter term
at(700, () => input.write('\r')); // submit -> store.filter = 'a', focus table
at(800, () => input.write('f')); // pin the filter
at(950, () => input.write('\x1b[Z')); // shift+tab -> focus the Types pane
at(1100, () => input.write('\x1b[B')); // arrow down -> highlight ApexTrigger
at(1250, () => input.write('\r')); // open it (filter should persist)
at(1450, () => input.write('q')); // quit
at(1600, () => input.write('y'));

const result = await p;
clearTimeout(timer);
Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });

console.log('activeType =', store.activeType, '| filter =', JSON.stringify(store.filter));
const ok = result?.action === 'quit' && store.activeType === 'ApexTrigger' && store.filter === 'a';
console.log(ok ? 'STICKY PASS' : 'STICKY FAIL');
process.exit(ok ? 0 : 1);
