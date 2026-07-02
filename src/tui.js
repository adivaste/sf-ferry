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
import { TEST_LEVELS } from './constants.js';

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
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
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
    if (hit[i] !== runHit) { flush(); runHit = hit[i]; }
    run += text[i];
  }
  flush();
  return out;
}

const SPIN_FRAMES = ['|', '/', '-', '\\']; // ASCII — renders in every terminal/font

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
  '  /                 filter rows (matches name + owner)',
  '  1 2 3 4           sort by column (press again to reverse)',
  '',
  '{bold}{cyan-fg}Layout{/cyan-fg}{/bold}',
  '  Ctrl+B            hide / show the Types panel',
  '  Alt+B             hide / show the Selected panel',
  '',
  '{bold}{cyan-fg}Actions{/cyan-fg}{/bold}',
  '  t                 choose target org',
  '  l                 cycle test level',
  '  s                 load a saved selection (history)',
  '  r                 refresh current type from the org',
  '  b                 write package.xml only',
  '  v / d             validate / deploy (org → org)',
  '  (b / v / d / q ask for y/n confirmation; Ctrl+C force-quits)',
  '  ? / Esc           close this help',
  '  q                 quit',
].join('\n');

/**
 * Launch the interactive selection screen.
 *
 * The component list is a hand-virtualized viewport: the full filtered+sorted
 * array (`view`) is computed ONCE per filter/sort/type change, and only the
 * rows visible in the window are ever formatted/rendered (like fzf / vim).
 * Scrolling is pure array slicing — O(viewport), independent of total size.
 */
export function runTui({ store, loadComponents, orgs = [], prepare = null, onListSessions = null, initialTestLevel = null }) {
  // loadComponents/orgs may be (re)assigned by `prepare` after the splash.
  // eslint-disable-next-line no-param-reassign
  let _load = loadComponents;
  // eslint-disable-next-line no-param-reassign
  let _orgs = orgs;
  return new Promise((resolve) => {
    const screen = blessed.screen({
      smartCSR: true,
      title: 'ferry — metadata migrator',
      terminal: 'xterm-256color', // assume a 256-color terminal so hex / 256-index
      forceUnicode: true, //        colors aren't downsampled to the nearest 16
      fullUnicode: true,
      autoPadding: true,
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
        if (sig === lastSig && now - lastAt < 12) { lastAt = now; return false; }
        lastSig = sig;
        lastAt = now;
      }
      return realEmit(type, ...args);
    };
    const applyDedupe = () => { program.emit = dedupeEmit; };
    const removeDedupe = () => { program.emit = realEmit; };
    applyDedupe();

    let testLevel = initialTestLevel && TEST_LEVELS.includes(initialTestLevel) ? initialTestLevel : 'RunLocalTests';
    let busy = false;
    let filtering = false;
    let modal = false;
    let typeFilter = ''; // type-ahead filter for the Types pane
    let leftVisible = true; // Types pane (Ctrl+B)
    let rightVisible = true; // Selected pane (Alt+B)
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
      parent: screen, top: 0, left: 0, right: 0, height: 3,
      tags: true, valign: 'middle', 
      border: 'line',
      style: { border : { fg: 235 } },
    });
    const typesList = blessed.list({
      parent: screen, label: ' Types ', top: 3, left: 0, width: '25%', bottom: 3,
      border: 'line', keys: true, mouse: true, tags: true,
      style: { selected: { bg: 'cyan', fg: 'black' }, border: { fg: 'cyan' }, label: { fg: 'cyan' } },
      scrollbar: { ch: ' ', style: { bg: 'cyan' } },
    });
    const filterBox = blessed.textbox({
      parent: screen, label: ' Filter (/) ', top: 3, left: '25%', width: '45%', height: 3,
      border: 'line', inputOnFocus: true, style: { border: { fg: 235 }, label: { fg: 'cyan' } },
    });
    const table = blessed.box({
      parent: screen, label: ' Components ', top: 6, left: '25%', width: '45%', bottom: 3,
      border: 'line', tags: true, keys: true, mouse: true, scrollable: false,
      style: { border: { fg: 235 }, label: { fg: 'cyan' } },
    });
    const basket = blessed.box({
      parent: screen, label: ' Selected ', top: 3, left: '70%', right: 0, bottom: 3,
      border: 'line', tags: true, scrollable: true, alwaysScroll: true, mouse: true, keys: true,
      scrollbar: { ch: ' ', style: { bg: 'green' } },
      style: { border: { fg: 235 }, label: { fg: 'green' } },
    });
    const footer = blessed.box({
      parent: screen, bottom: 0, left: 0, width: '100%', height: 3,
      border: 'line', tags: true, style: { border: { fg: 235 } },
    });

    const panes = [typesList, table, basket];
    function focusPane(el) {
      for (const p of panes) p.style.border.fg = 235;
      el.style.border.fg = 'cyan';
      el.focus();
      focusedPane = el;
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
        } catch { /* screen torn down */ }
      }, 90);
      if (spinTimer.unref) spinTimer.unref(); // never keep the process alive
    }
    function stopSpin() {
      if (spinTimer) { clearInterval(spinTimer); spinTimer = null; }
    }

    // Collapse/expand the side panels so the center table can use the space.
    function relayout() {
      const lw = leftVisible ? 25 : 0;
      const rw = rightVisible ? 30 : 0;
      const cw = 100 - lw - rw;
      if (leftVisible) typesList.show(); else typesList.hide();
      if (rightVisible) basket.show(); else basket.hide();
      filterBox.left = `${lw}%`;
      filterBox.width = `${cw}%`;
      table.left = `${lw}%`;
      table.width = `${cw}%`;
      basket.left = `${100 - rw}%`;
      screen.render();
      renderTable(); // recompute column widths for the new center width
      paint();
    }

    // ---- viewport helpers ------------------------------------------------
    function viewportHeight() {
      const h = typeof table.height === 'number' && table.height > 0 ? table.height : screen.height - 9;
      return Math.max(3, h - 2 - 1); // borders + in-table header row
    }
    function colWidths() {
      const inner = Math.max(24, (typeof table.width === 'number' ? table.width : Math.floor(screen.width * 0.45)) - 3);
      const byW = 16;
      const dateW = 10;
      let nameW = inner - 3 /*mark*/ - byW - dateW - dateW - 4 /*gaps*/;
      if (nameW < 8) nameW = 8;
      return { inner, nameW, byW, dateW };
    }
    function recomputeView({ resetCursor = false } = {}) {
      view = hasComponents(store, store.activeType) ? visibleRows(store) : [];
      if (resetCursor) { cursor = 0; top = 0; }
      else if (cursor > view.length - 1) cursor = Math.max(0, view.length - 1);
    }

    // ---- rendering -------------------------------------------------------
    function renderHeader() {
      const tgt = store.targetOrg || '(press t)';
      // labels/divider in white (visible on the grey bar); values in bright colors
      const div = '  {white-fg}|{/white-fg}  ';
      header.setContent(
        ` {bold}⚓ {cyan-fg}FERRY{/cyan-fg}{/bold}` + div +
        `{white-fg}source{/white-fg} {cyan-fg}{bold}${store.sourceOrg}{/bold}{/cyan-fg}  ` +
        `{white-fg}→  target{/white-fg} {yellow-fg}{bold}${tgt}{/bold}{/yellow-fg}` + div +
        `{white-fg}tests{/white-fg} {magenta-fg}{bold}${testLevel}{/bold}{/magenta-fg}` + div +
        `{green-fg}{bold}✓ ${selectionCount(store)}{/bold} selected{/green-fg}`,
      );
    }
    function filteredTypes() {
      const t = typeFilter.trim().toLowerCase();
      if (!t) return store.types;
      const toks = t.split(/\s+/);
      return store.types.filter((x) => {
        const n = x.name.toLowerCase();
        return toks.every((tok) => n.includes(tok));
      });
    }
    function renderTypes() {
      const arr = filteredTypes();
      typesList.setItems(arr.map((t) => {
        const sel = selectedCountForType(store, t.name);
        return `${t.name}${sel ? ` {green-fg}(${sel})✓{/green-fg}` : ''}`;
      }));
      const idx = arr.findIndex((t) => t.name === store.activeType);
      typesList.select(idx >= 0 ? idx : 0);
      typesList.setLabel(typeFilter ? ` Types  /${typeFilter} ` : ` Types (${store.types.length}) `);
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
          if (gi === cursor) {
            const padN = Math.max(0, inner - plainRaw.length);
            lines.push(`{cyan-bg}{black-fg}${renderedRaw}${' '.repeat(padN)}{/black-fg}{/cyan-bg}`);
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
    function renderBasket() {
      const groups = selectionGrouped(store);
      if (groups.length === 0) {
        basket.setContent('{gray-fg}Nothing selected yet.\nHighlight a row and press space.{/gray-fg}');
        return;
      }
      const lines = [];
      for (const g of groups) {
        lines.push(`{bold}{green-fg}${g.type}{/green-fg}{/bold} (${g.items.length})`);
        for (const item of g.items) lines.push(`  • ${esc(item)}`);
        lines.push('');
      }
      basket.setContent(lines.join('\n'));
    }
    function renderFooter() {
      // Context-aware: show the keys relevant to the focused pane.
      let line1;
      if (typesList.focused) {
        line1 = ' {cyan-fg}type{/cyan-fg} find type  {cyan-fg}↑↓{/cyan-fg} move  {cyan-fg}enter{/cyan-fg} open  {cyan-fg}Ctrl+B{/cyan-fg} hide panel';
      } else if (basket.focused) {
        line1 = ' {cyan-fg}↑↓{/cyan-fg} scroll  {cyan-fg}tab{/cyan-fg} pane  {cyan-fg}Alt+B{/cyan-fg} hide panel';
      } else {
        line1 = ' {cyan-fg}↑↓/jk{/cyan-fg} move  {cyan-fg}space{/cyan-fg} check  {cyan-fg}a{/cyan-fg} all  {cyan-fg}c{/cyan-fg} clear  {cyan-fg}/{/cyan-fg} filter  {cyan-fg}1-4{/cyan-fg} sort  {cyan-fg}t{/cyan-fg} target  {cyan-fg}l{/cyan-fg} test-level  {cyan-fg}s{/cyan-fg} sessions';
      }
      footer.setContent(
        `${line1}\n` +
        ' {green-fg}b{/green-fg} build   {green-fg}v{/green-fg} validate   {green-fg}d{/green-fg} deploy   {cyan-fg}tab{/cyan-fg} pane   {cyan-fg}?{/cyan-fg} help   {red-fg}q{/red-fg} quit',
      );
    }
    function renderAll() {
      renderHeader(); renderTypes(); renderTable(); renderBasket(); renderFooter(); paint();
    }
    function status(msg) {
      footer.setContent(` {yellow-fg}${msg}{/yellow-fg}`);
      paint();
    }

    // ---- data loading ----------------------------------------------------
    async function ensureLoaded(type, { refresh = false } = {}) {
      if (hasComponents(store, type) && !refresh) { recomputeView({ resetCursor: true }); renderTable(); paint(); return; }
      busy = true;
      startSpin(`Loading ${type} from ${store.sourceOrg} …`);
      try {
        await _load(type, { refresh });
      } catch (e) {
        stopSpin();
        status(`Error loading ${type}: ${e.message}`);
        busy = false;
        return;
      }
      stopSpin();
      busy = false;
      recomputeView({ resetCursor: true });
      renderHeader(); renderTypes(); renderTable(); renderFooter(); paint();
    }

    // ---- navigation (virtualized) ---------------------------------------
    function move(delta) {
      if (view.length === 0) return;
      cursor = Math.min(view.length - 1, Math.max(0, cursor + delta));
      renderTable(); paint();
    }
    table.key(['down', 'j'], () => move(1));
    table.key(['up', 'k'], () => move(-1));
    table.key('pagedown', () => move(viewportHeight()));
    table.key('pageup', () => move(-viewportHeight()));
    table.key(['home', 'g'], () => { cursor = 0; renderTable(); paint(); });
    table.key(['end', 'G'], () => { cursor = view.length - 1; renderTable(); paint(); });
    table.on('wheeldown', () => move(3));
    table.on('wheelup', () => move(-3));
    table.on('click', (data) => {
      const rel = data.y - table.atop - 2; // border + header row
      const gi = top + rel;
      if (gi >= 0 && gi < view.length) { cursor = gi; renderTable(); paint(); }
    });

    typesList.on('select', async (_item, index) => {
      const t = filteredTypes()[index];
      if (!t) return;
      setActiveType(store, t.name);
      filterBox.clearValue();
      renderHeader(); renderTypes(); paint();
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
        if (typeFilter) { typeFilter = typeFilter.slice(0, -1); renderTypes(); paint(); }
        return;
      }
      if (name === 'escape') {
        if (typeFilter) { typeFilter = ''; renderTypes(); paint(); }
        return;
      }
      const printable = ch && ch.length === 1 && !key.ctrl && !key.meta
        && ch >= ' ' && ch !== ' ' && ch !== '/' && ch !== '?';
      if (printable) {
        typeFilter += ch;
        renderTypes();
        paint();
      }
    });

    function refreshMarks() {
      renderTable(); renderBasket(); renderHeader(); renderTypes(); paint();
    }

    screen.key('space', () => {
      if (filtering || modal || busy || !table.focused) return;
      const r = view[cursor];
      if (!r) return;
      toggleSelect(store, r.type, r.fullName);
      refreshMarks(); // view membership unchanged → cursor stays put
    });
    // Letter/digit shortcuts are disabled while the Types pane is focused —
    // there, typing feeds the type-ahead filter instead.
    const typing = () => typesList.focused;

    screen.key('a', () => { if (filtering || modal || typing()) return; selectAllVisible(store); refreshMarks(); });
    screen.key('c', () => { if (filtering || modal || typing()) return; clearVisible(store); refreshMarks(); });

    for (let n = 1; n <= COLUMNS.length; n += 1) {
      screen.key(String(n), () => {
        if (filtering || modal || typing()) return;
        setSort(store, COLUMNS[n - 1].key);
        recomputeView();
        renderTable(); paint();
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
        renderTable(); paint();
      }, 110);
    });
    function endFilter(focusTable = true) {
      if (filterTimer) { clearTimeout(filterTimer); filterTimer = null; }
      filtering = false;
      filterBox.style.border.fg = 'gray';
      setFilter(store, filterBox.value || '');
      recomputeView({ resetCursor: true });
      renderTable();
      if (focusTable) focusPane(table);
      else paint();
    }
    filterBox.on('submit', () => endFilter(true));
    filterBox.key('escape', () => { filterBox.cancel(); });
    filterBox.on('cancel', () => { filterBox.clearValue(); endFilter(true); });

    screen.key('r', async () => {
      if (filtering || modal || busy || typing()) return;
      await ensureLoaded(store.activeType, { refresh: true });
      focusPane(table);
    });
    screen.key('l', () => {
      if (filtering || modal || typing()) return;
      testLevel = TEST_LEVELS[(TEST_LEVELS.indexOf(testLevel) + 1) % TEST_LEVELS.length];
      renderHeader(); renderFooter(); paint();
    });
    // Centered modal list with WRAPPING navigation (↑↓/jk cycle around the ends).
    // We manage keys ourselves (keys:false) so wrap-around works — blessed's
    // built-in list nav clamps at the ends.
    function openPicker({ label, items, onChoose }) {
      const n = items.length; // capture BEFORE blessed — its list mutates the array you pass in
      if (!n) return;
      modal = true;
      const picker = blessed.list({
        parent: screen, label, top: 'center', left: 'center', width: '66%', height: '60%',
        border: 'line', keys: false, mouse: true, tags: true, items: items.slice(), // blessed gets its own copy
        style: { selected: { bg: 'cyan', fg: 'black' }, border: { fg: 'cyan' }, label: { fg: 'cyan' } },
        scrollbar: { ch: ' ', style: { bg: 'cyan' } },
      });
      const close = () => { modal = false; picker.destroy(); renderFooter(); focusPane(table); };
      const move = (d) => { picker.select((((picker.selected || 0) + d) % n + n) % n); screen.render(); };
      picker.key(['down', 'j'], () => move(1));
      picker.key(['up', 'k'], () => move(-1));
      picker.key(['home', 'g'], () => { picker.select(0); screen.render(); });
      picker.key(['end', 'G'], () => { picker.select(n - 1); screen.render(); });
      picker.key(['enter', 'return', 'space'], () => { const i = picker.selected || 0; close(); onChoose(i); });
      picker.on('select', (_i, idx) => { close(); onChoose(idx); }); // mouse click
      picker.key(['escape', 'q'], close);
      picker.focus();
      screen.render();
    }

    screen.key('t', () => {
      if (filtering || modal || typing()) return;
      if (_orgs.length === 0) { status('No other orgs found (pass --target).'); return; }
      openPicker({
        label: ' Pick target org  (↑↓ wraps · esc cancels) ',
        items: _orgs.map((o) => o.label),
        onChoose: (i) => { if (_orgs[i]) { store.targetOrg = _orgs[i].value; renderHeader(); paint(); } },
      });
    });

    // s → load a past selection from history (we never auto-restore).
    screen.key('s', () => {
      if (filtering || modal || typing()) return;
      const sessions = onListSessions ? onListSessions() : [];
      if (!sessions.length) { status('No saved sessions yet — they\'re checkpointed when you act or quit.'); return; }
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
          renderTable(); renderBasket(); renderHeader(); renderTypes(); paint();
        },
      });
    });

    function cleanup() {
      stopSpin();
      if (splashTimer) { clearInterval(splashTimer); splashTimer = null; }
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
        parent: screen, top: 'center', left: 'center', width: '62%', height: '80%',
        border: 'line', tags: true, scrollable: true, alwaysScroll: true, keys: true, mouse: true,
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
    screen.key('?', () => { if (filtering || modal) return; toggleHelp(); });

    // In-TUI prompt for RunSpecifiedTests so we never hand stdin off to another
    // prompt after blessed (which leaves the terminal in raw mode → no input).
    function promptTests(cb) {
      modal = true;
      removeDedupe(); // let paste/burst input through unfiltered
      const box = blessed.box({
        parent: screen, top: 'center', left: 'center', width: '70%', height: 8,
        border: 'line', tags: true,
        label: ' Test classes — comma-separated · Enter to run · Esc to cancel ',
        style: { border: { fg: 'cyan' }, label: { fg: 'cyan' } },
      });
      blessed.box({
        parent: box, bottom: 1, left: 1, right: 1, height: 2, tags: true,
        content: '{gray-fg}e.g.  MyController_Test, AccountServiceTest{/gray-fg}',
      });
      const tb = blessed.textbox({
        parent: box, top: 1, left: 1, right: 1, height: 1, inputOnFocus: true,
        style: { fg: 'white', focus: { bg: 'black' } },
      });
      const close = (val) => {
        box.destroy();
        applyDedupe();
        modal = false;
        focusPane(table);
        cb(val == null ? null : val.split(',').map((s) => s.trim()).filter(Boolean));
      };
      tb.on('submit', (v) => close(v));
      tb.key('escape', () => tb.cancel());
      tb.on('cancel', () => close(null));
      tb.focus();
      tb.readInput();
      screen.render();
    }

    function resolveWith(action, tests) {
      cleanup();
      screen.destroy();
      resolve({ action, testLevel, targetOrg: store.targetOrg, entries: manifestEntries(store), tests: tests || [] });
    }
    function finish(action) {
      if (filtering || modal || typing()) return;
      if (action !== 'build' && selectionCount(store) === 0) { status('Select at least one component first.'); return; }
      if ((action === 'deploy' || action === 'validate') && testLevel === 'RunSpecifiedTests') {
        promptTests((tests) => {
          if (!tests || tests.length === 0) { status('RunSpecifiedTests needs at least one test class.'); return; }
          resolveWith(action, tests);
        });
        return;
      }
      resolveWith(action, []);
    }
    function doQuit() {
      cleanup();
      screen.destroy();
      resolve({ action: 'quit', testLevel, targetOrg: store.targetOrg, entries: manifestEntries(store) });
    }

    // Small y/n confirmation so q/d/v/b aren't triggered by an accidental keypress.
    function confirmAction(message, onYes) {
      if (modal || filtering) return;
      modal = true;
      const box = blessed.box({
        parent: screen, top: 'center', left: 'center', width: '60%', height: 6,
        border: 'line', tags: true, label: ' Confirm ', padding: { left: 1, right: 1 },
        style: { border: { fg: 'yellow' }, label: { fg: 'yellow' } },
      });
      box.setContent(`\n${message}\n\n  {green-fg}y{/green-fg} / {green-fg}enter{/green-fg} = yes      {red-fg}n{/red-fg} / {red-fg}esc{/red-fg} = no`);
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
      if (action !== 'build' && selectionCount(store) === 0) { status('Select at least one component first.'); return; }
      if (action !== 'build' && !store.targetOrg) { status('Pick a target org first (press t).'); return; }
      confirmAction(message, () => finish(action));
    }
    const count = () => selectionCount(store);
    screen.key('b', () => confirmThen(`Write package.xml with ${count()} component(s)?`, 'build'));
    screen.key('v', () => confirmThen(`Validate ${count()} component(s)  →  ${store.targetOrg || '(no target)'} ?`, 'validate'));
    screen.key('d', () => confirmThen(`Deploy ${count()} component(s)  →  ${store.targetOrg || '(no target)'} ?`, 'deploy'));
    screen.key('q', () => { if (filtering || modal || typing()) return; confirmAction('Quit ferry?  Your selection will be lost.', doQuit); });
    screen.key('C-c', () => doQuit()); // Ctrl+C always quits immediately (hard escape)

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

    screen.on('resize', () => { renderTable(); paint(); });

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
        parent: screen, top: 0, left: 0, width: '100%', height: '100%',
        tags: true, align: 'center', valign: 'middle',
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
          const icon = s.state === 'done' ? '{green-fg}✓{/green-fg}'
            : s.state === 'fail' ? '{red-fg}✗{/red-fg}'
              : `{cyan-fg}${SPIN_FRAMES[sf]}{/cyan-fg}`;
          lines.push(`${icon}  ${s.text}`);
        }
        splash.setContent(lines.join('\n'));
        screen.render();
      };
      splashTimer = setInterval(() => { sf = (sf + 1) % SPIN_FRAMES.length; drawSplash(); }, 90);
      if (splashTimer.unref) splashTimer.unref();
      const step = {
        begin(msg) { steps.push({ text: msg, state: 'doing' }); drawSplash(); },
        done(msg) { const l = steps[steps.length - 1]; if (l) { l.state = 'done'; if (msg) l.text = msg; } drawSplash(); },
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
          if (splashTimer) { clearInterval(splashTimer); splashTimer = null; }
          splash.destroy();
          revealMain();
        } catch (e) {
          if (splashTimer) { clearInterval(splashTimer); splashTimer = null; }
          const l = steps[steps.length - 1];
          if (l) { l.state = 'fail'; l.text = `{red-fg}${e.message}{/red-fg}`; }
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
