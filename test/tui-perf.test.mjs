// Proves the component list is virtualized: scrolling a 50k-row type must stay
// fast. If rendering ever becomes O(total rows) again, a burst of scrolls over
// 50k rows blows past the budget.
import { PassThrough } from 'node:stream';
import { runTui } from '../src/tui.js';
import { createStore, setTypes, setComponents } from '../src/store.js';

const input = new PassThrough();
input.setRawMode = () => {};
input.isTTY = true;
const output = new PassThrough();
output.columns = 140; output.rows = 40; output.isTTY = true; output.resume();
process.env.TERM = process.env.TERM || 'xterm';

const BIG = 50000;
const rows = Array.from({ length: BIG }, (_, i) => ({
  type: 'CustomField',
  fullName: `Account.Field_${String(i).padStart(5, '0')}__c`,
  lastModifiedByName: i % 2 ? 'A. Vaste' : 'J. Smith',
  lastModifiedDate: '2026-06-20T10:00:00.000+0000',
  createdByName: 'A. Vaste',
  createdDate: '2025-01-02T10:00:00.000+0000',
}));

const store = createStore({ sourceOrg: 'DEMO', targetOrg: 'DEMO-prod' });
setTypes(store, [{ name: 'CustomField', inFolder: false }]);
const loadComponents = async (type) => setComponents(store, type, type === 'CustomField' ? rows : []);

const realIn = process.stdin;
const realOut = process.stdout;
Object.defineProperty(process, 'stdin', { value: input, configurable: true });
Object.defineProperty(process, 'stdout', { value: output, configurable: true });

const BUDGET_MS = 8000; // virtualized: well under 1s. O(n)-per-render: many seconds.
let t0 = 0;
const timer = setTimeout(() => { console.log('PERF FAIL: timed out'); process.exit(2); }, 20000);

const p = runTui({ store, loadComponents, orgs: [] });

setTimeout(() => input.write('\r'), 300); // open CustomField, focus table
setTimeout(() => {
  t0 = Date.now();
  for (let i = 0; i < 600; i += 1) input.write(i % 2 ? 'k' : 'j'); // 600 scroll renders
  for (let i = 0; i < 6; i += 1) input.write('\x1b[6~');          // a few PageDowns
  input.write('q');
}, 700);
setTimeout(() => input.write('y'), 1000); // confirm the quit

const result = await p;
const elapsed = Date.now() - t0;
clearTimeout(timer);
Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });

console.log(`scrolled 600+ renders over ${BIG} rows in ${elapsed} ms (budget ${BUDGET_MS} ms)`);
const ok = result?.action === 'quit' && elapsed < BUDGET_MS;
console.log(ok ? 'PERF PASS' : 'PERF FAIL');
process.exit(ok ? 0 : 1);
