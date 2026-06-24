// '?' opens a help overlay; while it's open, action keys (e.g. 'd' deploy) are
// blocked; '?' again closes it; then quitting works. Also implicitly checks the
// loading spinner doesn't keep the process alive (the test would hang).
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
let resolvedWhileHelp = null;
const timer = setTimeout(() => { console.log('HELP FAIL: timed out'); process.exit(2); }, 9000);
const p = runTui({ store, loadComponents, orgs: [] }).then((r) => { resolved = true; return r; });
const at = (ms, fn) => setTimeout(fn, ms);

at(300, () => input.write('\r'));  // open ApexClass, focus table
at(450, () => input.write(' '));   // select a component (so 'd' could deploy)
at(600, () => input.write('?'));   // open help overlay
at(750, () => input.write('d'));   // would deploy if not blocked by the modal
at(870, () => { resolvedWhileHelp = resolved; });
at(1000, () => input.write('?'));  // close help
at(1150, () => input.write('q'));  // quit

const result = await p;
clearTimeout(timer);
Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });

console.log(`resolved while help open = ${resolvedWhileHelp} (want false), final action = ${result?.action}`);
const ok = resolvedWhileHelp === false && result?.action === 'quit';
console.log(ok ? 'HELP PASS' : 'HELP FAIL');
process.exit(ok ? 0 : 1);
