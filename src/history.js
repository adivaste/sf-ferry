import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { logFile, ensureDir } from './paths.js';
import { writeJsonAtomic } from './fsjson.js';

// A capped, newest-first log of every deploy/validate ferry runs — from the UI
// or from `ferry run` (CI). Lets you answer "what did I ship to prod, when, and
// did it pass?" via `ferry log`. Stored in ~/.ferry/log.json.
const MAX_LOG_ENTRIES = 200;

function read() {
  const f = logFile();
  if (!existsSync(f)) return [];
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

/** Newest-first list of past deploy/validate runs. */
export function readLog(limit = 0) {
  const list = read();
  return limit > 0 ? list.slice(0, limit) : list;
}

/**
 * Append one run to the log. Fields: action, source, target, count, testLevel,
 * ok, code, elapsedMs, mode ('ui' | 'ci'). Stamps `at` itself. Best-effort:
 * a logging failure never breaks a deploy. Returns the updated list.
 */
export function appendLog(entry = {}) {
  const list = read();
  list.unshift({
    at: new Date().toISOString(),
    action: entry.action || 'deploy',
    source: entry.source || '',
    target: entry.target || '',
    count: entry.count || 0,
    testLevel: entry.testLevel || '',
    ok: entry.ok === true,
    code: typeof entry.code === 'number' ? entry.code : (entry.ok ? 0 : 1),
    elapsedMs: entry.elapsedMs || 0,
    mode: entry.mode || 'ui',
  });
  const trimmed = list.slice(0, MAX_LOG_ENTRIES);
  try {
    ensureDir(path.dirname(logFile()));
    writeJsonAtomic(logFile(), trimmed, { pretty: true });
  } catch { /* best-effort */ }
  return trimmed;
}
