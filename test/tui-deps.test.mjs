// D opens the dependency panel (fed by the injected checkDependencies provider);
// missing rows are pre-checked, and enter merges them into the selection.
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

// Fake provider: one missing dep (pre-checked) + one present dep (skipped).
let called = 0;
const checkDependencies = async (entries) => {
    called += 1;
    return {
        rows: [
            {
                type: 'ApexClass',
                fullName: 'AccountController_Test',
                why: 'test of AccountController',
                status: 'missing',
                targetDate: '',
            },
            {
                type: 'CustomObject',
                fullName: 'Invoice__c',
                why: 'used by 1',
                status: 'present',
                targetDate: '2026-05-30T10:00:00.000+0000',
            },
        ],
        caveat: 'Based on naming + Salesforce dependency data; dynamic references may be missed.',
        _entries: entries.length,
    };
};

const realIn = process.stdin;
const realOut = process.stdout;
Object.defineProperty(process, 'stdin', { value: input, configurable: true });
Object.defineProperty(process, 'stdout', { value: output, configurable: true });

const timer = setTimeout(() => {
    console.log('DEPS FAIL: timed out');
    process.exit(2);
}, 9000);
const p = runTui({ store, loadComponents, orgs: [], checkDependencies });
const at = (ms, fn) => setTimeout(fn, ms);

at(300, () => input.write('\r')); // open ApexClass, focus table
at(450, () => input.write(' ')); // select 1 component
at(650, () => input.write('D')); // run dependency check -> panel (missing pre-checked)
at(1400, () => input.write('\r')); // apply -> merges the 1 missing dep
at(1650, () => input.write('q')); // quit
at(1800, () => input.write('y'));

const result = await p;
clearTimeout(timer);
Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });

const names = (result?.entries || []).map((e) => e.fullName);
console.log('provider called =', called, '| final entries =', names.join(', '));
const ok =
    result?.action === 'quit' &&
    called === 1 &&
    names.includes('AccountController_Test') && // the missing dep was applied
    !names.includes('Invoice__c'); // the present dep was left unchecked
console.log(ok ? 'DEPS PASS' : 'DEPS FAIL');
process.exit(ok ? 0 : 1);
