// Action keys (d/v/b/q) require a y/n confirmation: 'n' cancels (no action),
// 'y' proceeds.
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
let resolvedAfterCancel = null;
const timer = setTimeout(() => { console.log('CONFIRM FAIL: timed out'); process.exit(2); }, 9000);
const p = runTui({ store, loadComponents, orgs: [] }).then((r) => { resolved = true; return r; });
const at = (ms, fn) => setTimeout(fn, ms);

at(300, () => input.write('\r'));  // open ApexClass, focus table
at(450, () => input.write(' '));   // select a component
at(600, () => input.write('d'));   // deploy -> confirm dialog
at(750, () => input.write('n'));   // cancel
at(900, () => { resolvedAfterCancel = resolved; });
at(1050, () => input.write('d'));  // deploy -> confirm dialog again
at(1200, () => input.write('y'));  // confirm -> resolves

const result = await p;
clearTimeout(timer);
Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });

console.log(`resolved after 'n' = ${resolvedAfterCancel} (want false); final action = ${result?.action}`);
const ok = resolvedAfterCancel === false && result?.action === 'deploy';
console.log(ok ? 'CONFIRM PASS' : 'CONFIRM FAIL');
process.exit(ok ? 0 : 1);
