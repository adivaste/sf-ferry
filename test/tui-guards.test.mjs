// Regression test for the focus/guard fixes:
//  - typing in the filter must NOT trigger global shortcuts (a/c/d/q...)
//  - the filter must update the store live
//  - quitting still works afterwards
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

let resolved = false;
let filterMidType = null;

const fail = (msg) => {
  Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
  Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });
  console.log('GUARD FAIL:', msg);
  process.exit(1);
};

const timer = setTimeout(() => fail('timed out'), 8000);

const p = runTui({ store, loadComponents, orgs: [] }).then((r) => { resolved = true; return r; });

const at = (ms, fn) => setTimeout(fn, ms);
at(300, () => input.write('/'));      // enter filter mode
at(360, () => input.write('a'));      // 'a' would be select-all if unguarded
at(420, () => input.write('c'));      // 'c' would be clear if unguarded
at(480, () => input.write('d'));      // 'd' would DEPLOY (resolve) if unguarded
at(700, () => {
  filterMidType = store.filter;
  if (resolved) fail('a global shortcut fired while typing in the filter (resolved early)');
  if (filterMidType !== 'acd') fail(`filter did not update live; got "${filterMidType}"`);
});
at(760, () => input.write('')); // escape -> cancel filter
at(950, () => input.write('q'));      // quit

const result = await p;
clearTimeout(timer);
Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });

console.log(`filter while typing = "${filterMidType}", final action = ${result?.action}`);
const ok = filterMidType === 'acd' && result?.action === 'quit';
console.log(ok ? 'GUARD PASS' : 'GUARD FAIL');
process.exit(ok ? 0 : 1);
