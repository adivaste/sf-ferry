import assert from 'node:assert';
import { diffLines, collapseContext } from '../src/diff.js';

let n = 0;
const ok = (label, cond) => {
    assert.ok(cond, label);
    console.log('PASS', label);
    n += 1;
};

// identical
const id = diffLines('a\nb\nc', 'a\nb\nc');
ok('identical → no adds/removes', id.added === 0 && id.removed === 0);
ok(
    'identical → all context',
    id.ops.every((o) => o.kind === 'ctx'),
);

// a single changed line
const one = diffLines('a\nb\nc', 'a\nB\nc');
ok('one change → 1 add, 1 remove', one.added === 1 && one.removed === 1);
ok(
    'line numbers on changed lines',
    (() => {
        const del = one.ops.find((o) => o.kind === 'del');
        const add = one.ops.find((o) => o.kind === 'add');
        return del.oldNo === 2 && del.newNo === null && add.newNo === 2 && add.oldNo === null;
    })(),
);

// pure additions
const addOnly = diffLines('a\nb', 'a\nb\nc\nd');
ok('appended lines → adds only', addOnly.added === 2 && addOnly.removed === 0);

// pure removals
const delOnly = diffLines('a\nb\nc\nd', 'a\nb');
ok('deleted lines → removes only', delOnly.removed === 2 && delOnly.added === 0);

// context line numbers stay in sync
const seq = diffLines('l1\nl2\nl3\nl4', 'l1\nX\nl3\nl4');
const lastCtx = seq.ops.filter((o) => o.kind === 'ctx').pop();
ok('trailing context keeps aligned numbers', lastCtx.oldNo === 4 && lastCtx.newNo === 4);

// trailing whitespace is ignored (no false diff)
const ws = diffLines('a  \nb', 'a\nb');
ok('trailing whitespace ignored', ws.added === 0 && ws.removed === 0);

// collapseContext keeps changes + small context, gaps the rest
const big = diffLines(
    Array.from({ length: 40 }, (_, i) => `l${i}`).join('\n'),
    ['l0', 'l1', 'CHANGED', ...Array.from({ length: 37 }, (_, i) => `l${i + 3}`)].join('\n'),
);
const collapsed = collapseContext(big.ops, 2);
ok(
    'collapse inserts a gap marker',
    collapsed.some((o) => o.kind === 'gap'),
);
ok(
    'collapse keeps the change',
    collapsed.some((o) => o.kind === 'add' || o.kind === 'del'),
);
ok('collapse shorter than full', collapsed.length < big.ops.length);

console.log(`\n${n} diff checks passed`);
