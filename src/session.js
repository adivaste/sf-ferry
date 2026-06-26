import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sessionsFile, ensureDir } from './paths.js';

// A capped, deduped HISTORY of selections per org (newest first). We store but
// never auto-restore — the UI offers a picker (R) to load one, and save (S) /
// deploys append a checkpoint.
const MAX = 20;

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
  const trimmed = list.slice(0, MAX);
  ensureDir(path.dirname(sessionsFile(orgKey)));
  writeFileSync(sessionsFile(orgKey), JSON.stringify(trimmed, null, 2));
  return trimmed;
}
