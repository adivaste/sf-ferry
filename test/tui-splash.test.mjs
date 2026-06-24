// The `prepare` splash path runs a step checklist, then reveals the main UI
// (types populated from what prepare returned), and quits cleanly.
import { PassThrough } from 'node:stream';
import { runTui } from '../src/tui.js';
import { createStore, setComponents } from '../src/store.js';
import { DEMO_TYPES, DEMO_COMPONENTS } from '../src/demo.js';

const input = new PassThrough();
input.setRawMode = () => {};
input.isTTY = true;
const output = new PassThrough();
output.columns = 140; output.rows = 40; output.isTTY = true; output.resume();
process.env.TERM = process.env.TERM || 'xterm';

const store = createStore({ sourceOrg: 'DEMO', targetOrg: 'DEMO-prod' });

const prepare = async (step) => {
  step.begin('Loading demo data …');
  step.done('Demo data ready');
  return {
    types: DEMO_TYPES,
    loadComponents: async (type) => setComponents(store, type, DEMO_COMPONENTS[type] || []),
    orgs: [],
  };
};

const realIn = process.stdin;
const realOut = process.stdout;
Object.defineProperty(process, 'stdin', { value: input, configurable: true });
Object.defineProperty(process, 'stdout', { value: output, configurable: true });

const timer = setTimeout(() => { console.log('SPLASH FAIL: timed out'); process.exit(2); }, 9000);
const p = runTui({ store, prepare });

// prepare resolves ~instantly; reveal, open a type (focus the table), then quit.
setTimeout(() => input.write('\r'), 600);
setTimeout(() => input.write('q'), 850);

const result = await p;
clearTimeout(timer);
Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });

console.log(`types after splash = ${store.types.length} (want ${DEMO_TYPES.length}), action = ${result?.action}`);
const ok = result?.action === 'quit' && store.types.length === DEMO_TYPES.length && !!store.activeType;
console.log(ok ? 'SPLASH PASS' : 'SPLASH FAIL');
process.exit(ok ? 0 : 1);
