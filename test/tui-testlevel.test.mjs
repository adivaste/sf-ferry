// l opens a test-level PICKER (pre-selected on the current level); choosing a
// different one updates the resolved testLevel.
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
output.resume();
process.env.TERM = process.env.TERM || 'xterm';

const store = createStore({ sourceOrg: 'DEMO', targetOrg: 'DEMO-prod' });
setTypes(store, DEMO_TYPES);
const loadComponents = async (type) => setComponents(store, type, DEMO_COMPONENTS[type] || []);

const realIn = process.stdin;
const realOut = process.stdout;
Object.defineProperty(process, 'stdin', { value: input, configurable: true });
Object.defineProperty(process, 'stdout', { value: output, configurable: true });

const timer = setTimeout(() => {
    console.log('TESTLEVEL FAIL: timed out');
    process.exit(2);
}, 9000);
const p = runTui({ store, loadComponents, orgs: [] });
const at = (ms, fn) => setTimeout(fn, ms);

// TEST_LEVELS = [NoTestRun, RunSpecifiedTests, RunLocalTests, RunAllTestsInOrg]
// default RunLocalTests (idx 2); picker opens there, 'j' -> RunAllTestsInOrg.
at(300, () => input.write('\r')); // open ApexClass, focus table
at(450, () => input.write(' ')); // select a component
at(600, () => input.write('l')); // open test-level picker (on RunLocalTests)
at(750, () => input.write('j')); // down -> RunAllTestsInOrg
at(900, () => input.write('\r')); // choose
at(1050, () => input.write('q')); // quit
at(1200, () => input.write('y'));

const result = await p;
clearTimeout(timer);
Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });

console.log('testLevel =', result?.testLevel, '(want RunAllTestsInOrg)');
const ok = result?.action === 'quit' && result?.testLevel === 'RunAllTestsInOrg';
console.log(ok ? 'TESTLEVEL PASS' : 'TESTLEVEL FAIL');
process.exit(ok ? 0 : 1);
