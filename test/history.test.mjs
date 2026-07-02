import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const home = mkdtempSync(path.join(tmpdir(), 'ferry-log-'));
process.env.FERRY_HOME = home;

const { appendLog, readLog } = await import('../src/history.js');

let n = 0;
const ok = (label, cond) => { assert.ok(cond, label); console.log('PASS', label); n += 1; };

try {
  ok('empty log initially', readLog().length === 0);

  appendLog({ action: 'deploy', source: 'uat', target: 'prod', count: 3, testLevel: 'RunLocalTests', ok: true, code: 0, elapsedMs: 1000, mode: 'ci' });
  const one = readLog();
  ok('one entry after append', one.length === 1);
  ok('stamps at + preserves fields', !!one[0].at && one[0].source === 'uat' && one[0].ok === true && one[0].mode === 'ci');

  appendLog({ action: 'validate', source: 'uat', target: 'prod', ok: false });
  ok('newest first', readLog()[0].action === 'validate');
  ok('code defaults from ok when omitted', readLog()[0].code === 1);
  ok('limit arg respected', readLog(1).length === 1);

  // capped at 200
  for (let i = 0; i < 205; i += 1) appendLog({ action: 'deploy', ok: true });
  ok('capped at 200', readLog().length === 200);

  console.log(`\n${n} history checks passed`);
} finally {
  rmSync(home, { recursive: true, force: true });
}
