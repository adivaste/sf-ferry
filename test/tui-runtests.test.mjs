// RunSpecifiedTests collects test class names INSIDE the TUI (not via a broken
// post-blessed prompt). Selecting a component, choosing RunSpecifiedTests, and
// deploying should pop an in-TUI input and return the typed test classes.
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

const timer = setTimeout(() => { console.log('RUNTESTS FAIL: timed out'); process.exit(2); }, 9000);
const p = runTui({ store, loadComponents, orgs: [] });
const at = (ms, fn) => setTimeout(fn, ms);

// TEST_LEVELS = [NoTestRun, RunSpecifiedTests, RunLocalTests, RunAllTestsInOrg]
// default is RunLocalTests; 'l' x3 -> RunSpecifiedTests.
at(300, () => input.write('\r'));      // open ApexClass, focus table
at(450, () => input.write(' '));       // select the highlighted component
at(600, () => input.write('l'));       // -> RunAllTestsInOrg
at(700, () => input.write('l'));       // -> NoTestRun
at(800, () => input.write('l'));       // -> RunSpecifiedTests
at(950, () => input.write('d'));       // deploy -> opens in-TUI test prompt
at(1200, () => input.write('MyControllerTest, AccountServiceTest')); // type (paste-like)
at(1450, () => input.write('\r'));     // submit

const result = await p;
clearTimeout(timer);
Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });

console.log('action =', result?.action, '| testLevel =', result?.testLevel, '| tests =', JSON.stringify(result?.tests));
const ok = result?.action === 'deploy'
  && result?.testLevel === 'RunSpecifiedTests'
  && Array.isArray(result?.tests)
  && result.tests.length === 2
  && result.tests[0] === 'MyControllerTest'
  && result.tests[1] === 'AccountServiceTest';
console.log(ok ? 'RUNTESTS PASS' : 'RUNTESTS FAIL');
process.exit(ok ? 0 : 1);
