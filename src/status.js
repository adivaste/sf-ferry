import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ferryHome } from './paths.js';

/**
 * Inspect ~/.ferry and summarize what's stored — sessions, metadata cache, and
 * retrieve zips per org. Pure-ish (reads disk) and testable via a temp home.
 */
export function gatherStatus(home = ferryHome()) {
    const out = { home, sessions: [], cache: [], retrieve: [] };
    if (!existsSync(home)) return out;

    const sdir = path.join(home, 'sessions');
    if (existsSync(sdir)) {
        for (const f of readdirSync(sdir).filter((x) => x.endsWith('.json'))) {
            try {
                const list = JSON.parse(readFileSync(path.join(sdir, f), 'utf8'));
                if (!Array.isArray(list)) continue; // a corrupt/non-array file isn't a session list
                out.sessions.push({
                    org: f.replace(/\.json$/, ''),
                    count: list.length,
                    newest: list[0]?.savedAt || null,
                });
            } catch {
                /* skip unreadable */
            }
        }
    }

    const cdir = path.join(home, 'cache');
    if (existsSync(cdir)) {
        for (const org of readdirSync(cdir)) {
            try {
                const files = readdirSync(path.join(cdir, org)).filter((x) => x.endsWith('.json'));
                let newest = 0;
                for (const ff of files) {
                    const m = statSync(path.join(cdir, org, ff)).mtimeMs;
                    if (m > newest) newest = m;
                }
                out.cache.push({
                    org,
                    types: files.length,
                    newest: newest ? new Date(newest).toISOString() : null,
                });
            } catch {
                /* skip */
            }
        }
    }

    const rdir = path.join(home, 'retrieve');
    if (existsSync(rdir)) {
        for (const org of readdirSync(rdir)) {
            const zip = path.join(rdir, org, 'unpackaged.zip');
            if (existsSync(zip)) {
                const st = statSync(zip);
                out.retrieve.push({
                    org,
                    sizeKb: Math.round(st.size / 1024),
                    at: new Date(st.mtimeMs).toISOString(),
                });
            }
        }
    }
    return out;
}
