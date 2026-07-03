import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { prefsFile, ensureDir } from './paths.js';
import { writeJsonAtomic } from './fsjson.js';

// Per-org UI preferences (last target org, last active type), so a returning
// user lands where they left off instead of re-picking every run. Keyed by the
// same org key as everything else (username, falling back to alias). Stored in
// ~/.ferry/prefs.json as { "<orgKey>": { lastTarget, lastType } }.

function readAll() {
    const f = prefsFile();
    if (!existsSync(f)) return {};
    try {
        const j = JSON.parse(readFileSync(f, 'utf8'));
        return j && typeof j === 'object' ? j : {};
    } catch {
        return {};
    }
}

/** Preferences for one org (never null). */
export function getPrefs(orgKey) {
    if (!orgKey) return {};
    const all = readAll();
    return all[orgKey] || {};
}

/**
 * Merge a patch into an org's prefs (undefined/empty values are ignored so we
 * never clobber a good value with a blank one). Returns the merged prefs.
 */
export function setPrefs(orgKey, patch = {}) {
    if (!orgKey) return {};
    const all = readAll();
    const cur = all[orgKey] || {};
    for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === '') continue;
        cur[k] = v;
    }
    all[orgKey] = cur;
    try {
        ensureDir(path.dirname(prefsFile()));
        writeJsonAtomic(prefsFile(), all, { pretty: true });
    } catch {
        /* best-effort — prefs are a convenience, never fatal */
    }
    return cur;
}
