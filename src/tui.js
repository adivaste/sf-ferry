import blessed from 'blessed';
import {
  COLUMNS,
  visibleRows,
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
// Escape literal braces so component names can't break blessed tag parsing.
const esc = (s) => s.replace(/\{/g, '{open}').replace(/\}/g, '{close}');

/**
 * Launch the interactive selection screen.
 *
 * The component list is a hand-virtualized viewport: the full filtered+sorted
 * array (`view`) is computed ONCE per filter/sort/type change, and only the
 * rows visible in the window are ever formatted/rendered (like fzf / vim).
 * Scrolling is pure array slicing — O(viewport), independent of total size.
 */
export function runTui({ store, loadComponents, orgs = [] }) {
  return new Promise((resolve) => {
    const screen = blessed.screen({
      smartCSR: true,
      title: 'sfm — metadata selector',
      fullUnicode: true,
      autoPadding: true,
    });

    // de-duplicate doubled keypresses (Node-on-Windows stdin quirk)
    const program = screen.program;
    let lastSig = '';
    let lastAt = 0;
    const realEmit = program.emit.bind(program);
    program.emit = (type, ...args) => {
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

    let testLevel = 'RunLocalTests';
    let busy = false;
    let filtering = false;
    let modal = false;
    let typeFilter = ''; // type-ahead filter for the Types pane

    // virtualized list state
    let view = []; // cached filtered + sorted rows for the active type
    let cursor = 0; // index into `view`
    let top = 0; // first visible index

    // ---- layout ----------------------------------------------------------
    const header = blessed.box({
      parent: screen, top: 0, left: 0, height: 1, width: '100%',
      tags: true, style: { fg: 'white', bg: 'blue' },
    });
    const typesList = blessed.list({
      parent: screen, label: ' Types ', top: 1, left: 0, width: '25%', bottom: 3,
      border: 'line', keys: true, mouse: true, tags: true,
      style: { selected: { bg: 'cyan', fg: 'black' }, border: { fg: 'cyan' }, label: { fg: 'cyan' } },
      scrollbar: { ch: ' ', style: { bg: 'cyan' } },
    });
    const filterBox = blessed.textbox({
      parent: screen, label: ' Filter (/) ', top: 1, left: '25%', width: '45%', height: 3,
      border: 'line', inputOnFocus: true, style: { border: { fg: 'gray' }, label: { fg: 'cyan' } },
    });
    const table = blessed.box({
      parent: screen, label: ' Components ', top: 4, left: '25%', width: '45%', bottom: 3,
      border: 'line', tags: true, keys: true, mouse: true, scrollable: false,
      style: { border: { fg: 'gray' }, label: { fg: 'cyan' } },
    });
    const basket = blessed.box({
      parent: screen, label: ' Selected ', top: 1, left: '70%', right: 0, bottom: 3,
      border: 'line', tags: true, scrollable: true, alwaysScroll: true, mouse: true, keys: true,
      scrollbar: { ch: ' ', style: { bg: 'green' } },
      style: { border: { fg: 'gray' }, label: { fg: 'green' } },
    });
    const footer = blessed.box({
      parent: screen, bottom: 0, left: 0, width: '100%', height: 3,
      border: 'line', tags: true, style: { border: { fg: 'gray' } },
    });

    const panes = [typesList, table, basket];
    function focusPane(el) {
      for (const p of panes) p.style.border.fg = 'gray';
      el.style.border.fg = 'cyan';
      el.focus();
      screen.render();
    }
    const paint = () => screen.render();

    // ---- viewport helpers ------------------------------------------------
    function viewportHeight() {
      const h = typeof table.height === 'number' && table.height > 0 ? table.height : screen.height - 7;
      return Math.max(3, h - 2 - 1); // borders + header row
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
      const tgt = store.targetOrg || '(press t to pick)';
      header.setContent(
        ` {bold}sfm{/bold}  source: {yellow-fg}${store.sourceOrg}{/yellow-fg}  →  target: {yellow-fg}${tgt}{/yellow-fg}` +
        `   test-level: {green-fg}${testLevel}{/green-fg}   selected: {green-fg}${selectionCount(store)}{/green-fg}`,
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
        const slice = view.slice(top, top + vh);
        for (let i = 0; i < slice.length; i += 1) {
          const r = slice[i];
          const gi = top + i;
          const sel = isSelected(store, r.type, r.fullName);
          const raw = `${sel ? '[x]' : '[ ]'} ${pad(trunc(r.fullName, nameW), nameW)} ${pad(trunc(r.lastModifiedByName, byW), byW)} ${pad(shortDate(r.lastModifiedDate), dateW)} ${pad(shortDate(r.createdDate), dateW)}`;
          if (gi === cursor) lines.push(`{cyan-bg}{black-fg}${esc(pad(raw, inner))}{/black-fg}{/cyan-bg}`);
          else if (sel) lines.push(`{green-fg}${esc(raw)}{/green-fg}`);
          else lines.push(esc(raw));
        }
      }
      table.setContent(lines.join('\n'));
      table.setLabel(` Components ${total ? cursor + 1 : 0}/${total} `);
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
      footer.setContent(
        ' {cyan-fg}↑↓/jk{/cyan-fg} move  {cyan-fg}type{/cyan-fg} find type  {cyan-fg}enter{/cyan-fg} open  {cyan-fg}space{/cyan-fg} check  {cyan-fg}a{/cyan-fg} all  {cyan-fg}c{/cyan-fg} clear  {cyan-fg}/{/cyan-fg} filter rows  {cyan-fg}1-4{/cyan-fg} sort  {cyan-fg}tab{/cyan-fg} pane  {cyan-fg}r{/cyan-fg} refresh  {cyan-fg}t{/cyan-fg} target  {cyan-fg}l{/cyan-fg} test-level\n' +
        ' {green-fg}b{/green-fg} build package.xml   {green-fg}v{/green-fg} validate   {green-fg}d{/green-fg} deploy   {red-fg}q{/red-fg} quit',
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
      status(`Loading ${type} from ${store.sourceOrg} …`);
      try {
        await loadComponents(type, { refresh });
      } catch (e) {
        status(`Error loading ${type}: ${e.message}`);
        busy = false;
        return;
      }
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
        && ch >= ' ' && ch !== ' ' && ch !== '/';
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
    screen.key('t', () => {
      if (filtering || modal || typing()) return;
      if (orgs.length === 0) { status('No other orgs found (pass --target).'); return; }
      modal = true;
      const picker = blessed.list({
        parent: screen, label: ' Pick target org (esc to cancel) ', top: 'center', left: 'center',
        width: '60%', height: '60%', border: 'line', keys: true, mouse: true,
        items: orgs.map((o) => o.label),
        style: { selected: { bg: 'cyan', fg: 'black' }, border: { fg: 'cyan' }, label: { fg: 'cyan' } },
        scrollbar: { ch: ' ', style: { bg: 'cyan' } },
      });
      picker.focus();
      screen.render();
      const close = () => { modal = false; picker.destroy(); renderFooter(); focusPane(table); };
      picker.on('select', (_i, idx) => { store.targetOrg = orgs[idx].value; renderHeader(); close(); });
      picker.key('escape', close);
      picker.key('q', close);
    });

    function cleanup() { program.emit = realEmit; }
    function finish(action) {
      if (filtering || modal || typing()) return;
      if (action !== 'build' && selectionCount(store) === 0) { status('Select at least one component first.'); return; }
      cleanup();
      screen.destroy();
      resolve({ action, testLevel, targetOrg: store.targetOrg, entries: manifestEntries(store) });
    }
    function doQuit() { cleanup(); screen.destroy(); resolve({ action: 'quit' }); }
    screen.key('b', () => finish('build'));
    screen.key('v', () => finish('validate'));
    screen.key('d', () => finish('deploy'));
    screen.key('q', () => { if (filtering || modal || typing()) return; doQuit(); });
    screen.key('C-c', () => doQuit()); // Ctrl+C always quits, even while typing

    function cyclePane(dir) {
      if (filtering || modal) return;
      const cur = panes.findIndex((el) => el.focused);
      focusPane(panes[((cur < 0 ? 0 : cur) + dir + panes.length) % panes.length]);
    }
    screen.key('tab', () => cyclePane(1));
    screen.key('S-tab', () => cyclePane(-1));

    screen.on('resize', () => { renderTable(); paint(); });

    // ---- boot ------------------------------------------------------------
    renderAll();
    focusPane(typesList);
    if (store.activeType) ensureLoaded(store.activeType);
    screen.render();
  });
}
