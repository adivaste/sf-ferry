import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadSession, saveSession } from '../src/session.js';
import { createStore, setSelection, selectionGrouped, selectionCount } from '../src/store.js';

let n = 0;
const ok = (label, cond) => { assert.ok(cond, label); console.log('PASS', label); n += 1; };

const dir = mkdtempSync(path.join(tmpdir(), 'sfm-sess-'));
try {
  // no session yet
  ok('loadSession returns null when absent', loadSession('uat', dir) === null);

  // round-trip per source org
  const entries = [
    { type: 'ApexClass', fullName: 'AccountController' },
    { type: 'CustomNotificationType', fullName: 'OrderAlert' },
  ];
  saveSession('uat', { entries, targetOrg: 'prod', testLevel: 'NoTestRun' }, dir);
  const s = loadSession('uat', dir);
  ok('restores entries', s.entries.length === 2 && s.entries[0].fullName === 'AccountController');
  ok('restores target + test level', s.targetOrg === 'prod' && s.testLevel === 'NoTestRun');
  ok('stamps savedAt', typeof s.savedAt === 'string' && s.savedAt.length > 0);

  // keyed by source org — a different org is independent
  ok('other org isolated', loadSession('sandbox', dir) === null);
  saveSession('sandbox', { entries: [{ type: 'ApexTrigger', fullName: 'T' }], targetOrg: 'sb2', testLevel: 'RunLocalTests' }, dir);
  ok('uat unchanged after sandbox save', loadSession('uat', dir).entries.length === 2);

  // setSelection restores into a store and is reflected in the basket
  const store = createStore({ sourceOrg: 'uat', targetOrg: 'prod' });
  setSelection(store, s.entries);
  ok('store selection count restored', selectionCount(store) === 2);
  const grouped = selectionGrouped(store);
  ok('grouped by type', grouped.length === 2 && grouped.every((g) => g.items.length === 1));

  console.log(`\n${n} session checks passed`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
