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

const trunc = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');
const shortDate = (d) => (d ? String(d).slice(0, 10) : '');

/**
 * Launch the interactive selection screen.
 *
 * @param store          state store (seeded with types)
 * @param loadComponents async (type, {refresh}) => void  — fetch + cache live components
 * @param orgs           [{label, value}] candidate target orgs
 * Resolves with { action, testLevel, targetOrg, entries }.
 */
export function runTui({ store, loadComponents, orgs = [] }) {
  return new Promise((resolve) => {
    const screen = blessed.screen({
      smartCSR: true,
      title: 'sfm — metadata selector',
      fullUnicode: true,
      autoPadding: true,
    });

    // --- de-duplicate doubled keypresses (Node-on-Windows stdin quirk) -----
    // The spurious duplicate arrives within ~1ms; OS key auto-repeat is ~30ms+
    // apart, so a 12ms guard drops only the bogus repeat.
    const program = screen.program;
    let lastSig = '';
    let lastAt = 0;
    const realEmit = program.emit.bind(program);
    program.emit = (type, ...args) => {
      if (type === 'keypress') {
        const key = args[1];
        const sig = `${key ? key.full || key.name : ''}|${args[0] || ''}`;
        const now = Date.now();
        if (sig === lastSig && now - lastAt < 12) {
          lastAt = now;
          return false;
        }
        lastSig = sig;
        lastAt = now;
      }
      return realEmit(type, ...args);
    };

    let testLevel = 'RunLocalTests';
    let busy = false;
    let filtering = false; // filter textbox has focus
    let modal = false; // org picker open

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

    const table = blessed.listtable({
      parent: screen, label: ' Components ', top: 4, left: '25%', width: '45%', bottom: 3,
      border: 'line', keys: true, mouse: true, align: 'left', tags: true, noCellBorders: true,
      style: {
        header: { fg: 'yellow', bold: true },
        cell: { selected: { bg: 'cyan', fg: 'black' } },
        border: { fg: 'gray' }, label: { fg: 'cyan' },
      },
      scrollbar: { ch: ' ', style: { bg: 'cyan' } },
    });

    const basket = blessed.box({
      parent: screen, label: ' Selected ', top: 1, left: '70%', right: 0, bottom: 3,
      border: 'line', tags: true, scrollable: true, alwaysScroll: true, mouse: true,
      keys: true, scrollbar: { ch: ' ', style: { bg: 'green' } },
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

    // ---- rendering -------------------------------------------------------
    function renderHeader() {
      const tgt = store.targetOrg || '(press t to pick)';
      header.setContent(
        ` {bold}sfm{/bold}  source: {yellow-fg}${store.sourceOrg}{/yellow-fg}  →  target: {yellow-fg}${tgt}{/yellow-fg}` +
        `   test-level: {green-fg}${testLevel}{/green-fg}   selected: {green-fg}${selectionCount(store)}{/green-fg}`,
      );
    }

    function renderTypes() {
      const items = store.types.map((t) => {
        const sel = selectedCountForType(store, t.name);
        const tag = sel ? ` {green-fg}(${sel})✓{/green-fg}` : '';
        return `${t.name}${tag}`;
      });
      typesList.setItems(items);
      const idx = store.types.findIndex((t) => t.name === store.activeType);
      if (idx >= 0) typesList.select(idx);
    }

    function sortHead(key, label) {
      if (store.sortKey !== key) return label;
      return `${label} ${store.sortDir === 1 ? '▲' : '▼'}`;
    }

    // Only ever hand blessed a bounded window of rows — rebuilding a
    // multi-thousand-row listtable on every keystroke is what caused the lag.
    const MAX_ROWS = 200;

    function renderTable({ keepSelected = false } = {}) {
      const prevSel = keepSelected ? table.selected : null;
      const head = [
        `   ${sortHead('fullName', 'Name')}`,
        sortHead('lastModifiedByName', 'Last Modified By'),
        sortHead('lastModifiedDate', 'Last Modified'),
        sortHead('createdDate', 'Created'),
      ];
      if (!hasComponents(store, store.activeType)) {
        table.setData([head, ['  loading…', '', '', '']]);
        return;
      }
      const all = visibleRows(store);
      const rows = all.slice(0, MAX_ROWS);
      const data = [head];
      for (const r of rows) {
        const mark = isSelected(store, r.type, r.fullName) ? '{green-fg}[x]{/green-fg}' : '[ ]';
        data.push([
          `${mark} ${trunc(r.fullName, 34)}`,
          trunc(r.lastModifiedByName, 18),
          shortDate(r.lastModifiedDate),
          shortDate(r.createdDate),
        ]);
      }
      if (all.length === 0) data.push(['  (no matches)', '', '', '']);
      else if (all.length > MAX_ROWS) {
        data.push([`  … ${all.length - MAX_ROWS} more — type to filter`, '', '', '']);
      }
      table.setData(data);
      // setData resets the cursor to the header; restore it (or clamp to a row).
      if (keepSelected && prevSel != null) {
        table.select(Math.min(Math.max(prevSel, 1), data.length - 1));
      } else if (rows.length && table.selected < 1) {
        table.select(1);
      }
    }

    function renderBasket() {
      const groups = selectionGrouped(store);
      if (groups.length === 0) {
        basket.setContent('{gray-fg}Nothing selected yet.\nHighlight a row and press space.{/gray-fg}');
      } else {
        const lines = [];
        for (const g of groups) {
          lines.push(`{bold}{green-fg}${g.type}{/green-fg}{/bold} (${g.items.length})`);
          for (const item of g.items) lines.push(`  • ${item}`);
          lines.push('');
        }
        basket.setContent(lines.join('\n'));
      }
    }

    function renderFooter() {
      footer.setContent(
        ' {cyan-fg}↑↓{/cyan-fg} move  {cyan-fg}enter{/cyan-fg} open type  {cyan-fg}space{/cyan-fg} check  {cyan-fg}a{/cyan-fg} all  {cyan-fg}c{/cyan-fg} clear  {cyan-fg}/{/cyan-fg} filter  {cyan-fg}1-4{/cyan-fg} sort  {cyan-fg}tab/⇧tab{/cyan-fg} pane  {cyan-fg}r{/cyan-fg} refresh  {cyan-fg}t{/cyan-fg} target  {cyan-fg}l{/cyan-fg} test-level\n' +
        ' {green-fg}b{/green-fg} build package.xml   {green-fg}v{/green-fg} validate   {green-fg}d{/green-fg} deploy   {red-fg}q{/red-fg} quit',
      );
    }

    // Single paint per user action — render functions above only set content.
    const paint = () => screen.render();

    function renderAll() {
      renderHeader(); renderTypes(); renderTable(); renderBasket(); renderFooter(); paint();
    }

    // Update everything that changes when a selection toggles, keeping the
    // table cursor exactly where it was, and paint once.
    function refreshSelection() {
      renderTable({ keepSelected: true });
      renderBasket(); renderHeader(); renderTypes();
      paint();
    }

    function status(msg) {
      footer.setContent(` {yellow-fg}${msg}{/yellow-fg}`);
      paint();
    }

    // ---- data loading ----------------------------------------------------
    async function ensureLoaded(type, { refresh = false } = {}) {
      if (hasComponents(store, type) && !refresh) return;
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
      renderHeader(); renderTypes(); renderTable(); renderFooter(); paint();
    }

    // ---- interactions ----------------------------------------------------
    typesList.on('select', async (_item, index) => {
      const t = store.types[index];
      if (!t) return;
      setActiveType(store, t.name);
      filterBox.clearValue();
      renderAll();
      await ensureLoaded(t.name);
      table.select(1);
      focusPane(table);
    });

    function activeRow() {
      const rows = visibleRows(store);
      const i = table.selected - 1; // header occupies row 0
      return i >= 0 && i < rows.length ? rows[i] : null;
    }

    // keep the highlight off the header after the table's own key handling
    table.on('keypress', () => {
      setImmediate(() => {
        try {
          if (screen.destroyed) return;
          if (table.selected < 1) { table.select(1); screen.render(); }
        } catch { /* screen torn down mid-key */ }
      });
    });

    screen.key('space', () => {
      if (filtering || modal || busy) return;
      const r = activeRow();
      if (!r) return;
      toggleSelect(store, r.type, r.fullName);
      refreshSelection(); // keeps the cursor where it is
    });

    screen.key('a', () => { if (filtering || modal) return; selectAllVisible(store); refreshSelection(); });
    screen.key('c', () => { if (filtering || modal) return; clearVisible(store); refreshSelection(); });

    for (let n = 1; n <= COLUMNS.length; n += 1) {
      screen.key(String(n), () => { if (filtering || modal) return; setSort(store, COLUMNS[n - 1].key); renderTable(); paint(); });
    }

    // ---- live filter -----------------------------------------------------
    screen.key('/', () => {
      if (modal) return;
      filtering = true;
      filterBox.style.border.fg = 'cyan';
      filterBox.focus();
      screen.render();
    });
    let filterTimer = null;
    filterBox.on('keypress', () => {
      // Debounce: rebuild the table at most ~every 110ms while typing, not per char.
      if (filterTimer) clearTimeout(filterTimer);
      filterTimer = setTimeout(() => {
        filterTimer = null;
        setFilter(store, filterBox.value || '');
        renderTable();
        paint();
      }, 110);
    });
    function endFilter(focusTable = true) {
      if (filterTimer) { clearTimeout(filterTimer); filterTimer = null; }
      filtering = false;
      filterBox.style.border.fg = 'gray';
      setFilter(store, filterBox.value || '');
      renderTable();
      if (focusTable) { table.select(1); focusPane(table); }
      else paint();
    }
    filterBox.on('submit', () => endFilter(true));
    filterBox.key('escape', () => { filterBox.cancel(); });
    filterBox.on('cancel', () => { filterBox.clearValue(); endFilter(true); });

    screen.key('r', async () => {
      if (filtering || modal || busy) return;
      await ensureLoaded(store.activeType, { refresh: true });
      focusPane(table);
    });

    screen.key('l', () => {
      if (filtering || modal) return;
      const i = TEST_LEVELS.indexOf(testLevel);
      testLevel = TEST_LEVELS[(i + 1) % TEST_LEVELS.length];
      renderHeader(); renderFooter(); paint();
    });

    screen.key('t', () => {
      if (filtering || modal) return;
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

    function finish(action) {
      if (filtering || modal) return;
      if (action !== 'build' && selectionCount(store) === 0) {
        status('Select at least one component first.');
        return;
      }
      cleanup();
      screen.destroy();
      resolve({ action, testLevel, targetOrg: store.targetOrg, entries: manifestEntries(store) });
    }

    screen.key('b', () => { if (filtering || modal) return; finish('build'); });
    screen.key('v', () => { if (filtering || modal) return; finish('validate'); });
    screen.key('d', () => { if (filtering || modal) return; finish('deploy'); });
    screen.key(['q', 'C-c'], () => {
      if (filtering || modal) return;
      cleanup();
      screen.destroy();
      resolve({ action: 'quit' });
    });

    function cyclePane(dir) {
      if (filtering || modal) return;
      const cur = panes.findIndex((el) => el.focused);
      const base = cur < 0 ? 0 : cur;
      const next = (base + dir + panes.length) % panes.length;
      focusPane(panes[next]);
    }
    screen.key('tab', () => cyclePane(1));
    screen.key('S-tab', () => cyclePane(-1)); // shift+tab → previous pane

    function cleanup() {
      program.emit = realEmit; // restore original emitter
    }

    // ---- boot ------------------------------------------------------------
    renderAll();
    focusPane(typesList); // start on the type list; enter opens a type
    if (store.activeType) {
      ensureLoaded(store.activeType); // warm the first type in the background
    }
    screen.render();
  });
}
