import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

// All cross-project state lives under ~/.sfm (override with SFM_HOME), keyed by
// org *username* (immutable) so renaming an alias never forks the cache.
// Matches Salesforce's own ~/.sfdx / ~/.sf convention.
export function sfmHome() {
  return process.env.SFM_HOME ? path.resolve(process.env.SFM_HOME) : path.join(os.homedir(), '.sfm');
}

const safe = (s) => String(s || 'unknown').replace(/[^a-zA-Z0-9._@-]/g, '_');

export function configFile() { return path.join(sfmHome(), 'config.json'); }
export function cacheDir(orgKey) { return path.join(sfmHome(), 'cache', safe(orgKey)); }
export function cacheFile(orgKey, type) { return path.join(cacheDir(orgKey), `${safe(type)}.json`); }
export function sessionsFile(orgKey) { return path.join(sfmHome(), 'sessions', `${safe(orgKey)}.json`); }
export function retrieveDir(orgKey) { return path.join(sfmHome(), 'retrieve', safe(orgKey)); }

export function ensureDir(p) { mkdirSync(p, { recursive: true }); return p; }
