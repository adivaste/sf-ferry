// Guards the lazy-loading win: light commands must NOT pull in the heavy
// deps (SDR ~2.3s + @salesforce/core ~1.8s). If someone re-adds a static
// import of those at the top of bin/cli.js, --help jumps from ~0.25s to >4s
// and this fails.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');
const THRESHOLD_MS = 2000; // actual ~250ms; regression (eager heavy imports) ~4400ms

const start = Date.now();
const res = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
const elapsed = Date.now() - start;

const ok = res.status === 0 && elapsed < THRESHOLD_MS && /Usage: ferry/.test(res.stdout);
console.log(`--help startup: ${elapsed} ms (threshold ${THRESHOLD_MS} ms)`);
console.log(ok ? 'STARTUP PASS' : 'STARTUP FAIL');
if (!ok && res.status !== 0) console.log(res.stderr);
process.exit(ok ? 0 : 1);
