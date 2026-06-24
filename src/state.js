import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { STATE_FILE } from './constants.js';

// Pure selection-state persistence (JSON only) — no SDR / @salesforce/core,
// so commands like `show` stay fast and never pay the heavy import cost.

function statePath(manifestDir) {
  return path.join(manifestDir, STATE_FILE);
}

/** Load the persisted selection (changes + destructive) for a manifest dir. */
export function loadState(manifestDir, apiVersion) {
  const file = statePath(manifestDir);
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    return {
      apiVersion: saved.apiVersion || apiVersion,
      changes: saved.changes || [],
      destructive: saved.destructive || [],
    };
  }
  return { apiVersion, changes: [], destructive: [] };
}

export function saveState(manifestDir, state) {
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(statePath(manifestDir), JSON.stringify(state, null, 2));
}

/** Merge new {type, fullName} entries into a list, de-duplicating by type:fullName. */
export function mergeEntries(existing, additions) {
  const map = new Map(existing.map((e) => [`${e.type}:${e.fullName}`, e]));
  for (const a of additions) map.set(`${a.type}:${a.fullName}`, a);
  return [...map.values()].sort((a, b) =>
    a.type === b.type
      ? a.fullName.localeCompare(b.fullName)
      : a.type.localeCompare(b.type),
  );
}

export function removeEntries(existing, removals) {
  const drop = new Set(removals.map((r) => `${r.type}:${r.fullName}`));
  return existing.filter((e) => !drop.has(`${e.type}:${e.fullName}`));
}
