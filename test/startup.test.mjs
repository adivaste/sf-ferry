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

const helpOk = res.status === 0 && elapsed < THRESHOLD_MS && /Usage: ferry/.test(res.stdout);
console.log(`--help startup: ${elapsed} ms (threshold ${THRESHOLD_MS} ms)`);

// --version must print the package version and exit 0 (regression guard: the
// CLI previously shipped without a version flag → "unknown option '--version'").
const ver = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });
const versionOk = ver.status === 0 && /^\d+\.\d+\.\d+/.test((ver.stdout || '').trim());
console.log(`--version: "${(ver.stdout || ver.stderr || '').trim()}" (exit ${ver.status})`);

const ok = helpOk && versionOk;
console.log(ok ? 'STARTUP PASS' : 'STARTUP FAIL');
if (!ok) console.log(res.stderr || ver.stderr);
process.exit(ok ? 0 : 1);
