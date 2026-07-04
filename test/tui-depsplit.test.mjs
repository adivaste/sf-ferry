// Inside the dependency panel, > opens the side-by-side diff for the highlighted
// row (fed by getDiffSources); esc collapses back, esc again closes the panel.
import { PassThrough } from 'node:stream';
import { runTui } from '../src/tui.js';
import { createStore, setTypes, setComponents } from '../src/store.js';
import { DEMO_TYPES, DEMO_COMPONENTS } from '../src/demo.js';

const input = new PassThrough();
input.setRawMode = () => {};
input.isTTY = true;
const output = new PassThrough();
output.columns = 170;
output.rows = 48;
output.isTTY = true;
output.resume();
process.env.TERM = process.env.TERM || 'xterm';

const store = createStore({ sourceOrg: 'DEMO', targetOrg: 'DEMO-prod' });
setTypes(store, DEMO_TYPES);
const loadComponents = async (type) => setComponents(store, type, DEMO_COMPONENTS[type] || []);

const checkDependencies = async () => ({
    rows: [
        {
            type: 'ApexClass',
            fullName: 'AccountController_Test',
            why: 'test of AccountController',
            status: 'missing',
            targetDate: '',
        },
    ],
    caveat: 'sample',
});
let diffAsked = null;
const getDiffSources = async (type, fullName) => {
    diffAsked = { type, fullName };
    return { supported: true, targetBody: 'a\nb', sourceBody: 'a\nB\nc' };
};

const realIn = process.stdin;
const realOut = process.stdout;
Object.defineProperty(process, 'stdin', { value: input, configurable: true });
Object.defineProperty(process, 'stdout', { value: output, configurable: true });

const timer = setTimeout(() => {
    console.log('DEPSPLIT FAIL: timed out');
    process.exit(2);
}, 9000);
const p = runTui({ store, loadComponents, orgs: [], checkDependencies, getDiffSources });
const at = (ms, fn) => setTimeout(fn, ms);

at(300, () => input.write('\r')); // open ApexClass, focus table
at(450, () => input.write(' ')); // select a component
at(650, () => input.write('D')); // open dependency panel
at(1000, () => input.write('>')); // open the split diff for the highlighted dep
at(1400, () => input.write('\x1b')); // esc: focus back to the dep list
at(1550, () => input.write('\x1b')); // esc: close the dep panel
at(1750, () => input.write('q')); // quit
at(1900, () => input.write('y'));

const result = await p;
clearTimeout(timer);
Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });

console.log(
    'diff asked for =',
    diffAsked && `${diffAsked.type}/${diffAsked.fullName}`,
    '| action =',
    result?.action,
);
const ok = result?.action === 'quit' && diffAsked && diffAsked.fullName === 'AccountController_Test';
console.log(ok ? 'DEPSPLIT PASS' : 'DEPSPLIT FAIL');
process.exit(ok ? 0 : 1);
