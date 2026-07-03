import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

// All cross-project state lives under ~/.ferry (override with FERRY_HOME), keyed by
// org *username* (immutable) so renaming an alias never forks the cache.
// Matches Salesforce's own ~/.sfdx / ~/.sf convention.
export function ferryHome() {
    return process.env.FERRY_HOME ? path.resolve(process.env.FERRY_HOME) : path.join(os.homedir(), '.ferry');
}

const safe = (s) => String(s || 'unknown').replace(/[^a-zA-Z0-9._@-]/g, '_');

export function configFile() {
    return path.join(ferryHome(), 'config.json');
}
export function prefsFile() {
    return path.join(ferryHome(), 'prefs.json');
}
export function logFile() {
    return path.join(ferryHome(), 'log.json');
}
export function cacheDir(orgKey) {
    return path.join(ferryHome(), 'cache', safe(orgKey));
}
export function cacheFile(orgKey, type) {
    return path.join(cacheDir(orgKey), `${safe(type)}.json`);
}
export function sessionsFile(orgKey) {
    return path.join(ferryHome(), 'sessions', `${safe(orgKey)}.json`);
}
export function retrieveDir(orgKey) {
    return path.join(ferryHome(), 'retrieve', safe(orgKey));
}

export function ensureDir(p) {
    mkdirSync(p, { recursive: true });
    return p;
}
