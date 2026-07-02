// S saves the current selection under a name, via the onSaveSession callback,
// without leaving the UI.
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

let saved = null;
const onSaveSession = (payload) => { saved = payload; };

const realIn = process.stdin;
const realOut = process.stdout;
Object.defineProperty(process, 'stdin', { value: input, configurable: true });
Object.defineProperty(process, 'stdout', { value: output, configurable: true });

const timer = setTimeout(() => { console.log('NAMEDSAVE FAIL: timed out'); process.exit(2); }, 9000);
const p = runTui({ store, loadComponents, orgs: [], onSaveSession });
const at = (ms, fn) => setTimeout(fn, ms);

at(300, () => input.write('\r'));            // open ApexClass, focus table
at(450, () => input.write(' '));             // select a component
at(650, () => input.write('S'));             // open the "save as…" prompt
at(850, () => input.write('release-1.4'));   // type a name
at(1050, () => input.write('\r'));           // submit -> onSaveSession fires
at(1250, () => input.write('q'));            // quit
at(1400, () => input.write('y'));

const result = await p;
clearTimeout(timer);
Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });

console.log('saved label =', saved?.label, '| entries =', (saved?.entries || []).length);
const ok = result?.action === 'quit'
  && saved
  && saved.label === 'release-1.4'
  && (saved.entries || []).length === 1;
console.log(ok ? 'NAMEDSAVE PASS' : 'NAMEDSAVE FAIL');
process.exit(ok ? 0 : 1);
