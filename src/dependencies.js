/**
 * Pure dependency-analysis helpers — NO I/O.
 *
 * The caller supplies the source component lists (already cached) and a target
 * index (built from a listMetadata on the target org), so everything here is
 * unit-testable. The goal is level-1 suggestions the user reviews, never an
 * automatic transitive bundle: for each selected component we surface the
 * related components (test classes, referenced fields/objects/classes) and
 * classify each against the target as missing / older / present.
 */

const STATUS_ORDER = { missing: 0, older: 1, present: 2 };

const key = (type, fullName) => `${type}:${fullName}`;

/** Common test-class naming conventions for an Apex class. */
export function candidateTestNames(className) {
    return [
        `${className}Test`,
        `${className}_Test`,
        `${className}Tests`,
        `Test${className}`,
        `Test_${className}`,
    ];
}

/**
 * Suggest test classes that EXIST in the source for the selected Apex classes
 * but aren't selected yet — the "forgot the test" case, caught by naming alone.
 *
 * @param selectedApex  iterable of selected ApexClass fullNames
 * @param sourceApex    Set of all ApexClass fullNames in the source org
 * @param selectedSet   Set of already-selected `${type}:${fullName}` keys
 * @returns [{ type:'ApexClass', fullName, why }]
 */
export function suggestTestClasses(selectedApex, sourceApex, selectedSet = new Set()) {
    const out = [];
    const seen = new Set();
    for (const name of selectedApex) {
        if (/test/i.test(name)) continue; // already a test class
        for (const cand of candidateTestNames(name)) {
            const k = key('ApexClass', cand);
            if (sourceApex.has(cand) && !selectedSet.has(k) && !seen.has(cand)) {
                seen.add(cand);
                out.push({ type: 'ApexClass', fullName: cand, why: `test of ${name}` });
            }
        }
    }
    return out;
}

/**
 * Build a target lookup: type -> Map(fullName -> lastModifiedDate).
 * @param targetByType  { [type]: rows[] } with rows { fullName, lastModifiedDate }
 */
export function buildTargetIndex(targetByType = {}) {
    const idx = {};
    for (const [type, rows] of Object.entries(targetByType)) {
        const m = new Map();
        for (const r of rows || []) m.set(r.fullName, r.lastModifiedDate || '');
        idx[type] = m;
    }
    return idx;
}

/**
 * Classify a dependency against the target index and its source modified date.
 * - missing: the target org doesn't have it (would break the deploy).
 * - older:   present, but the target's copy is older than the source (maybe stale).
 * - present: present and at least as new (safe to skip).
 * ISO 8601 date strings compare correctly lexicographically.
 */
export function classifyStatus(dep, targetIndex = {}, sourceDate = '') {
    const m = targetIndex[dep.type];
    if (!m || !m.has(dep.fullName)) return 'missing';
    const targetDate = m.get(dep.fullName);
    if (sourceDate && targetDate && targetDate < sourceDate) return 'older';
    return 'present';
}

/**
 * Dedupe + classify + sort candidate dependencies for the review panel.
 *
 * @param candidates   [{ type, fullName, why }]
 * @param targetIndex  from buildTargetIndex()
 * @param sourceDates  Map `${type}:${fullName}` -> lastModifiedDate (source)
 * @param selectedSet  Set of already-selected keys (dropped from the result)
 * @returns rows [{ type, fullName, why, status, targetDate }] sorted
 *          missing → older → present, then by type/name.
 */
export function resolveDependencies({
    candidates = [],
    targetIndex = {},
    sourceDates = new Map(),
    selectedSet = new Set(),
} = {}) {
    const seen = new Set();
    const rows = [];
    for (const c of candidates) {
        const k = key(c.type, c.fullName);
        if (seen.has(k) || selectedSet.has(k)) continue;
        seen.add(k);
        const status = classifyStatus(c, targetIndex, sourceDates.get(k) || '');
        const m = targetIndex[c.type];
        rows.push({
            type: c.type,
            fullName: c.fullName,
            why: c.why || '',
            status,
            targetDate: (m && m.get(c.fullName)) || '',
        });
    }
    rows.sort(
        (a, b) =>
            STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
            a.type.localeCompare(b.type) ||
            a.fullName.localeCompare(b.fullName),
    );
    return rows;
}

/** How many rows are missing from the target (the ones that break deploys). */
export function missingCount(rows = []) {
    return rows.filter((r) => r.status === 'missing').length;
}
