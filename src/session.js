import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Remembers the last selection per source org so a failed (or abandoned) deploy
// never costs you the re-selection. Stored in the cwd, keyed by source org.
const FILE = '.sfm-session.json';

const filePath = (dir) => path.join(dir, FILE);

function readAll(dir) {
  const f = filePath(dir);
  if (!existsSync(f)) return {};
  try { return JSON.parse(readFileSync(f, 'utf8')) || {}; } catch { return {}; }
}

/** Returns { entries, targetOrg, testLevel, savedAt } for a source org, or null. */
export function loadSession(sourceOrg, dir = process.cwd()) {
  return readAll(dir)[sourceOrg] || null;
}

export function saveSession(sourceOrg, data, dir = process.cwd()) {
  if (!sourceOrg) return;
  const all = readAll(dir);
  all[sourceOrg] = {
    entries: data.entries || [],
    targetOrg: data.targetOrg || '',
    testLevel: data.testLevel || '',
    savedAt: new Date().toISOString(),
  };
  writeFileSync(filePath(dir), JSON.stringify(all, null, 2));
}
