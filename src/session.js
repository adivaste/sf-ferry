import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { sessionsFile, ensureDir, ferryHome } from './paths.js';
import { writeJsonAtomic } from './fsjson.js';

// A capped, deduped HISTORY of selections per org (newest first). We store but
// never auto-restore — the UI offers a picker (R) to load one, and save (S) /
// deploys append a checkpoint.
const MAX_SESSIONS = 20; // keep the most recent N selections per org

const sig = (entries) => (entries || []).map((e) => `${e.type}:${e.fullName}`).sort().join('|');

function read(orgKey) {
  const f = sessionsFile(orgKey);
  if (!existsSync(f)) return [];
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

/** Newest-first list of saved sessions for an org. */
export function listSessions(orgKey) {
  return read(orgKey);
}

/**
 * Find one saved session across ALL orgs by label (case-insensitive) or exact
 * id — used by `ferry run --session <name>` in CI, where the org username key
 * isn't known up front. Returns the session object or null.
 */
export function findSession(nameOrId) {
  if (!nameOrId) return null;
  const dir = path.join(ferryHome(), 'sessions');
  if (!existsSync(dir)) return null;
  const want = String(nameOrId).toLowerCase();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    let list;
    try { list = JSON.parse(readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    if (!Array.isArray(list)) continue;
    const hit = list.find((s) => s && (s.id === nameOrId || (s.label || '').toLowerCase() === want));
    if (hit) return hit;
  }
  return null;
}

/**
 * Save a checkpoint (entries + target + test level + optional label).
 * De-dupes by selection so repeated deploys of the same set don't pile up.
 * Returns the updated list.
 */
export function addSession(orgKey, { entries, targetOrg, testLevel, label } = {}) {
  if (!orgKey || !(entries || []).length) return read(orgKey);
  const s = sig(entries);
  const list = read(orgKey).filter((x) => sig(x.entries) !== s);
  list.unshift({
    id: `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    label: label || '',
    entries,
    targetOrg: targetOrg || '',
    testLevel: testLevel || '',
    savedAt: new Date().toISOString(),
  });
  const trimmed = list.slice(0, MAX_SESSIONS);
  ensureDir(path.dirname(sessionsFile(orgKey)));
  writeJsonAtomic(sessionsFile(orgKey), trimmed, { pretty: true });
  return trimmed;
}
