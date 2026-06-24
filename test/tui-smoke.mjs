// Headless smoke test: build a fake TTY, boot the TUI with demo data,
// inject keys, and verify it constructs + resolves without throwing.
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
output.resume(); // drain escape codes to nowhere

// blessed reads program.output; give it a sink
process.env.TERM = process.env.TERM || 'xterm';

const store = createStore({ sourceOrg: 'DEMO', targetOrg: 'DEMO-prod' });
setTypes(store, DEMO_TYPES);

const loadComponents = async (type) => {
  setComponents(store, type, DEMO_COMPONENTS[type] || []);
};

const timer = setTimeout(() => {
  console.log('SMOKE FAIL: timed out (TUI did not resolve)');
  process.exit(2);
}, 6000);

// Patch blessed to use our fake streams via global program options:
// runTui calls blessed.screen() with no streams, so override stdio.
// Simplest: temporarily swap process.stdin/stdout.
const realIn = process.stdin;
const realOut = process.stdout;
Object.defineProperty(process, 'stdin', { value: input, configurable: true });
Object.defineProperty(process, 'stdout', { value: output, configurable: true });

let result;
try {
  const p = runTui({ store, loadComponents, orgs: [{ label: 'prodX', value: 'prodX' }] });

  // After boot: select all visible ApexClass rows, then build package.xml.
  setTimeout(() => { input.write('a'); }, 300);   // select all visible
  setTimeout(() => { input.write('b'); }, 600);   // build -> resolves with entries

  result = await p;
} catch (e) {
  Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
  Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });
  clearTimeout(timer);
  console.log('SMOKE FAIL: threw during TUI:', e.message);
  process.exit(1);
}

Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });
clearTimeout(timer);

const entries = result?.entries || [];
console.log('TUI resolved with action:', result?.action, '| entries:', entries.length);
const ok = result?.action === 'build'
  && entries.length === DEMO_COMPONENTS.ApexClass.length
  && entries.every((e) => e.type === 'ApexClass' && e.fullName);
console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL: selection did not flow to entries');
process.exit(ok ? 0 : 1);
