/**
 * Line-level text diff — pure, no I/O.
 *
 * "old" is the TARGET (e.g. prod), "new" is the SOURCE (e.g. uat), so an added
 * line (in source, not target) is what a deploy would ADD, and a removed line is
 * what only the target has. Output is a flat op list with 1-based line numbers
 * for each side, ready to render with a two-column gutter.
 */

const MAX_LCS_CELLS = 4_000_000; // guard: skip the O(m·n) table for pathologically large, wholly-different files

function splitLines(text) {
    return String(text ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/\s+$/gm, '') // trim trailing whitespace per line to cut noise
        .split('\n');
}

// LCS diff of two line arrays → ops [{ kind:'ctx'|'del'|'add', text }] in order.
function lcsDiff(a, b) {
    const m = a.length;
    const n = b.length;
    if (m * n > MAX_LCS_CELLS) {
        // Too large to diff cell-by-cell — treat as a block replace.
        return [...a.map((text) => ({ kind: 'del', text })), ...b.map((text) => ({ kind: 'add', text }))];
    }
    const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
    for (let i = m - 1; i >= 0; i -= 1) {
        for (let j = n - 1; j >= 0; j -= 1) {
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const ops = [];
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
        if (a[i] === b[j]) {
            ops.push({ kind: 'ctx', text: a[i] });
            i += 1;
            j += 1;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            ops.push({ kind: 'del', text: a[i] });
            i += 1;
        } else {
            ops.push({ kind: 'add', text: b[j] });
            j += 1;
        }
    }
    while (i < m) ops.push({ kind: 'del', text: a[i++] });
    while (j < n) ops.push({ kind: 'add', text: b[j++] });
    return ops;
}

/**
 * Diff two texts. Returns { ops, added, removed } where each op is
 * { kind:'ctx'|'del'|'add', text, oldNo, newNo } (oldNo/newNo null when N/A).
 * Common leading/trailing lines are trimmed first so a small change in a big
 * file stays cheap.
 */
export function diffLines(oldText, newText) {
    const a = splitLines(oldText);
    const b = splitLines(newText);

    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
        endA -= 1;
        endB -= 1;
    }

    const mid = lcsDiff(a.slice(start, endA), b.slice(start, endB));

    const ops = [];
    let oldNo = 1;
    let newNo = 1;
    const pushCtx = (text) => ops.push({ kind: 'ctx', text, oldNo: oldNo++, newNo: newNo++ });
    const pushDel = (text) => ops.push({ kind: 'del', text, oldNo: oldNo++, newNo: null });
    const pushAdd = (text) => ops.push({ kind: 'add', text, oldNo: null, newNo: newNo++ });

    for (let i = 0; i < start; i += 1) pushCtx(a[i]);
    for (const op of mid) {
        if (op.kind === 'ctx') pushCtx(op.text);
        else if (op.kind === 'del') pushDel(op.text);
        else pushAdd(op.text);
    }
    for (let i = endA; i < a.length; i += 1) pushCtx(a[i]);

    let added = 0;
    let removed = 0;
    for (const op of ops) {
        if (op.kind === 'add') added += 1;
        else if (op.kind === 'del') removed += 1;
    }
    return { ops, added, removed };
}

/**
 * Collapse long runs of unchanged lines for "changes-only" view: keep `context`
 * lines around each change, replace longer gaps with a single marker op
 * { kind:'gap', count }. Returns a new op list.
 */
export function collapseContext(ops, context = 3) {
    const keep = new Array(ops.length).fill(false);
    for (let i = 0; i < ops.length; i += 1) {
        if (ops[i].kind !== 'ctx') {
            for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k += 1)
                keep[k] = true;
        }
    }
    const out = [];
    let gap = 0;
    for (let i = 0; i < ops.length; i += 1) {
        if (keep[i]) {
            if (gap) {
                out.push({ kind: 'gap', count: gap });
                gap = 0;
            }
            out.push(ops[i]);
        } else {
            gap += 1;
        }
    }
    if (gap) out.push({ kind: 'gap', count: gap });
    return out;
}
