import { connect } from './org.js';

// Fetch component source from both orgs for the diff viewer. Phase 1 = the Apex
// family, whose body is a single text field readable instantly via the Tooling
// API (no metadata retrieve/zip). Other types return { supported:false } for now.

const APEX = {
    ApexClass: { obj: 'ApexClass', field: 'Body' },
    ApexTrigger: { obj: 'ApexTrigger', field: 'Body' },
    ApexPage: { obj: 'ApexPage', field: 'Markup' },
    ApexComponent: { obj: 'ApexComponent', field: 'Markup' },
};

const escapeSoql = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// Returns the body string, or null if the component doesn't exist in this org.
async function apexBody(conn, obj, field, name) {
    if (!conn?.tooling?.query) return null;
    try {
        const res = await conn.tooling.query(
            `SELECT ${field} FROM ${obj} WHERE Name = '${escapeSoql(name)}'`,
        );
        const rec = res?.records?.[0];
        return rec ? (rec[field] ?? '') : null;
    } catch {
        return null;
    }
}

/**
 * Build getDiffSources(type, fullName) → { supported, sourceBody, targetBody }.
 * `getSourceConn` is a thunk (source connection is opened during the splash).
 * The target connection is opened once and reused (re-opened if the target changes).
 */
export function makeSourceFetcher({ getSourceConn, store }) {
    let tconn = null;
    let tconnFor = null;
    return async function getDiffSources(type, fullName) {
        const meta = APEX[type];
        if (!meta) return { supported: false };
        if (tconnFor !== store.targetOrg) {
            try {
                tconn = await connect(store.targetOrg);
                tconnFor = store.targetOrg;
            } catch {
                tconn = null;
            }
        }
        const [sourceBody, targetBody] = await Promise.all([
            apexBody(getSourceConn(), meta.obj, meta.field, fullName),
            apexBody(tconn, meta.obj, meta.field, fullName),
        ]);
        return { supported: true, sourceBody, targetBody };
    };
}
