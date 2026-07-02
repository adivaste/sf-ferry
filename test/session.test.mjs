import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Point the global state home at a temp dir BEFORE importing modules that read it.
const home = mkdtempSync(path.join(tmpdir(), 'ferry-home-'));
process.env.FERRY_HOME = home;

const { listSessions, addSession, findSession } = await import('../src/session.js');
const { createStore, setSelection, selectionCount } = await import('../src/store.js');

let n = 0;
const ok = (label, cond) => { assert.ok(cond, label); console.log('PASS', label); n += 1; };

try {
  ok('empty history initially', listSessions('uat@x.com').length === 0);

  const e1 = [{ type: 'ApexClass', fullName: 'A' }, { type: 'ApexClass', fullName: 'B' }];
  addSession('uat@x.com', { entries: e1, targetOrg: 'prod', testLevel: 'NoTestRun', label: 'first' });
  ok('one entry after save', listSessions('uat@x.com').length === 1);

  // same selection (reordered) de-dupes → still 1, moved to top
  addSession('uat@x.com', { entries: [...e1].reverse(), targetOrg: 'prod', testLevel: 'RunLocalTests' });
  ok('identical selection de-duped', listSessions('uat@x.com').length === 1);

  // different selection → 2, newest first
  addSession('uat@x.com', { entries: [{ type: 'ApexTrigger', fullName: 'T' }], targetOrg: 'prod', testLevel: 'NoTestRun' });
  const list = listSessions('uat@x.com');
  ok('two distinct sessions, newest first', list.length === 2 && list[0].entries[0].fullName === 'T');
  ok('stores target + testLevel + savedAt', list[0].targetOrg === 'prod' && !!list[0].testLevel && !!list[0].savedAt);

  // cap at 20
  for (let i = 0; i < 25; i += 1) addSession('uat@x.com', { entries: [{ type: 'ApexClass', fullName: `C${i}` }] });
  ok('history capped at 20', listSessions('uat@x.com').length === 20);

  // per-org isolation
  ok('other org isolated', listSessions('sandbox@x.com').length === 0);
  ok('empty entries are ignored', addSession('uat@x.com', { entries: [] }).length === 20);

  // setSelection restores into a store
  const store = createStore({ sourceOrg: 'uat' });
  setSelection(store, e1);
  ok('setSelection populates store', selectionCount(store) === 2);

  // findSession scans across orgs by label (case-insensitive) or id
  addSession('ci@x.com', { entries: [{ type: 'ApexClass', fullName: 'Rel' }], label: 'release-2.0' });
  ok('findSession by label', findSession('release-2.0')?.entries[0].fullName === 'Rel');
  ok('findSession label is case-insensitive', findSession('RELEASE-2.0')?.label === 'release-2.0');
  const byId = findSession('release-2.0');
  ok('findSession by id', findSession(byId.id)?.label === 'release-2.0');
  ok('findSession miss → null', findSession('does-not-exist') === null);
  ok('findSession empty arg → null', findSession('') === null);

  console.log(`\n${n} session checks passed`);
} finally {
  rmSync(home, { recursive: true, force: true });
}
