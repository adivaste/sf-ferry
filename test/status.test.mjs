import assert from 'node:assert';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gatherStatus } from '../src/status.js';

let n = 0;
const ok = (label, cond) => { assert.ok(cond, label); console.log('PASS', label); n += 1; };

const home = mkdtempSync(path.join(tmpdir(), 'sfm-status-'));
try {
  ok('empty home → empty summary', (() => {
    const s = gatherStatus(home);
    return s.sessions.length === 0 && s.cache.length === 0 && s.retrieve.length === 0;
  })());

  // seed sessions, cache, retrieve
  mkdirSync(path.join(home, 'sessions'), { recursive: true });
  writeFileSync(path.join(home, 'sessions', 'uat@x.com.json'), JSON.stringify([
    { entries: [{ type: 'ApexClass', fullName: 'A' }], savedAt: new Date().toISOString() },
    { entries: [{ type: 'ApexClass', fullName: 'B' }], savedAt: new Date().toISOString() },
  ]));
  mkdirSync(path.join(home, 'cache', 'uat@x.com'), { recursive: true });
  writeFileSync(path.join(home, 'cache', 'uat@x.com', 'ApexClass.json'), '{"rows":[]}');
  writeFileSync(path.join(home, 'cache', 'uat@x.com', 'CustomField.json'), '{"rows":[]}');
  mkdirSync(path.join(home, 'retrieve', 'uat@x.com'), { recursive: true });
  writeFileSync(path.join(home, 'retrieve', 'uat@x.com', 'unpackaged.zip'), 'PK\x03\x04zipbytes');

  const s = gatherStatus(home);
  ok('reports session count', s.sessions.length === 1 && s.sessions[0].count === 2);
  ok('reports cache types', s.cache.length === 1 && s.cache[0].types === 2);
  ok('reports retrieve zip', s.retrieve.length === 1 && s.retrieve[0].sizeKb >= 0);

  console.log(`\n${n} status checks passed`);
} finally {
  rmSync(home, { recursive: true, force: true });
}
