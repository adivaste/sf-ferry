import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Point the global state home at a temp dir BEFORE importing modules that read it.
const home = mkdtempSync(path.join(tmpdir(), 'ferry-prefs-'));
process.env.FERRY_HOME = home;

const { getPrefs, setPrefs } = await import('../src/prefs.js');

let n = 0;
const ok = (label, cond) => {
    assert.ok(cond, label);
    console.log('PASS', label);
    n += 1;
};

try {
    ok('missing org → empty object', Object.keys(getPrefs('u@x.com')).length === 0);

    setPrefs('u@x.com', { lastTarget: 'prod', lastType: 'ApexClass' });
    ok('persists lastTarget', getPrefs('u@x.com').lastTarget === 'prod');
    ok('persists lastType', getPrefs('u@x.com').lastType === 'ApexClass');

    // blank/undefined values must NOT clobber a good value
    setPrefs('u@x.com', { lastTarget: '', lastType: undefined });
    ok(
        'blank value ignored',
        getPrefs('u@x.com').lastTarget === 'prod' && getPrefs('u@x.com').lastType === 'ApexClass',
    );

    // partial merge keeps untouched keys
    setPrefs('u@x.com', { lastType: 'CustomField' });
    ok(
        'merge keeps other keys',
        getPrefs('u@x.com').lastTarget === 'prod' && getPrefs('u@x.com').lastType === 'CustomField',
    );

    // per-org isolation
    setPrefs('other@y.com', { lastTarget: 'sandbox' });
    ok(
        'orgs isolated',
        getPrefs('u@x.com').lastTarget === 'prod' && getPrefs('other@y.com').lastTarget === 'sandbox',
    );

    ok('empty orgKey → empty object', Object.keys(getPrefs('')).length === 0);
    ok('setPrefs empty orgKey is a no-op', Object.keys(setPrefs('', { lastTarget: 'x' })).length === 0);

    console.log(`\n${n} prefs checks passed`);
} finally {
    rmSync(home, { recursive: true, force: true });
}
