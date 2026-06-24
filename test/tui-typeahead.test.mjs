// Type-ahead on the Types pane: typing filters the type list (like a picklist),
// and letters that are also global shortcuts (e.g. 'a' = select-all) must NOT
// fire while the Types pane is focused.
import { PassThrough } from 'node:stream';
import { runTui } from '../src/tui.js';
import { createStore, setTypes, setComponents, selectionCount } from '../src/store.js';
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

let selAfterA = null;
const fail = (m) => {
  Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
  Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });
  console.log('TYPEAHEAD FAIL:', m);
  process.exit(1);
};
const timer = setTimeout(() => fail('timed out'), 9000);

const p = runTui({ store, loadComponents, orgs: [] });
const at = (ms, fn) => setTimeout(fn, ms);

// On boot the Types pane is focused. 'a' would select-all if shortcuts weren't
// guarded — here it must just feed the type filter.
at(350, () => input.write('a'));
at(500, () => { selAfterA = selectionCount(store); });
at(560, () => input.write('\x7f')); // backspace: clear the 'a'
at(650, () => input.write('trig')); // filter to ApexTrigger (no double letters)
at(850, () => input.write('\r'));   // open the single match -> ApexTrigger
at(1050, () => input.write('q'));   // now on the table; quit -> confirm
at(1200, () => input.write('y'));   // confirm

const result = await p;
clearTimeout(timer);
Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });

console.log(`selection after typing 'a' on Types = ${selAfterA} (want 0)`);
console.log(`activeType after typing 'trig'+enter = ${store.activeType} (want ApexTrigger)`);
const ok = selAfterA === 0 && store.activeType === 'ApexTrigger' && result?.action === 'quit';
console.log(ok ? 'TYPEAHEAD PASS' : 'TYPEAHEAD FAIL');
process.exit(ok ? 0 : 1);
