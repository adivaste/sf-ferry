// Pressing `s` opens the saved-selection picker; choosing one loads its
// components (and target/test level) into the store. Sessions are never
// auto-restored — this is the explicit way to bring an old selection back.
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

const store = createStore({ sourceOrg: 'DEMO', targetOrg: '' });
setTypes(store, DEMO_TYPES);
const loadComponents = async (type) => setComponents(store, type, DEMO_COMPONENTS[type] || []);

const SAVED = [{
  label: 'last deploy',
  entries: [{ type: 'ApexClass', fullName: 'LeadService' }, { type: 'ApexClass', fullName: 'AccountController' }],
  targetOrg: 'prodX',
  testLevel: 'NoTestRun',
  savedAt: new Date(Date.now() - 3600_000).toISOString(),
}];

const realIn = process.stdin;
const realOut = process.stdout;
Object.defineProperty(process, 'stdin', { value: input, configurable: true });
Object.defineProperty(process, 'stdout', { value: output, configurable: true });

const timer = setTimeout(() => { console.log('SESSIONS FAIL: timed out'); process.exit(2); }, 9000);
const p = runTui({ store, loadComponents, orgs: [], onListSessions: () => SAVED });
const at = (ms, fn) => setTimeout(fn, ms);

at(300, () => input.write('\r'));  // open a type -> focus table
at(500, () => input.write('s'));   // open sessions picker
at(700, () => input.write('\r'));  // load the first (only) saved selection
at(950, () => input.write('q'));   // quit -> confirm
at(1100, () => input.write('y'));  // confirm

const result = await p;
clearTimeout(timer);
Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });

console.log(`after load: selected=${selectionCount(store)} target=${store.targetOrg} action=${result?.action}`);
const ok = selectionCount(store) === 2 && store.targetOrg === 'prodX' && result?.action === 'quit';
console.log(ok ? 'SESSIONS PASS' : 'SESSIONS FAIL');
process.exit(ok ? 0 : 1);
