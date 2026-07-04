import { connect } from './org.js';
import { listComponents } from './metadata.js';
import { suggestTestClasses, buildTargetIndex, resolveDependencies } from './dependencies.js';

// I/O glue for the dependency check: gathers level-1 candidates (test-class
// naming + Salesforce's MetadataComponentDependency), then classifies them
// against the target org. The pure logic lives in dependencies.js; this module
// just talks to the orgs. Everything is best-effort — a Tooling API or target
// read failure degrades gracefully instead of blocking the deploy.

const MAX_DEP_IDS = 200; // cap the IN(...) list so the Tooling query stays well-formed

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

        // 3. Classify against the target org.
        const types = [...new Set(candidates.map((c) => c.type))];
        const targetByType = {};
        let caveat =
            'Based on naming + Salesforce dependency data; dynamic references (e.g. dynamic SOQL) may be missed.';
        try {
            const tconn = await connect(store.targetOrg);
            const targetKey = `target-${tconn.getUsername?.() || store.targetOrg}`;
            for (const type of types) {
                try {
                    ({ rows: targetByType[type] } = await listComponents(tconn, type, {
                        apiVersion,
                        orgKey: targetKey,
                    }));
                } catch {
                    targetByType[type] = [];
                }
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
        return { rows, caveat };
    };
}
