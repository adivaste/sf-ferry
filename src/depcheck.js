import path from 'node:path';
import { connect } from './org.js';
import { listComponents } from './metadata.js';
import { suggestTestClasses, buildTargetIndex, resolveDependencies } from './dependencies.js';
import { writeJsonAtomic } from './fsjson.js';
import { ferryHome } from './paths.js';

// I/O glue for the dependency check: gathers level-1 candidates (test-class
// naming + Salesforce's MetadataComponentDependency), then classifies them
// against the target org. The pure logic lives in dependencies.js; this module
// just talks to the orgs. Everything is best-effort — a Tooling API or target
// read failure degrades gracefully instead of blocking the deploy.

const MAX_DEP_IDS = 200; // cap the IN(...) list so the Tooling query stays well-formed

// Dependency types checked via describe (authoritative for standard + custom)
// rather than listMetadata, which omits standard objects and many standard fields.
const OBJECT_TYPES = new Set(['CustomObject', 'StandardEntity']);
const FIELD_TYPES = new Set(['CustomField']);

// Normalize an API/DeveloperName to a comparable base: lowercase, drop a trailing
// custom suffix (__c, __mdt, __e, …) and any namespace prefix. The dependency API
// returns custom names as DeveloperName ("Broker", "Region") while describe returns
// API names ("Broker__c", "Region__c"); comparing on the base matches them in
// either direction, and standard names ("User", "Name") pass through unchanged.
function baseName(name) {
    const parts = String(name || '')
        .toLowerCase()
        .split('__');
    if (parts.length >= 2) parts.pop(); // drop the custom-suffix token (c / mdt / e / …)
    return parts[parts.length - 1] || ''; // last segment = the entity/field name (drops namespace)
}

function idsForEntries(entries, componentsByType) {
    const out = [];
    for (const e of entries) {
        const row = (componentsByType[e.type] || []).find((r) => r.fullName === e.fullName);
        if (row && row.id) out.push(row.id);
        if (out.length >= MAX_DEP_IDS) break;
    }
    return out;
}

/**
 * Build the checkDependencies(entries) function the TUI calls when D is pressed.
 * `getSourceConn` is a thunk so the source connection (opened during the splash)
 * is read lazily, at press time.
 */
export function makeDependencyChecker({ getSourceConn, apiVersion, store }) {
    return async function checkDependencies(entries) {
        const selectedSet = new Set(entries.map((e) => `${e.type}:${e.fullName}`));
        const sourceConn = getSourceConn();
        const candidates = [];

        // 1. Test-class pairing from the source ApexClass list.
        let apexRows = store.componentsByType.ApexClass;
        if (!apexRows && sourceConn) {
            try {
                ({ rows: apexRows } = await listComponents(sourceConn, 'ApexClass', {
                    apiVersion,
                    orgKey: store.sourceUsername,
                }));
            } catch {
                apexRows = [];
            }
        }
        const sourceApex = new Set((apexRows || []).map((r) => r.fullName));
        const selectedApex = entries.filter((e) => e.type === 'ApexClass').map((e) => e.fullName);
        candidates.push(...suggestTestClasses(selectedApex, sourceApex, selectedSet));

        // 2. MetadataComponentDependency (Tooling API) — what the selection references.
        try {
            const ids = idsForEntries(entries, store.componentsByType);
            if (ids.length && sourceConn?.tooling?.query) {
                const inList = ids.map((id) => `'${id}'`).join(',');
                const soql =
                    'SELECT RefMetadataComponentType, RefMetadataComponentName ' +
                    `FROM MetadataComponentDependency WHERE MetadataComponentId IN (${inList})`;
                const res = await sourceConn.tooling.query(soql);
                for (const rec of res?.records || []) {
                    if (rec.RefMetadataComponentName && rec.RefMetadataComponentType) {
                        candidates.push({
                            type: rec.RefMetadataComponentType,
                            fullName: rec.RefMetadataComponentName,
                            why: 'referenced',
                        });
                    }
                }
            }
        } catch {
            /* Tooling API unavailable / query error — degrade to naming-only */
        }

        // Source modified dates (from whatever's already cached) for staleness.
        const sourceDates = new Map();
        for (const [type, rows] of Object.entries(store.componentsByType)) {
            for (const r of rows || []) sourceDates.set(`${type}:${r.fullName}`, r.lastModifiedDate || '');
        }

        // 3. Classify against the target org. Existence is only reported "missing"
        //    when we can CONFIRM it's absent — otherwise we assume present, so we
        //    never falsely alarm on something the check just can't see.
        //
        //    Objects/fields are checked via DESCRIBE (authoritative for standard
        //    AND custom — listMetadata omits standard objects like User and many
        //    standard fields). Everything else uses listMetadata, which is correct
        //    for ApexClass, Flow, etc.
        const types = [...new Set(candidates.map((c) => c.type))];
        const targetByType = {};
        let caveat =
            'Based on naming + Salesforce dependency data; dynamic references (e.g. dynamic SOQL) may be missed.';
        try {
            const tconn = await connect(store.targetOrg);
            const targetKey = `target-${tconn.getUsername?.() || store.targetOrg}`;

            // Object existence (standard + custom) from a single global describe,
            // indexed by base name → real API name (so we can describe fields later).
            let objectApiByBase = null; // Map base->apiName; null = describe failed
            if (candidates.some((c) => OBJECT_TYPES.has(c.type) || FIELD_TYPES.has(c.type))) {
                try {
                    const g = await tconn.describeGlobal();
                    objectApiByBase = new Map((g?.sobjects || []).map((s) => [baseName(s.name), s.name]));
                } catch {
                    objectApiByBase = null;
                }
            }
            // Field base-names per object, described lazily. null = describe failed.
            const fieldCache = new Map();
            const fieldBasesOf = async (apiName) => {
                if (fieldCache.has(apiName)) return fieldCache.get(apiName);
                let set = null;
                try {
                    const d = await tconn.describe(apiName);
                    set = new Set((d?.fields || []).map((f) => baseName(f.name)));
                } catch {
                    set = null;
                }
                fieldCache.set(apiName, set);
                return set;
            };
            // A row is added to targetByType only when the component EXISTS (or when
            // we can't tell — assume present), so resolveDependencies marks the rest missing.
            const present = (fullName) => ({ fullName, lastModifiedDate: '' });

            for (const type of types) {
                const cands = candidates.filter((c) => c.type === type);
                const rowsForType = [];
                if (OBJECT_TYPES.has(type)) {
                    for (const c of cands) {
                        // Can't describe → assume present (don't falsely alarm).
                        if (objectApiByBase === null || objectApiByBase.has(baseName(c.fullName))) {
                            rowsForType.push(present(c.fullName));
                        }
                    }
                } else if (FIELD_TYPES.has(type)) {
                    for (const c of cands) {
                        const dot = c.fullName.indexOf('.');
                        // No parent object, or global describe failed → can't tell, assume present.
                        if (dot < 0 || objectApiByBase === null) {
                            rowsForType.push(present(c.fullName));
                            continue;
                        }
                        const objApi = objectApiByBase.get(baseName(c.fullName.slice(0, dot)));
                        if (!objApi) {
                            rowsForType.push(present(c.fullName)); // parent object unknown → don't alarm
                            continue;
                        }
                        const fset = await fieldBasesOf(objApi);
                        if (fset === null || fset.has(baseName(c.fullName.slice(dot + 1)))) {
                            rowsForType.push(present(c.fullName));
                        }
                    }
                } else {
                    try {
                        // refresh:true — existence must reflect the target's CURRENT state
                        // (a prior deploy in this session changed it).
                        const { rows: listed } = await listComponents(tconn, type, {
                            apiVersion,
                            orgKey: targetKey,
                            refresh: true,
                        });
                        rowsForType.push(...listed);
                    } catch {
                        /* leave empty → treated as missing */
                    }
                }
                targetByType[type] = rowsForType;
            }
        } catch (e) {
            caveat = `Couldn't read the target org (${e.message}); showing dependencies without target comparison.`;
        }

        const rows = resolveDependencies({
            candidates,
            targetIndex: buildTargetIndex(targetByType),
            sourceDates,
            selectedSet,
        });

        // FERRY_DEBUG=1 → dump raw candidates + classification to a file so the exact
        // names the org returns can be inspected (the TUI can't print to stderr).
        if (process.env.FERRY_DEBUG) {
            try {
                writeJsonAtomic(
                    path.join(ferryHome(), 'depcheck-debug.json'),
                    { target: store.targetOrg, candidates, targetByType, rows },
                    { pretty: true },
                );
            } catch {
                /* debug dump is best-effort */
            }
        }

        return { rows, caveat };
    };
}
