import blessed from 'blessed';
import {
    COLUMNS,
    visibleRows,
    setTypes,
    setSelection,
    setActiveType,
    setFilter,
    setSort,
    toggleSelect,
    selectAllVisible,
    clearVisible,
    isSelected,
    selectionCount,
    selectedCountForType,
    selectionGrouped,
    hasComponents,
    manifestEntries,
} from './store.js';
// buildPackageXml (for the `p` preview) is imported lazily — it pulls in SDR.
import { TEST_LEVELS, RELEVANT_TESTS_MIN_API, relevantTestsUnsupported } from './constants.js';
import { collapseContext } from './diff.js';

const trunc = (s, n) => {
    s = s || '';
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
const pad = (s, n) => {
    s = s || '';
    return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
};
const shortDate = (d) => (d ? String(d).slice(0, 10) : '');
function ago(iso) {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(ms) || ms < 0) return '';
    const s = Math.floor(ms / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}
// Escape literal braces so component names can't break blessed tag parsing.
const esc = (s) => s.replace(/\{/g, '{open}').replace(/\}/g, '{close}');

// fzf-style: underline+bold the characters that matched the filter tokens.
function highlightMatches(text, tokens) {
    if (!tokens || tokens.length === 0) return esc(text);
    const lower = text.toLowerCase();
    const hit = new Array(text.length).fill(false);
    for (const tok of tokens) {
        if (!tok) continue;
        let i = lower.indexOf(tok);
        while (i !== -1) {
            for (let k = i; k < i + tok.length; k += 1) hit[k] = true;
            i = lower.indexOf(tok, i + 1);
        }
    }
    let out = '';
    let run = '';
    let runHit = false;
    const flush = () => {
        if (!run) return;
        out += runHit ? `{underline}{bold}${esc(run)}{/bold}{/underline}` : esc(run);
        run = '';
    };
    for (let i = 0; i < text.length; i += 1) {
        if (hit[i] !== runHit) {
            flush();
            runHit = hit[i];
        }
        run += text[i];
    }
    flush();
    return out;
}

// Render a diff (from diff.js) into blessed-tag lines with a two-column line-
// number gutter and green/red +/- coloring. mode 'full' shows the whole file;
// 'changes' collapses unchanged runs into "⋯ N unchanged" markers.
function formatDiffLines(diff, mode, innerWidth) {
    let maxOld = 1;
    let maxNew = 1;
    for (const o of diff.ops) {
        if (o.oldNo && o.oldNo > maxOld) maxOld = o.oldNo;
        if (o.newNo && o.newNo > maxNew) maxNew = o.newNo;
    }
    const wOld = String(maxOld).length;
    const wNew = String(maxNew).length;
    const textW = Math.max(10, innerWidth - wOld - wNew - 6);
    const display = mode === 'changes' ? collapseContext(diff.ops, 3) : diff.ops;
    const truncTag = (s) => (s.length > textW ? `${s.slice(0, textW - 1)}…` : s);
    const escT = (s) => String(s).replace(/\{/g, '{open}').replace(/\}/g, '{close}');
    return display.map((op) => {
        if (op.kind === 'gap') {
            return `{gray-fg}${' '.repeat(wOld + wNew + 2)}⋯ ${op.count} unchanged{/gray-fg}`;
        }
        const o = op.oldNo != null ? String(op.oldNo).padStart(wOld) : ' '.repeat(wOld);
        const nn = op.newNo != null ? String(op.newNo).padStart(wNew) : ' '.repeat(wNew);
        const gut = `{gray-fg}${o} ${nn} │{/gray-fg}`;
        const t = escT(truncTag(op.text));
        if (op.kind === 'add') return `${gut} {green-fg}+ ${t}{/green-fg}`;
        if (op.kind === 'del') return `${gut} {red-fg}- ${t}{/red-fg}`;
        return `${gut}   {gray-fg}${t}{/gray-fg}`;
    });
}

// State-aware body for the diff viewer (both the modal and the split pane).
function formatDiffBody(data, mode, innerWidth) {
    if (!data || !data.supported) {
        return [
            '{gray-fg}Diff isn’t available for this type yet — Apex classes, triggers, pages, and components for now.{/gray-fg}',
        ];
    }
    if (!data.sourceExists && !data.targetExists) return ['{gray-fg}Not found in either org.{/gray-fg}'];
    if (!data.targetExists) {
        return [
            '{green-fg}✓ New in the target — the whole component would be created.{/green-fg}',
            '',
            ...formatDiffLines(data.diff, 'full', innerWidth),
        ];
    }
    if (!data.sourceExists) return ['{red-fg}Only in the target — not present in the source.{/red-fg}'];
    if (data.diff.added === 0 && data.diff.removed === 0)
        return ['{green-fg}✓ Identical in both orgs.{/green-fg}'];
    return formatDiffLines(data.diff, mode, innerWidth);
}

const SPIN_FRAMES = ['|', '/', '-', '\\']; // ASCII — renders in every terminal/font

// Single source of truth for the unfocused border colour. 235 is a dark grey in
// the 256-colour palette; change it here and every idle border follows. (A focused
// pane overrides this with cyan.)
const DIM = 235;

// ---- tunables --------------------------------------------------------------
const DEDUPE_WINDOW_MS = 12; // drop a duplicate keypress within this window (Windows stdin quirk)
const SPIN_INTERVAL_MS = 90; // spinner frame cadence
const FILTER_DEBOUNCE_MS = 110; // settle time after the last keystroke before re-filtering
const RESIZE_DEBOUNCE_MS = 50; // coalesce a burst of resize events into one repaint

// Pane widths as a percentage of screen width; the centre pane takes the rest.
const LEFT_PANE_PCT = 25; // Types pane
const RIGHT_PANE_PCT = 30; // Selected pane
const CENTER_PANE_PCT = 100 - LEFT_PANE_PCT - RIGHT_PANE_PCT;

// Component-table column widths, in characters.
const COL_MODIFIED_BY_W = 16;
const COL_DATE_W = 10;

const HELP_TEXT = [
    '{bold}{cyan-fg}Navigation{/cyan-fg}{/bold}',
    '  ↑ ↓  /  j k       move',
    '  PgUp / PgDn       page up / down',
    '  g / G             jump to top / bottom',
    '  tab / shift+tab   switch pane',
    '',
    '{bold}{cyan-fg}Types pane{/cyan-fg}{/bold}',
    '  type…             filter types (picklist)',
    '  enter             open the highlighted type',
    '',
    '{bold}{cyan-fg}Components pane{/cyan-fg}{/bold}',
    '  space             check / uncheck',
    '  a / c             select all / clear (current filter)',
    '  V                 visual range-select (move, then space)',
    '  /                 filter rows (matches name + owner)',
    '  f                 pin the filter across type switches',
    '  1 2 3 4           sort by column (press again to reverse)',
    '',
    '{bold}{cyan-fg}Selected pane{/cyan-fg}{/bold}',
    '  ↑ ↓  /  j k       move within the selection',
    '  space / x         remove the highlighted item',
    '',
    '{bold}{cyan-fg}Layout{/cyan-fg}{/bold}',
    '  Ctrl+B            hide / show the Types panel',
    '  Alt+B             hide / show the Selected panel',
    '',
    '{bold}{cyan-fg}Actions{/cyan-fg}{/bold}',
    '  t                 choose target org',
    '  l                 choose test level',
    '  s                 load a saved selection (history)',
    '  S                 save the selection with a name',
    '  p                 preview the generated package.xml',
    '  >                 diff the highlighted component: source ↔ target',
    '  D                 check dependencies against the target org',
    '  r                 refresh current type from the org',
    '  b                 write package.xml only',
    '  v / d             validate / deploy (org → org)',
    '  (b / v / d / q ask for confirmation; Ctrl+C force-quits)',
    '  ? / Esc           close this help',
    '  q                 quit  (offers save & quit)',
].join('\n');

/**
 * Launch the interactive selection screen.
 *
 * The component list is a hand-virtualized viewport: the full filtered+sorted
 * array (`view`) is computed ONCE per filter/sort/type change, and only the
 * rows visible in the window are ever formatted/rendered (like fzf / vim).
 * Scrolling is pure array slicing — O(viewport), independent of total size.
 */
export function runTui({
    store,
    loadComponents,
    orgs = [],
    prepare = null,
    onListSessions = null,
    onSaveSession = null,
    checkDependencies = null,
    getDiffSources = null,
    initialTestLevel = null,
    apiVersion = null,
}) {
    // loadComponents/orgs may be (re)assigned by `prepare` after the splash.
    let _load = loadComponents;
    let _orgs = orgs;
    return new Promise((resolve) => {
        // On a real interactive terminal we assume 256-colour + unicode so the dark
        // grey borders (DIM=235) and box-drawing glyphs render as intended instead of
        // being downsampled to the nearest 16 colours. We only FORCE that when it's
        // safe — a TTY that isn't `dumb` and hasn't opted out via NO_COLOR — so we
        // don't spray 256-colour / unicode escapes into a pipe, CI log, or a terminal
        // that genuinely can't handle them (there blessed auto-detects instead).
        const richTerminal = !!process.stdout.isTTY && process.env.TERM !== 'dumb' && !process.env.NO_COLOR;
        const screen = blessed.screen({
            smartCSR: true,
            title: 'ferry — metadata migrator',
            autoPadding: true,
            ...(richTerminal ? { terminal: 'xterm-256color', forceUnicode: true, fullUnicode: true } : {}),
        });

        // de-duplicate doubled keypresses (Node-on-Windows stdin quirk)
        const program = screen.program;
        let lastSig = '';
        let lastAt = 0;
        const realEmit = program.emit.bind(program);
        const dedupeEmit = (type, ...args) => {
            if (type === 'keypress') {
                const key = args[1];
                const sig = `${key ? key.full || key.name : ''}|${args[0] || ''}`;
                const now = Date.now();
                if (sig === lastSig && now - lastAt < DEDUPE_WINDOW_MS) {
                    lastAt = now;
                    return false;
                }
                lastSig = sig;
                lastAt = now;
            }
            return realEmit(type, ...args);
        };
        const applyDedupe = () => {
            program.emit = dedupeEmit;
        };
        const removeDedupe = () => {
            program.emit = realEmit;
        };
        applyDedupe();

        let testLevel =
            initialTestLevel && TEST_LEVELS.includes(initialTestLevel) ? initialTestLevel : 'RunLocalTests';
        let busy = false;
        let filtering = false;
        let modal = false;
        let typeFilter = ''; // type-ahead filter for the Types pane
        let stickyFilter = false; // when on, the row filter survives a type switch (f)
        let leftVisible = true; // Types pane (Ctrl+B)
        let rightVisible = true; // Selected pane (Alt+B)
        let basketCursor = 0; // highlighted item in the Selected pane
        let visualAnchor = null; // start index of a visual range-select (null = off)
        let depMissing = 0; // deps missing in the target from the last D check (0 = none/stale)
        let spinTimer = null;
        let spinFrame = 0;
        let splashTimer = null;
        let helpBox = null;
        let focusedPane = null;

        // virtualized list state
        let view = []; // cached filtered + sorted rows for the active type
        let cursor = 0; // index into `view`
        let top = 0; // first visible index

        // ---- layout ----------------------------------------------------------
        // Mirror the footer's metrics exactly: height 3, bordered (no padding).
        const header = blessed.box({
            // solid dark-grey bar filling all 3 rows (no border), stretched edge-to-edge
            // (left+right, not width:100%, which overflowed by a column)
            parent: screen,
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            tags: true,
            valign: 'middle',
            border: 'line',
            style: { border: { fg: DIM } },
        });
        const typesList = blessed.list({
            parent: screen,
            label: ' Types ',
            top: 3,
            left: 0,
            width: `${LEFT_PANE_PCT}%`,
            bottom: 3,
            border: 'line',
            keys: true,
            mouse: true,
            tags: true,
            style: { selected: { bg: 'cyan', fg: 'black' }, border: { fg: 'cyan' }, label: { fg: 'cyan' } },
            scrollbar: { ch: ' ', style: { bg: 'cyan' } },
        });
        const filterBox = blessed.textbox({
            parent: screen,
            label: ' Filter (/) ',
            top: 3,
            left: `${LEFT_PANE_PCT}%`,
            width: `${CENTER_PANE_PCT}%`,
            height: 3,
            border: 'line',
            inputOnFocus: true,
            style: { border: { fg: DIM }, label: { fg: 'cyan' } },
        });
        const table = blessed.box({
            parent: screen,
            label: ' Components ',
            top: 6,
            left: `${LEFT_PANE_PCT}%`,
            width: `${CENTER_PANE_PCT}%`,
            bottom: 3,
            border: 'line',
            tags: true,
            keys: true,
            mouse: true,
            scrollable: false,
            style: { border: { fg: DIM }, label: { fg: 'cyan' } },
        });
        const basket = blessed.box({
            // keys:false — we drive the cursor + removal ourselves so the built-in
            // scroll keys don't fight our navigation (see basketMove/basketRemove).
            parent: screen,
            label: ' Selected ',
            top: 3,
            left: `${100 - RIGHT_PANE_PCT}%`,
            right: 0,
            bottom: 3,
            border: 'line',
            tags: true,
            scrollable: true,
            alwaysScroll: true,
            mouse: true,
            keys: false,
            scrollbar: { ch: ' ', style: { bg: 'green' } },
            style: { border: { fg: DIM }, label: { fg: 'green' } },
        });
        const footer = blessed.box({
            parent: screen,
            bottom: 0,
            left: 0,
            width: '100%',
            height: 3,
            border: 'line',
            tags: true,
            style: { border: { fg: DIM } },
        });

        const panes = [typesList, table, basket];
        function focusPane(el) {
            for (const p of panes) p.style.border.fg = DIM;
            el.style.border.fg = 'cyan';
            el.focus();
            focusedPane = el;
            renderBasket(); // reflect focus in the Selected pane (highlight on/off)
            renderFooter();
            screen.render();
        }
        const paint = () => screen.render();

        function startSpin(msg) {
            stopSpin();
            spinFrame = 0;
            footer.setContent(` {cyan-fg}${SPIN_FRAMES[0]}{/cyan-fg} ${msg}`);
            paint();
            spinTimer = setInterval(() => {
                try {
                    spinFrame = (spinFrame + 1) % SPIN_FRAMES.length;
                    footer.setContent(` {cyan-fg}${SPIN_FRAMES[spinFrame]}{/cyan-fg} ${msg}`);
                    screen.render();
                } catch {
                    /* screen torn down */
                }
            }, SPIN_INTERVAL_MS);
            if (spinTimer.unref) spinTimer.unref(); // never keep the process alive
        }
        function stopSpin() {
            if (spinTimer) {
                clearInterval(spinTimer);
                spinTimer = null;
            }
        }

        // Collapse/expand the side panels so the center table can use the space.
        function relayout() {
            const lw = leftVisible ? LEFT_PANE_PCT : 0;
            const rw = rightVisible ? RIGHT_PANE_PCT : 0;
            const cw = 100 - lw - rw;
            if (leftVisible) typesList.show();
            else typesList.hide();
            if (rightVisible) basket.show();
            else basket.hide();
            filterBox.left = `${lw}%`;
            filterBox.width = `${cw}%`;
            table.left = `${lw}%`;
            table.width = `${cw}%`;
            basket.left = `${100 - rw}%`;
            renderTable(); // recompute column widths for the new center width
            paint(); // single render (was rendering twice)
        }

        // ---- viewport helpers ------------------------------------------------
        function viewportHeight() {
            const h = typeof table.height === 'number' && table.height > 0 ? table.height : screen.height - 9;
            return Math.max(3, h - 2 - 1); // borders + in-table header row
        }
        function colWidths() {
            const inner = Math.max(
                24,
                (typeof table.width === 'number' ? table.width : Math.floor(screen.width * 0.45)) - 3,
            );
            const byW = COL_MODIFIED_BY_W;
            const dateW = COL_DATE_W;
            let nameW = inner - 3 /*mark*/ - byW - dateW - dateW - 4; /*gaps*/
            if (nameW < 8) nameW = 8;
            return { inner, nameW, byW, dateW };
        }
        function recomputeView({ resetCursor = false } = {}) {
            view = hasComponents(store, store.activeType) ? visibleRows(store) : [];
            if (resetCursor) {
                cursor = 0;
                top = 0;
            } else if (cursor > view.length - 1) cursor = Math.max(0, view.length - 1);
        }

        // ---- rendering -------------------------------------------------------
        function renderHeader() {
            const tgt = store.targetOrg || '(press t)';
            // labels/divider in white (visible on the grey bar); values in bright colors
            const div = '  {white-fg}|{/white-fg}  ';
            header.setContent(
                ` {bold}⚓ {cyan-fg}FERRY{/cyan-fg}{/bold}` +
                    div +
                    `{white-fg}source{/white-fg} {cyan-fg}{bold}${store.sourceOrg}{/bold}{/cyan-fg}  ` +
                    `{white-fg}→  target{/white-fg} {yellow-fg}{bold}${tgt}{/bold}{/yellow-fg}` +
                    div +
                    `{white-fg}tests{/white-fg} {magenta-fg}{bold}${testLevel}{/bold}{/magenta-fg}` +
                    div +
                    `{green-fg}{bold}✓ ${selectionCount(store)}{/bold} selected{/green-fg}` +
                    (depMissing > 0 ? `${div}{yellow-fg}{bold}⚠ ${depMissing} new{/bold}{/yellow-fg}` : ''),
            );
        }
        // Cache the filtered type list by its filter key so re-deriving it (e.g. in
        // updateTypeItem on every space press) is free until the type-ahead changes.
        let _typesCache = { key: null, arr: null };
        function filteredTypes() {
            const t = typeFilter.trim().toLowerCase();
            if (_typesCache.key === t && _typesCache.arr) return _typesCache.arr;
            let arr;
            if (!t) {
                arr = store.types;
            } else {
                const toks = t.split(/\s+/);
                arr = store.types.filter((x) => {
                    const n = x.name.toLowerCase();
                    return toks.every((tok) => n.includes(tok));
                });
            }
            _typesCache = { key: t, arr };
            return arr;
        }
        function renderTypes() {
            const arr = filteredTypes();
            typesList.setItems(
                arr.map((t) => {
                    const sel = selectedCountForType(store, t.name);
                    return `${t.name}${sel ? ` {green-fg}(${sel})✓{/green-fg}` : ''}`;
                }),
            );
            const idx = arr.findIndex((t) => t.name === store.activeType);
            typesList.select(idx >= 0 ? idx : 0);
            typesList.setLabel(typeFilter ? ` Types  /${typeFilter} ` : ` Types (${store.types.length}) `);
        }
        // Update ONE type's selected-count badge in place. Toggling a component only
        // changes a single badge, so we avoid setItems() here — rebuilding every list
        // item drops blessed's position cache and forces a full-region repaint of the
        // Types pane on each keypress (the visible flicker).
        function updateTypeItem(typeName) {
            const arr = filteredTypes();
            const i = arr.findIndex((t) => t.name === typeName);
            if (i < 0) return; // not in the currently filtered list — nothing on screen to update
            const sel = selectedCountForType(store, typeName);
            typesList.setItem(i, `${typeName}${sel ? ` {green-fg}(${sel})✓{/green-fg}` : ''}`);
        }
        function sortHead(key, label) {
            return store.sortKey === key ? `${label} ${store.sortDir === 1 ? '▲' : '▼'}` : label;
        }
        function renderTable() {
            const { inner, nameW, byW, dateW } = colWidths();
            const vh = viewportHeight();
            const total = view.length;
            // clamp cursor + scroll window
            if (cursor > total - 1) cursor = Math.max(0, total - 1);
            if (cursor < 0) cursor = 0;
            if (total === 0) top = 0;
            else {
                if (cursor < top) top = cursor;
                if (cursor >= top + vh) top = cursor - vh + 1;
                if (top > total - vh) top = Math.max(0, total - vh);
                if (top < 0) top = 0;
            }

            const headLine = `   ${pad(sortHead('fullName', 'Name'), nameW)} ${pad(sortHead('lastModifiedByName', 'Modified By'), byW)} ${pad(sortHead('lastModifiedDate', 'Modified'), dateW)} ${pad(sortHead('createdDate', 'Created'), dateW)}`;
            const lines = [`{yellow-fg}{bold}${headLine}{/bold}{/yellow-fg}`];

            if (!hasComponents(store, store.activeType)) {
                lines.push('  {gray-fg}loading…{/gray-fg}');
            } else if (total === 0) {
                lines.push('  {gray-fg}(no matches){/gray-fg}');
            } else {
                const term = store.filter.trim().toLowerCase();
                const tokens = term ? term.split(/\s+/) : [];
                const rangeLo = visualAnchor == null ? -1 : Math.min(visualAnchor, cursor);
                const rangeHi = visualAnchor == null ? -1 : Math.max(visualAnchor, cursor);
                const slice = view.slice(top, top + vh);
                for (let i = 0; i < slice.length; i += 1) {
                    const r = slice[i];
                    const gi = top + i;
                    const sel = isSelected(store, r.type, r.fullName);
                    const mark = sel ? '[x]' : '[ ]';
                    const namePlain = pad(trunc(r.fullName, nameW), nameW);
                    const byPlain = pad(trunc(r.lastModifiedByName, byW), byW);
                    const mdPlain = pad(shortDate(r.lastModifiedDate), dateW);
                    const cdPlain = pad(shortDate(r.createdDate), dateW);
                    const plainRaw = `${mark} ${namePlain} ${byPlain} ${mdPlain} ${cdPlain}`;
                    const nameR = tokens.length ? highlightMatches(namePlain, tokens) : esc(namePlain);
                    const renderedRaw = `${mark} ${nameR} ${esc(byPlain)} ${esc(mdPlain)} ${esc(cdPlain)}`;
                    const inRange = gi >= rangeLo && gi <= rangeHi;
                    if (gi === cursor) {
                        const padN = Math.max(0, inner - plainRaw.length);
                        lines.push(
                            `{cyan-bg}{black-fg}${renderedRaw}${' '.repeat(padN)}{/black-fg}{/cyan-bg}`,
                        );
                    } else if (inRange) {
                        const padN = Math.max(0, inner - plainRaw.length);
                        lines.push(
                            `{blue-bg}{white-fg}${renderedRaw}${' '.repeat(padN)}{/white-fg}{/blue-bg}`,
                        );
                    } else if (sel) {
                        lines.push(`{green-fg}${renderedRaw}{/green-fg}`);
                    } else {
                        lines.push(renderedRaw);
                    }
                }
            }
            table.setContent(lines.join('\n'));
            const fetched = store.fetchedAt[store.activeType];
            const age = fetched ? `  ·  fetched ${ago(fetched)} (r=refresh)` : '';
            table.setLabel(` Components ${total ? cursor + 1 : 0}/${total}${age} `);
        }
        // Flat, display-ordered list of selected entries, rebuilt once per basket
        // render and reused by move/remove — so navigating the Selected pane never
        // re-groups+re-sorts the whole selection on each keystroke.
        let basketItems = [];
        function renderBasket() {
            const groups = selectionGrouped(store); // grouped+sorted ONCE per render
            basketItems = [];
            for (const g of groups)
                for (const fullName of g.items) basketItems.push({ type: g.type, fullName });
            const total = basketItems.length;
            if (total === 0) {
                basketCursor = 0;
                basket.setContent(
                    '{gray-fg}Nothing selected yet.\nHighlight a row and press space.{/gray-fg}',
                );
                return;
            }
            if (basketCursor > total - 1) basketCursor = total - 1;
            if (basketCursor < 0) basketCursor = 0;
            const focused = basket.focused;
            const lines = [];
            let idx = 0; // running index across all items
            let cursorLine = 0;
            for (const g of groups) {
                lines.push(`{bold}{green-fg}${g.type}{/green-fg}{/bold} (${g.items.length})`);
                for (const item of g.items) {
                    const isCur = idx === basketCursor;
                    if (isCur) cursorLine = lines.length;
                    const text = `  • ${esc(item)}`;
                    lines.push(isCur && focused ? `{cyan-bg}{black-fg}${text}{/black-fg}{/cyan-bg}` : text);
                    idx += 1;
                }
                lines.push('');
            }
            basket.setContent(lines.join('\n'));
            if (focused) basket.scrollTo(cursorLine);
        }
        function basketMove(d) {
            const n = basketItems.length;
            if (!n) return;
            basketCursor = (((basketCursor + d) % n) + n) % n;
            renderBasket();
            paint();
        }
        function basketRemove() {
            const it = basketItems[basketCursor];
            if (!it) return;
            toggleSelect(store, it.type, it.fullName);
            if (basketCursor > basketItems.length - 2) basketCursor = Math.max(0, basketItems.length - 2);
            refreshMarks(it.type, `Removed ${it.type} / ${it.fullName}`);
        }
        function renderFooter() {
            // Context-aware: show the keys relevant to the focused pane.
            let line1;
            if (typesList.focused) {
                line1 =
                    ' {cyan-fg}type{/cyan-fg} find type  {cyan-fg}↑↓{/cyan-fg} move  {cyan-fg}enter{/cyan-fg} open  {cyan-fg}Ctrl+B{/cyan-fg} hide panel';
            } else if (basket.focused) {
                line1 =
                    ' {cyan-fg}↑↓/jk{/cyan-fg} move  {red-fg}space/x{/red-fg} remove  {cyan-fg}tab{/cyan-fg} pane  {cyan-fg}Alt+B{/cyan-fg} hide panel';
            } else {
                line1 =
                    ' {cyan-fg}↑↓/jk{/cyan-fg} move  {cyan-fg}space{/cyan-fg} check  {cyan-fg}V{/cyan-fg} range  {cyan-fg}>{/cyan-fg} diff  {cyan-fg}a{/cyan-fg} all  {cyan-fg}c{/cyan-fg} clear  {cyan-fg}/{/cyan-fg} filter  {cyan-fg}1-4{/cyan-fg} sort  {cyan-fg}t{/cyan-fg} target  {cyan-fg}l{/cyan-fg} test-level';
            }
            footer.setContent(
                `${line1}\n` +
                    ' {green-fg}b{/green-fg} build  {green-fg}v{/green-fg} validate  {green-fg}d{/green-fg} deploy  {cyan-fg}D{/cyan-fg} deps  {cyan-fg}p{/cyan-fg} preview  {cyan-fg}s{/cyan-fg}/{cyan-fg}S{/cyan-fg} load/save  {cyan-fg}?{/cyan-fg} help  {red-fg}q{/red-fg} quit',
            );
        }
        function renderFilterLabel() {
            filterBox.setLabel(stickyFilter ? ' Filter (/) · pinned ' : ' Filter (/) ');
        }
        function renderAll() {
            renderFilterLabel();
            renderHeader();
            renderTypes();
            renderTable();
            renderBasket();
            renderFooter();
            paint();
        }
        function setStatus(msg) {
            footer.setContent(` {yellow-fg}${msg}{/yellow-fg}`);
        }
        function status(msg) {
            setStatus(msg);
            paint();
        }

        // ---- data loading ----------------------------------------------------
        async function ensureLoaded(type, { refresh = false } = {}) {
            if (hasComponents(store, type) && !refresh) {
                recomputeView({ resetCursor: true });
                renderTable();
                paint();
                return;
            }
            busy = true;
            startSpin(`Loading ${type} from ${store.sourceOrg} …`);
            try {
                await _load(type, { refresh });
            } catch (e) {
                stopSpin();
                busy = false;
                // The active type changed but its components failed to load; recompute so
                // `view` reflects the (now empty) active type instead of the previous
                // type's rows — otherwise space/select would act on an invisible row.
                recomputeView({ resetCursor: true });
                renderHeader();
                renderTypes();
                renderTable();
                renderFooter();
                status(`Error loading ${type}: ${e.message}`);
                return;
            }
            stopSpin();
            busy = false;
            recomputeView({ resetCursor: true });
            renderHeader();
            renderTypes();
            renderTable();
            renderFooter();
            paint();
        }

        // ---- navigation (virtualized) ---------------------------------------
        function move(delta) {
            if (view.length === 0) return;
            cursor = Math.min(view.length - 1, Math.max(0, cursor + delta));
            renderTable();
            paint();
        }
        table.key(['down', 'j'], () => move(1));
        table.key(['up', 'k'], () => move(-1));
        table.key('pagedown', () => move(viewportHeight()));
        table.key('pageup', () => move(-viewportHeight()));
        table.key(['home', 'g'], () => {
            cursor = 0;
            renderTable();
            paint();
        });
        table.key(['end', 'G'], () => {
            cursor = view.length - 1;
            renderTable();
            paint();
        });
        table.on('wheeldown', () => move(3));
        table.on('wheelup', () => move(-3));
        table.on('click', (data) => {
            const rel = data.y - table.atop - 2; // border + header row
            const gi = top + rel;
            if (gi >= 0 && gi < view.length) {
                cursor = gi;
                renderTable();
                paint();
            }
        });

        typesList.on('select', async (_item, index) => {
            const t = filteredTypes()[index];
            if (!t) return;
            setActiveType(store, t.name, { keepFilter: stickyFilter });
            if (stickyFilter && store.filter) filterBox.setValue(store.filter);
            else filterBox.clearValue();
            visualAnchor = null; // a range-select doesn't carry across types
            renderHeader();
            renderTypes();
            paint();
            await ensureLoaded(t.name);
            focusPane(table);
        });

        // Type-ahead filter on the Types pane (like a web picklist): typing letters
        // narrows the list live; backspace edits; esc clears. up/down/enter still
        // navigate/open via the list's own handlers.
        typesList.on('keypress', (ch, key) => {
            if (modal || filtering) return;
            const name = key && key.name;
            if (name === 'backspace') {
                if (typeFilter) {
                    typeFilter = typeFilter.slice(0, -1);
                    renderTypes();
                    paint();
                }
                return;
            }
            if (name === 'escape') {
                if (typeFilter) {
                    typeFilter = '';
                    renderTypes();
                    paint();
                }
                return;
            }
            const printable =
                ch &&
                ch.length === 1 &&
                !key.ctrl &&
                !key.meta &&
                ch >= ' ' &&
                ch !== ' ' &&
                ch !== '/' &&
                ch !== '?';
            if (printable) {
                typeFilter += ch;
                renderTypes();
                paint();
            }
        });

        // Repaint after a selection change, in a SINGLE render. Only the changed
        // type's badge is touched (updateTypeItem, not renderTypes), and an optional
        // status message is folded into the same paint so we never render twice.
        function refreshMarks(changedType = store.activeType, statusMsg = null) {
            depMissing = 0; // selection changed → the last dependency check is now stale
            renderTable();
            renderBasket();
            renderHeader();
            updateTypeItem(changedType);
            if (statusMsg != null) setStatus(statusMsg);
            paint();
        }

        function applyVisualRange() {
            const lo = Math.min(visualAnchor, cursor);
            const hi = Math.max(visualAnchor, cursor);
            const rows = view.slice(lo, hi + 1);
            visualAnchor = null;
            if (!rows.length) {
                renderTable();
                paint();
                return;
            }
            // If the whole range is already selected, the intent is to clear it;
            // otherwise select everything in the range.
            const allSel = rows.every((r) => isSelected(store, r.type, r.fullName));
            for (const r of rows) {
                const sel = isSelected(store, r.type, r.fullName);
                if (allSel && sel) toggleSelect(store, r.type, r.fullName);
                else if (!allSel && !sel) toggleSelect(store, r.type, r.fullName);
            }
            refreshMarks(store.activeType, `${allSel ? 'Unselected' : 'Selected'} ${rows.length} row(s)`);
        }

        screen.key('space', () => {
            if (filtering || modal || busy || !table.focused) return;
            if (visualAnchor != null) {
                applyVisualRange();
                return;
            }
            const r = view[cursor];
            if (!r) return;
            toggleSelect(store, r.type, r.fullName);
            refreshMarks(); // view membership unchanged → cursor stays put
        });
        // Visual range-select: V drops an anchor at the cursor, move to extend the
        // highlight, then space (de)selects the whole range. Esc / V again cancels.
        screen.key('S-v', () => {
            if (filtering || modal || busy || typing() || !table.focused) return;
            visualAnchor = visualAnchor == null ? cursor : null;
            renderTable();
            paint();
            status(
                visualAnchor == null
                    ? 'Visual select off'
                    : 'Visual: move, then space to (de)select the range · esc cancels',
            );
        });
        table.key('escape', () => {
            if (visualAnchor != null) {
                visualAnchor = null;
                renderTable();
                status('Visual select off');
                paint();
            }
        });

        // Selected pane: navigate + remove in place.
        basket.key(['down', 'j'], () => {
            if (basket.focused && !modal && !filtering) basketMove(1);
        });
        basket.key(['up', 'k'], () => {
            if (basket.focused && !modal && !filtering) basketMove(-1);
        });
        basket.key(['space', 'x', 'delete', 'backspace'], () => {
            if (basket.focused && !modal && !filtering && !busy) basketRemove();
        });
        basket.on('wheeldown', () => {
            if (basket.focused) basketMove(1);
        });
        basket.on('wheelup', () => {
            if (basket.focused) basketMove(-1);
        });
        // Letter/digit shortcuts are disabled while the Types pane is focused —
        // there, typing feeds the type-ahead filter instead.
        const typing = () => typesList.focused;

        screen.key('a', () => {
            if (filtering || modal || typing()) return;
            const before = selectedCountForType(store, store.activeType);
            selectAllVisible(store, view); // reuse the cached filtered+sorted view (no re-sort)
            const after = selectedCountForType(store, store.activeType);
            refreshMarks(
                store.activeType,
                `+${after - before} selected · ${after} in ${store.activeType} (${view.length} shown)`,
            );
        });
        screen.key('c', () => {
            if (filtering || modal || typing()) return;
            const before = selectedCountForType(store, store.activeType);
            clearVisible(store, view); // reuse the cached filtered+sorted view (no re-sort)
            const after = selectedCountForType(store, store.activeType);
            refreshMarks(
                store.activeType,
                `-${before - after} cleared · ${after} left in ${store.activeType}`,
            );
        });
        // f pins the row filter so it survives switching types (great for migrating
        // everything named "Account" across ApexClass, CustomField, Layout, …).
        screen.key('f', () => {
            if (filtering || modal || typing()) return;
            stickyFilter = !stickyFilter;
            renderFilterLabel();
            status(stickyFilter ? 'Filter pinned — kept across type switches' : 'Filter unpinned');
            paint();
        });

        for (let n = 1; n <= COLUMNS.length; n += 1) {
            screen.key(String(n), () => {
                if (filtering || modal || typing()) return;
                setSort(store, COLUMNS[n - 1].key);
                recomputeView();
                renderTable();
                paint();
            });
        }

        // ---- live filter -----------------------------------------------------
        screen.key('/', () => {
            if (modal || typing()) return;
            filtering = true;
            filterBox.style.border.fg = 'cyan';
            filterBox.focus();
            screen.render();
        });
        let filterTimer = null;
        filterBox.on('keypress', () => {
            if (filterTimer) clearTimeout(filterTimer);
            filterTimer = setTimeout(() => {
                filterTimer = null;
                setFilter(store, filterBox.value || '');
                recomputeView({ resetCursor: true });
                renderTable();
                paint();
            }, FILTER_DEBOUNCE_MS);
        });
        function endFilter(focusTable = true) {
            if (filterTimer) {
                clearTimeout(filterTimer);
                filterTimer = null;
            }
            filtering = false;
            filterBox.style.border.fg = DIM; // was 'gray' — kept idle borders inconsistent (looked white)
            setFilter(store, filterBox.value || '');
            recomputeView({ resetCursor: true });
            renderTable();
            if (focusTable) focusPane(table);
            else paint();
        }
        filterBox.on('submit', () => endFilter(true));
        filterBox.key('escape', () => {
            filterBox.cancel();
        });
        filterBox.on('cancel', () => {
            filterBox.clearValue();
            endFilter(true);
        });

        screen.key('r', async () => {
            if (filtering || modal || busy || typing()) return;
            await ensureLoaded(store.activeType, { refresh: true });
            focusPane(table);
        });
        // RunRelevantTests only works on API 66+; label it and warn if unsupported.
        const testLevelLabel = (lvl) =>
            lvl === 'RunRelevantTests' ? `${lvl}  (API ${RELEVANT_TESTS_MIN_API}+, beta)` : lvl;
        screen.key('l', () => {
            if (filtering || modal || typing()) return;
            openPicker({
                label: ' Test level  (↑↓ wraps · esc cancels) ',
                items: TEST_LEVELS.map(testLevelLabel),
                selectedIndex: Math.max(0, TEST_LEVELS.indexOf(testLevel)),
                onChoose: (i) => {
                    if (TEST_LEVELS[i]) {
                        testLevel = TEST_LEVELS[i];
                        renderHeader();
                        renderFooter();
                        if (relevantTestsUnsupported(testLevel, apiVersion)) {
                            status(
                                `RunRelevantTests needs API ${RELEVANT_TESTS_MIN_API}+ — set --api-version ${RELEVANT_TESTS_MIN_API} (currently ${apiVersion || 'default'}).`,
                            );
                        } else {
                            paint();
                        }
                    }
                },
            });
        });
        // Centered modal list with WRAPPING navigation (↑↓/jk cycle around the ends).
        // We manage keys ourselves (keys:false) so wrap-around works — blessed's
        // built-in list nav clamps at the ends.
        function openPicker({ label, items, onChoose, selectedIndex = 0 }) {
            const n = items.length; // capture BEFORE blessed — its list mutates the array you pass in
            if (!n) return;
            modal = true;
            const picker = blessed.list({
                parent: screen,
                label,
                top: 'center',
                left: 'center',
                width: '66%',
                height: '60%',
                border: 'line',
                keys: false,
                mouse: true,
                tags: true,
                items: items.slice(), // blessed gets its own copy
                style: {
                    selected: { bg: 'cyan', fg: 'black' },
                    border: { fg: 'cyan' },
                    label: { fg: 'cyan' },
                },
                scrollbar: { ch: ' ', style: { bg: 'cyan' } },
            });
            if (selectedIndex > 0 && selectedIndex < n) picker.select(selectedIndex);
            const close = () => {
                modal = false;
                picker.destroy();
                renderFooter();
                focusPane(table);
            };
            const move = (d) => {
                picker.select(((((picker.selected || 0) + d) % n) + n) % n);
                screen.render();
            };
            picker.key(['down', 'j'], () => move(1));
            picker.key(['up', 'k'], () => move(-1));
            picker.key(['home', 'g'], () => {
                picker.select(0);
                screen.render();
            });
            picker.key(['end', 'G'], () => {
                picker.select(n - 1);
                screen.render();
            });
            picker.key(['enter', 'return', 'space'], () => {
                const i = picker.selected || 0;
                close();
                onChoose(i);
            });
            picker.on('select', (_i, idx) => {
                close();
                onChoose(idx);
            }); // mouse click
            picker.key(['escape', 'q'], close);
            picker.focus();
            screen.render();
        }

        screen.key('t', () => {
            if (filtering || modal || typing()) return;
            if (_orgs.length === 0) {
                status('No other orgs found (pass --target).');
                return;
            }
            openPicker({
                label: ' Pick target org  (↑↓ wraps · esc cancels) ',
                items: _orgs.map((o) => o.label),
                onChoose: (i) => {
                    if (_orgs[i]) {
                        store.targetOrg = _orgs[i].value;
                        renderHeader();
                        paint();
                    }
                },
            });
        });

        // s → load a past selection from history (we never auto-restore).
        screen.key('s', () => {
            if (filtering || modal || typing()) return;
            const sessions = onListSessions ? onListSessions() : [];
            if (!sessions.length) {
                status("No saved sessions yet — they're checkpointed when you act or quit.");
                return;
            }
            const fmt = (s) => {
                const cnt = (s.entries || []).length;
                const tgt = s.targetOrg ? ` → ${s.targetOrg}` : '';
                const lbl = s.label ? `${s.label} · ` : '';
                return `${lbl}${cnt} comp${tgt} · ${s.testLevel || 'RunLocalTests'} · ${ago(s.savedAt)}`;
            };
            openPicker({
                label: ' Load a saved selection  (↑↓ wraps · esc cancels) ',
                items: sessions.map(fmt),
                onChoose: (idx) => {
                    const s = sessions[idx];
                    if (!s) return;
                    setSelection(store, s.entries);
                    if (s.targetOrg) store.targetOrg = s.targetOrg;
                    if (s.testLevel && TEST_LEVELS.includes(s.testLevel)) testLevel = s.testLevel;
                    recomputeView();
                    renderTable();
                    renderBasket();
                    renderHeader();
                    renderTypes();
                    paint();
                },
            });
        });

        function cleanup() {
            stopSpin();
            if (splashTimer) {
                clearInterval(splashTimer);
                splashTimer = null;
            }
            if (filterTimer) {
                clearTimeout(filterTimer);
                filterTimer = null;
            }
            if (resizeTimer) {
                clearTimeout(resizeTimer);
                resizeTimer = null;
            }
            removeDedupe();
        }

        function toggleHelp() {
            if (helpBox) {
                helpBox.destroy();
                helpBox = null;
                modal = false;
                focusPane(focusedPane || table);
                return;
            }
            modal = true;
            helpBox = blessed.box({
                parent: screen,
                top: 'center',
                left: 'center',
                width: '62%',
                height: '80%',
                border: 'line',
                tags: true,
                scrollable: true,
                alwaysScroll: true,
                keys: true,
                mouse: true,
                label: ' Keybindings — ? or Esc to close ',
                padding: { left: 1, right: 1 },
                style: { border: { fg: 'cyan' }, label: { fg: 'cyan' } },
                scrollbar: { ch: ' ', style: { bg: 'cyan' } },
            });
            helpBox.setContent(HELP_TEXT);
            helpBox.key(['escape', 'q', '?'], toggleHelp);
            helpBox.focus();
            paint();
        }
        screen.key('?', () => {
            if (filtering || modal) return;
            toggleHelp();
        });

        // Generic single-line prompt, rendered INSIDE blessed so we never hand stdin
        // off to another prompt after blessed (which leaves the terminal in raw mode
        // → no input). cb receives the raw string, or null if cancelled.
        function promptInput({ label, hint, initial = '', cb }) {
            modal = true;
            removeDedupe(); // let paste/burst input through unfiltered
            const box = blessed.box({
                parent: screen,
                top: 'center',
                left: 'center',
                width: '70%',
                height: 8,
                border: 'line',
                tags: true,
                label,
                style: { border: { fg: 'cyan' }, label: { fg: 'cyan' } },
            });
            if (hint) {
                blessed.box({
                    parent: box,
                    bottom: 1,
                    left: 1,
                    right: 1,
                    height: 2,
                    tags: true,
                    content: hint,
                });
            }
            const tb = blessed.textbox({
                parent: box,
                top: 1,
                left: 1,
                right: 1,
                height: 1,
                inputOnFocus: true,
                style: { fg: 'white', focus: { bg: 'black' } },
            });
            if (initial) tb.setValue(initial);
            const close = (val) => {
                box.destroy();
                applyDedupe();
                modal = false;
                focusPane(table);
                cb(val);
            };
            tb.on('submit', (v) => close(v));
            tb.key('escape', () => tb.cancel());
            tb.on('cancel', () => close(null));
            tb.focus();
            tb.readInput();
            screen.render();
        }

        // In-TUI prompt for RunSpecifiedTests test classes.
        function promptTests(cb) {
            promptInput({
                label: ' Test classes — comma-separated · Enter to run · Esc to cancel ',
                hint: '{gray-fg}e.g.  MyController_Test, AccountServiceTest{/gray-fg}',
                cb: (val) =>
                    cb(
                        val == null
                            ? null
                            : val
                                  .split(',')
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                    ),
            });
        }

        // p → preview the package.xml this selection would generate, without writing.
        function showPreview(xml, count) {
            modal = true;
            const box = blessed.box({
                parent: screen,
                top: 'center',
                left: 'center',
                width: '82%',
                height: '82%',
                border: 'line',
                tags: false,
                scrollable: true,
                alwaysScroll: true,
                keys: true,
                mouse: true,
                label: ` package.xml preview — ${count} component(s) · Esc / q to close `,
                padding: { left: 1, right: 1 },
                style: { border: { fg: 'cyan' }, label: { fg: 'cyan' } },
                scrollbar: { ch: ' ', style: { bg: 'cyan' } },
            });
            box.setContent(xml);
            const close = () => {
                box.destroy();
                modal = false;
                focusPane(focusedPane || table);
            };
            box.key(['escape', 'q', 'p'], close);
            box.focus();
            paint();
        }
        screen.key('p', async () => {
            if (filtering || modal || busy || typing()) return;
            const entries = manifestEntries(store);
            if (!entries.length) {
                status('Nothing selected to preview.');
                return;
            }
            busy = true;
            startSpin('Building package.xml preview …');
            let xml;
            try {
                const { buildPackageXml } = await import('./manifest.js'); // pulls SDR, lazy
                xml = await buildPackageXml(entries, apiVersion);
            } catch (e) {
                stopSpin();
                busy = false;
                status(`Preview failed: ${e.message}`);
                return;
            }
            stopSpin();
            busy = false;
            showPreview(xml, entries.length);
        });

        // S → save the current selection to history under a name you choose.
        screen.key('S-s', () => {
            if (filtering || modal || busy || typing()) return;
            if (selectionCount(store) === 0) {
                status('Select at least one component before saving.');
                return;
            }
            if (!onSaveSession) {
                status('Saving is unavailable here.');
                return;
            }
            promptInput({
                label: ' Save selection as… — Enter to save · Esc to cancel ',
                hint: '{gray-fg}a name so you can find it later in the s picker (e.g. release-1.4){/gray-fg}',
                cb: (name) => {
                    if (name == null) {
                        status('Save cancelled.');
                        return;
                    }
                    const label = name.trim();
                    onSaveSession({
                        entries: manifestEntries(store),
                        targetOrg: store.targetOrg,
                        testLevel,
                        label,
                    });
                    status(label ? `Saved selection as "${label}"` : 'Saved selection to history');
                },
            });
        });

        function resolveWith(action, tests) {
            cleanup();
            screen.destroy();
            resolve({
                action,
                testLevel,
                targetOrg: store.targetOrg,
                entries: manifestEntries(store),
                tests: tests || [],
            });
        }
        function finish(action) {
            if (filtering || modal || typing()) return;
            if (action !== 'build' && selectionCount(store) === 0) {
                status('Select at least one component first.');
                return;
            }
            if ((action === 'deploy' || action === 'validate') && testLevel === 'RunSpecifiedTests') {
                promptTests((tests) => {
                    if (!tests || tests.length === 0) {
                        status('RunSpecifiedTests needs at least one test class.');
                        return;
                    }
                    resolveWith(action, tests);
                });
                return;
            }
            resolveWith(action, []);
        }
        function doQuit(save = false) {
            cleanup();
            screen.destroy();
            resolve({
                action: 'quit',
                save,
                testLevel,
                targetOrg: store.targetOrg,
                entries: manifestEntries(store),
            });
        }
        // Quit offers a third choice — save & quit — so an abandoned selection can be
        // recovered later via the s picker instead of being lost.
        function confirmQuit() {
            if (modal || filtering) return;
            modal = true;
            const hasSel = selectionCount(store) > 0;
            const box = blessed.box({
                parent: screen,
                top: 'center',
                left: 'center',
                width: '66%',
                height: 7,
                border: 'line',
                tags: true,
                label: ' Quit ',
                padding: { left: 1, right: 1 },
                style: { border: { fg: 'yellow' }, label: { fg: 'yellow' } },
            });
            const saveOpt = hasSel ? '{green-fg}s{/green-fg} save & quit      ' : '';
            box.setContent(
                `\n  Quit ferry?\n\n  ${saveOpt}{red-fg}q{/red-fg}/{red-fg}y{/red-fg} quit (discard)      {cyan-fg}n{/cyan-fg}/{cyan-fg}esc{/cyan-fg} cancel`,
            );
            box.focus();
            const close = (choice) => {
                box.destroy();
                if (choice === 'save') {
                    doQuit(true);
                    return;
                }
                if (choice === 'quit') {
                    doQuit(false);
                    return;
                }
                modal = false;
                focusPane(focusedPane || table);
            };
            box.key('s', () => {
                if (hasSel) close('save');
            });
            box.key(['q', 'y', 'enter'], () => close('quit'));
            box.key(['n', 'escape'], () => close('cancel'));
            screen.render();
        }

        // Small y/n confirmation so q/d/v/b aren't triggered by an accidental keypress.
        function confirmAction(message, onYes) {
            if (modal || filtering) return;
            modal = true;
            const box = blessed.box({
                parent: screen,
                top: 'center',
                left: 'center',
                width: '60%',
                height: 5 + message.split('\n').length, // grow for multi-line messages (e.g. the dep warning)
                border: 'line',
                tags: true,
                label: ' Confirm ',
                padding: { left: 1, right: 1 },
                style: { border: { fg: 'yellow' }, label: { fg: 'yellow' } },
            });
            box.setContent(
                `\n${message}\n\n  {green-fg}y{/green-fg} / {green-fg}enter{/green-fg} = yes      {red-fg}n{/red-fg} / {red-fg}esc{/red-fg} = no`,
            );
            box.focus();
            const close = (yes) => {
                box.destroy();
                modal = false;
                focusPane(focusedPane || table);
                if (yes) onYes();
            };
            box.key(['y', 'enter'], () => close(true));
            box.key(['n', 'escape', 'q'], () => close(false));
            screen.render();
        }
        function confirmThen(message, action) {
            if (filtering || modal || typing()) return;
            if (action !== 'build' && selectionCount(store) === 0) {
                status('Select at least one component first.');
                return;
            }
            if (action !== 'build' && !store.targetOrg) {
                status('Pick a target org first (press t).');
                return;
            }
            confirmAction(message, () => finish(action));
        }
        // ---- dependency check (D) --------------------------------------------
        // Review panel: level-1 dependencies of the selection, grouped by whether
        // the target already has them. Not-in-target rows are pre-checked; enter
        // merges the checked ones into the selection. Suggest-not-bundle.
        function openDepsPanel(rows, caveat) {
            modal = true;
            const keyOf = (r) => `${r.type}:${r.fullName}`;
            const toAdd = new Set(rows.filter((r) => r.status === 'missing').map(keyOf));
            let cur = 0;
            let diffBox = null; // right-side diff pane when the split is open
            let diffMode = 'full';
            let diffToken = 0; // guards against out-of-order fetches while moving
            const box = blessed.box({
                parent: screen,
                top: 'center',
                left: 'center',
                width: '84%',
                height: '82%',
                border: 'line',
                tags: true,
                keys: false,
                mouse: true,
                scrollable: true,
                alwaysScroll: true,
                label: ` Dependencies · checked against ${store.targetOrg} `,
                padding: { left: 1, right: 1 },
                style: { border: { fg: 'cyan' }, label: { fg: 'cyan' } },
                scrollbar: { ch: ' ', style: { bg: 'cyan' } },
            });
            function render() {
                // Group by the reliable axis (existence), not the fuzzy one. "missing"
                // = not in the target yet (the real to-do); everything else is already
                // there, with a soft "source newer" hint on the ones whose source
                // changed after the target's copy.
                const notInCount = rows.filter((r) => r.status === 'missing').length;
                const inCount = rows.length - notInCount;
                const olderCount = rows.filter((r) => r.status === 'older').length;
                const tgt = store.targetOrg;
                const lines = [];
                let cursorLine = 0;

                if (!rows.length) {
                    lines.push(`{green-fg}✓ All dependencies are already in ${tgt}.{/green-fg}`);
                } else {
                    if (notInCount === 0) {
                        lines.push(
                            `{green-fg}✓ Nothing new — every dependency already exists in ${tgt}.{/green-fg}`,
                            '',
                        );
                    }
                    let shownNotIn = false;
                    let shownIn = false;
                    rows.forEach((r, i) => {
                        if (r.status === 'missing' && !shownNotIn) {
                            shownNotIn = true;
                            lines.push(
                                `{red-fg}{bold}Not in ${tgt} yet (${notInCount}) — add these{/bold}{/red-fg}`,
                            );
                        }
                        if (r.status !== 'missing' && !shownIn) {
                            shownIn = true;
                            if (lines.length) lines.push('');
                            lines.push(
                                `{gray-fg}Already in ${tgt} (${inCount})${olderCount ? ` · ${olderCount} with newer source` : ''}{/gray-fg}`,
                            );
                        }
                        if (i === cur) cursorLine = lines.length;
                        const checked = toAdd.has(keyOf(r)) ? '[x]' : '[ ]';
                        const glyph =
                            r.status === 'missing' ? '{red-fg}＋{/red-fg}' : '{green-fg}✓{/green-fg}';
                        const hint = r.status === 'older' ? '  {yellow-fg}↑ source newer{/yellow-fg}' : '';
                        const dateNote = r.targetDate
                            ? `  {gray-fg}· in target ${shortDate(r.targetDate)}{/gray-fg}`
                            : '';
                        const body = `${checked}  ${glyph} ${pad(trunc(r.type, 16), 16)} ${trunc(r.fullName, 30)}  {gray-fg}${r.why}{/gray-fg}${dateNote}${hint}`;
                        lines.push(i === cur ? `{cyan-fg}{bold}❯ ${body}{/bold}{/cyan-fg}` : `  ${body}`);
                    });
                }
                if (caveat) lines.push('', `{gray-fg}${caveat}{/gray-fg}`);
                lines.push(
                    '',
                    ' {cyan-fg}↑↓{/cyan-fg} move  {cyan-fg}space{/cyan-fg} add/skip  {cyan-fg}a{/cyan-fg} add all new  {cyan-fg}>{/cyan-fg} diff  {green-fg}enter{/green-fg} apply  {red-fg}esc{/red-fg} cancel',
                );
                box.setContent(lines.join('\n'));
                // Keep the cursor visible WITHOUT snapping it to the top: only scroll
                // when it would fall outside the current window (natural list feel).
                if (typeof box.scrollTo === 'function') {
                    const h = typeof box.height === 'number' ? box.height : Math.floor(screen.height * 0.82);
                    const vh = Math.max(3, h - 2); // minus top/bottom borders
                    let sc = box.childBase || 0;
                    if (cursorLine < sc) sc = cursorLine;
                    else if (cursorLine >= sc + vh) sc = cursorLine - vh + 1;
                    box.scrollTo(Math.max(0, sc));
                }
                paint();
            }
            // ---- master-detail split (>) : dep list left, live diff right ----
            async function updateSplitDiff() {
                if (!diffBox) return;
                const r = rows[cur];
                const myToken = ++diffToken;
                diffBox.setLabel(r ? ` ${r.fullName} · ${store.sourceOrg} ↔ ${store.targetOrg} ` : ' Diff ');
                diffBox.setContent('{gray-fg}Loading diff …{/gray-fg}');
                diffBox.setScroll(0);
                paint();
                if (!r) return;
                let data;
                try {
                    data = await fetchDiff(r.type, r.fullName);
                } catch (e) {
                    if (myToken === diffToken) {
                        diffBox.setContent(`{red-fg}Diff failed: ${e.message}{/red-fg}`);
                        paint();
                    }
                    return;
                }
                if (myToken !== diffToken || !diffBox) return; // superseded by a newer move / closed
                const innerW =
                    (typeof diffBox.width === 'number' ? diffBox.width : Math.floor(screen.width * 0.5)) - 4;
                diffBox.setLabel(` ${r.fullName}  ${diffSummary(data)} · ${diffMode} (f) `);
                diffBox.setContent(formatDiffBody(data, diffMode, innerW).join('\n'));
                paint();
            }
            function openSplit() {
                box.left = 0;
                box.width = '49%';
                diffBox = blessed.box({
                    parent: screen,
                    top: 'center',
                    left: '50%',
                    width: '50%',
                    height: '82%',
                    border: 'line',
                    tags: true,
                    keys: false,
                    mouse: true,
                    scrollable: true,
                    alwaysScroll: true,
                    label: ' Diff ',
                    padding: { left: 1, right: 1 },
                    style: { border: { fg: DIM }, label: { fg: 'cyan' } },
                    scrollbar: { ch: ' ', style: { bg: 'cyan' } },
                });
                diffBox.key(['down', 'j'], () => {
                    diffBox.scroll(1);
                    paint();
                });
                diffBox.key(['up', 'k'], () => {
                    diffBox.scroll(-1);
                    paint();
                });
                diffBox.key('pagedown', () => {
                    diffBox.scroll(10);
                    paint();
                });
                diffBox.key('pageup', () => {
                    diffBox.scroll(-10);
                    paint();
                });
                diffBox.key(['tab', 'escape'], () => {
                    box.style.border.fg = 'cyan';
                    diffBox.style.border.fg = DIM;
                    box.focus();
                    paint();
                });
                box.style.border.fg = DIM;
                diffBox.style.border.fg = 'cyan';
                screen.render();
                render();
                updateSplitDiff();
                diffBox.focus();
            }
            function closeSplit() {
                if (!diffBox) return;
                diffToken += 1;
                diffBox.destroy();
                diffBox = null;
                box.left = 'center';
                box.width = '84%';
                box.style.border.fg = 'cyan';
                box.focus();
                screen.render();
                render();
            }

            const move = (d) => {
                if (!rows.length) return;
                cur = (((cur + d) % rows.length) + rows.length) % rows.length;
                render();
                if (diffBox) updateSplitDiff();
            };
            const apply = () => {
                let added = 0;
                for (const r of rows) {
                    if (toAdd.has(keyOf(r)) && !isSelected(store, r.type, r.fullName)) {
                        toggleSelect(store, r.type, r.fullName);
                        added += 1;
                    }
                }
                if (diffBox) diffBox.destroy();
                box.destroy();
                modal = false;
                recomputeView();
                refreshMarks(
                    store.activeType,
                    added ? `Added ${added} dependenc${added === 1 ? 'y' : 'ies'}.` : 'No changes.',
                );
                focusPane(table);
            };
            const cancel = () => {
                if (diffBox) diffBox.destroy();
                box.destroy();
                modal = false;
                focusPane(focusedPane || table);
            };
            box.key(['down', 'j'], () => move(1));
            box.key(['up', 'k'], () => move(-1));
            box.key('space', () => {
                const r = rows[cur];
                if (!r) return;
                const k = keyOf(r);
                if (toAdd.has(k)) toAdd.delete(k);
                else toAdd.add(k);
                render();
            });
            box.key('a', () => {
                rows.filter((r) => r.status === 'missing').forEach((r) => toAdd.add(keyOf(r)));
                render();
            });
            // > opens/closes the side-by-side diff for the highlighted row; f toggles
            // its view mode; tab moves focus into the diff to scroll it.
            box.key('>', () => {
                if (!getDiffSources) {
                    return;
                }
                if (diffBox) closeSplit();
                else openSplit();
            });
            box.key('f', () => {
                if (!diffBox) return;
                diffMode = diffMode === 'full' ? 'changes' : 'full';
                updateSplitDiff();
            });
            box.key('tab', () => {
                if (diffBox) {
                    box.style.border.fg = DIM;
                    diffBox.style.border.fg = 'cyan';
                    diffBox.focus();
                    paint();
                }
            });
            box.key(['enter', 'return'], apply);
            box.key(['escape', 'q'], cancel);
            box.focus();
            render();
        }

        screen.key('S-d', async () => {
            if (filtering || modal || busy || typing()) return;
            if (!checkDependencies) {
                status('Dependency check is not available here.');
                return;
            }
            if (selectionCount(store) === 0) {
                status('Select components first, then press D to check their dependencies.');
                return;
            }
            if (!store.targetOrg) {
                status('Pick a target org (t) first — dependencies are checked against it.');
                return;
            }
            busy = true;
            startSpin(`Checking dependencies against ${store.targetOrg} …`);
            let res;
            try {
                res = await checkDependencies(manifestEntries(store));
            } catch (e) {
                stopSpin();
                busy = false;
                status(`Dependency check failed: ${e.message}`);
                return;
            }
            stopSpin();
            busy = false;
            const rows = (res && res.rows) || [];
            depMissing = rows.filter((r) => r.status === 'missing').length;
            renderHeader();
            openDepsPanel(rows, res && res.caveat);
        });

        // ---- diff viewer (>) --------------------------------------------------
        // Fetch both bodies and compute the diff (old = target, new = source).
        async function fetchDiff(type, fullName) {
            const res = await getDiffSources(type, fullName);
            if (!res || !res.supported) return { supported: false };
            const { diffLines } = await import('./diff.js');
            const s = res.sourceBody;
            const t = res.targetBody;
            return {
                supported: true,
                sourceExists: s != null,
                targetExists: t != null,
                diff: diffLines(t || '', s || ''),
            };
        }
        function diffSummary(data) {
            return data && data.diff ? `+${data.diff.added} −${data.diff.removed}` : '';
        }

        // Standalone centered viewer (from the component list).
        function openDiffModal(fullName, data) {
            modal = true;
            let mode = 'full';
            const box = blessed.box({
                parent: screen,
                top: 'center',
                left: 'center',
                width: '88%',
                height: '88%',
                border: 'line',
                tags: true,
                keys: false,
                mouse: true,
                scrollable: true,
                alwaysScroll: true,
                padding: { left: 1, right: 1 },
                style: { border: { fg: 'cyan' }, label: { fg: 'cyan' } },
                scrollbar: { ch: ' ', style: { bg: 'cyan' } },
            });
            function render() {
                const innerW =
                    (typeof box.width === 'number' ? box.width : Math.floor(screen.width * 0.88)) - 4;
                box.setLabel(
                    ` ${fullName} · ${store.sourceOrg} ↔ ${store.targetOrg}  ${diffSummary(data)} · ${mode} (f)  ·  esc `,
                );
                box.setContent(formatDiffBody(data, mode, innerW).join('\n'));
                paint();
            }
            const close = () => {
                box.destroy();
                modal = false;
                focusPane(focusedPane || table);
            };
            box.key('f', () => {
                mode = mode === 'full' ? 'changes' : 'full';
                box.setScroll(0);
                render();
            });
            box.key(['down', 'j'], () => {
                box.scroll(1);
                paint();
            });
            box.key(['up', 'k'], () => {
                box.scroll(-1);
                paint();
            });
            box.key('pagedown', () => {
                box.scroll(viewportHeight());
                paint();
            });
            box.key('pageup', () => {
                box.scroll(-viewportHeight());
                paint();
            });
            box.key('g', () => {
                box.setScroll(0);
                paint();
            });
            box.key('S-g', () => {
                box.setScroll(box.getScrollHeight ? box.getScrollHeight() : 99999);
                paint();
            });
            box.key(['escape', 'q', '>'], close);
            box.focus();
            render();
        }

        async function openDiffFor(type, fullName) {
            if (!getDiffSources) {
                status('Diff isn’t available here.');
                return;
            }
            busy = true;
            startSpin(`Diffing ${fullName} against ${store.targetOrg || '(no target)'} …`);
            let data;
            try {
                data = await fetchDiff(type, fullName);
            } catch (e) {
                stopSpin();
                busy = false;
                status(`Diff failed: ${e.message}`);
                return;
            }
            stopSpin();
            busy = false;
            openDiffModal(fullName, data);
        }

        screen.key('>', () => {
            if (filtering || modal || busy || !table.focused) return;
            if (!store.targetOrg) {
                status('Pick a target org (t) first — diff compares source ↔ target.');
                return;
            }
            const r = view[cursor];
            if (r) openDiffFor(r.type, r.fullName);
        });

        // A prior D check (for the current, unchanged selection) surfaces a soft
        // warning in the deploy/validate confirm — informed, never blocking.
        const depWarn = () =>
            depMissing > 0
                ? `\n{yellow-fg}⚠ ${depMissing} dependenc${depMissing === 1 ? 'y is' : 'ies are'} not in ${store.targetOrg} yet — press D to review{/yellow-fg}`
                : '';
        // Warn if RunRelevantTests is chosen on an API version that can't run it.
        const testWarn = () =>
            relevantTestsUnsupported(testLevel, apiVersion)
                ? `\n{yellow-fg}⚠ RunRelevantTests needs API ${RELEVANT_TESTS_MIN_API}+ (currently ${apiVersion || 'default'}) — set --api-version ${RELEVANT_TESTS_MIN_API}{/yellow-fg}`
                : '';

        const count = () => selectionCount(store);
        screen.key('b', () => confirmThen(`Write package.xml with ${count()} component(s)?`, 'build'));
        screen.key('v', () =>
            confirmThen(
                `Validate ${count()} component(s)  →  ${store.targetOrg || '(no target)'} ?${depWarn()}${testWarn()}`,
                'validate',
            ),
        );
        screen.key('d', () =>
            confirmThen(
                `Deploy ${count()} component(s)  →  ${store.targetOrg || '(no target)'} ?${depWarn()}${testWarn()}`,
                'deploy',
            ),
        );
        screen.key('q', () => {
            if (filtering || modal || typing()) return;
            confirmQuit();
        });
        screen.key('C-c', () => doQuit(false)); // Ctrl+C always quits immediately (hard escape)

        function cyclePane(dir) {
            if (filtering || modal) return;
            const vis = panes.filter((el) => !el.hidden);
            if (vis.length === 0) return;
            const cur = vis.findIndex((el) => el.focused);
            focusPane(vis[((cur < 0 ? 0 : cur) + dir + vis.length) % vis.length]);
        }
        screen.key('tab', () => cyclePane(1));
        screen.key('S-tab', () => cyclePane(-1));

        // Ctrl+B toggles the left (Types) panel, Alt+B the right (Selected) panel.
        screen.key('C-b', () => {
            if (modal) return;
            leftVisible = !leftVisible;
            if (!leftVisible && typesList.focused) focusPane(table);
            relayout();
        });
        screen.key('M-b', () => {
            if (modal) return;
            rightVisible = !rightVisible;
            if (!rightVisible && basket.focused) focusPane(table);
            relayout();
        });

        // Debounce resize: a window drag fires a burst of events; coalesce to one
        // repaint on the trailing edge.
        let resizeTimer = null;
        screen.on('resize', () => {
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                resizeTimer = null;
                renderTable();
                paint();
            }, RESIZE_DEBOUNCE_MS);
            if (resizeTimer.unref) resizeTimer.unref();
        });

        // ---- boot ------------------------------------------------------------
        function revealMain() {
            modal = false;
            renderAll();
            focusPane(typesList);
            if (store.activeType) ensureLoaded(store.activeType);
            screen.render();
        }

        if (prepare) {
            // Splash: the app frame is up immediately; show a branded checklist while
            // the org connection + describe run, then dissolve into the main UI.
            modal = true; // block stray action keys during loading (Ctrl+C still aborts)
            const splash = blessed.box({
                parent: screen,
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                tags: true,
                align: 'center',
                valign: 'middle',
                style: { bg: 'black', fg: 'white' },
            });
            const steps = [];
            let sf = 0;
            const drawSplash = () => {
                const lines = [
                    '{cyan-fg}{bold}⚓  F E R R Y{/bold}{/cyan-fg}',
                    '{gray-fg}Salesforce Metadata Migrator{/gray-fg}',
                    '',
                ];
                for (const s of steps) {
                    const icon =
                        s.state === 'done'
                            ? '{green-fg}✓{/green-fg}'
                            : s.state === 'fail'
                              ? '{red-fg}✗{/red-fg}'
                              : `{cyan-fg}${SPIN_FRAMES[sf]}{/cyan-fg}`;
                    lines.push(`${icon}  ${s.text}`);
                }
                splash.setContent(lines.join('\n'));
                screen.render();
            };
            splashTimer = setInterval(() => {
                sf = (sf + 1) % SPIN_FRAMES.length;
                drawSplash();
            }, SPIN_INTERVAL_MS);
            if (splashTimer.unref) splashTimer.unref();
            const step = {
                begin(msg) {
                    steps.push({ text: msg, state: 'doing' });
                    drawSplash();
                },
                done(msg) {
                    const l = steps[steps.length - 1];
                    if (l) {
                        l.state = 'done';
                        if (msg) l.text = msg;
                    }
                    drawSplash();
                },
            };
            drawSplash();
            (async () => {
                try {
                    const ret = await prepare(step);
                    if (ret) {
                        if (ret.types) setTypes(store, ret.types);
                        if (ret.loadComponents) _load = ret.loadComponents;
                        if (ret.orgs) _orgs = ret.orgs;
                    }
                    if (splashTimer) {
                        clearInterval(splashTimer);
                        splashTimer = null;
                    }
                    splash.destroy();
                    revealMain();
                } catch (e) {
                    if (splashTimer) {
                        clearInterval(splashTimer);
                        splashTimer = null;
                    }
                    const l = steps[steps.length - 1];
                    if (l) {
                        l.state = 'fail';
                        l.text = `{red-fg}${e.message}{/red-fg}`;
                    }
                    steps.push({ text: '{gray-fg}press Ctrl+C to exit{/gray-fg}', state: 'done' });
                    drawSplash();
                }
            })();
        } else {
            revealMain();
        }
        screen.render();
    });
}
