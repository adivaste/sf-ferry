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
import { TEST_LEVELS } from './deploy.js';

const trunc = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');
const shortDate = (d) => (d ? String(d).slice(0, 10) : '');

/**
 * Launch the interactive selection screen.
 *
 * @param store          the state store (already seeded with types)
 * @param loadComponents async (type) => rows[]   — fetch + cache live components
 * @param orgs           [{label, value}] known target orgs
 * Resolves with { action, testLevel, targetOrg, entries } when the user acts.
 */
export function runTui({ store, loadComponents, orgs = [] }) {
  return new Promise((resolve) => {
    const screen = blessed.screen({
      smartCSR: true,
      title: 'sfm — metadata selector',
      fullUnicode: true,
      autoPadding: true,
    });

    let testLevel = 'RunLocalTests';
    let busy = false;

    // ---- layout ----------------------------------------------------------
    const header = blessed.box({
      parent: screen, top: 0, left: 0, height: 1, width: '100%',
      tags: true, style: { fg: 'white', bg: 'blue' },
    });

    const typesList = blessed.list({
      parent: screen, label: ' Types ', top: 1, left: 0, width: '25%', bottom: 3,
      border: 'line', keys: true, mouse: true, tags: true,
      style: { selected: { bg: 'cyan', fg: 'black' }, border: { fg: 'gray' }, label: { fg: 'cyan' } },
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

    // ---- rendering -------------------------------------------------------
    function renderHeader() {
      const tgt = store.targetOrg || '(no target)';
      header.setContent(
        ` {bold}sfm{/bold}  source: {yellow-fg}${store.sourceOrg}{/yellow-fg}  →  target: {yellow-fg}${tgt}{/yellow-fg}` +
        `   test-level: {green-fg}${testLevel}{/green-fg}   selected: {green-fg}${selectionCount(store)}{/green-fg}`,
      );
    }

    function renderTypes() {
      const items = store.types.map((t) => {
        const sel = selectedCountForType(store, t.name);
        const tag = sel ? ` {green-fg}(${sel})✓{/green-fg}` : '';
        const active = t.name === store.activeType ? '{cyan-fg}❯{/cyan-fg} ' : '  ';
        return `${active}${t.name}${tag}`;
      });
      typesList.setItems(items);
      const idx = store.types.findIndex((t) => t.name === store.activeType);
      if (idx >= 0) typesList.select(idx);
    }

    function header4(key, label) {
      if (store.sortKey !== key) return label;
      return `${label} ${store.sortDir === 1 ? '▲' : '▼'}`;
    }

    function renderTable() {
      const head = [
        '   ' + header4('fullName', 'Name'),
        header4('lastModifiedByName', 'Last Modified By'),
        header4('lastModifiedDate', 'Last Modified'),
        header4('createdDate', 'Created'),
      ];
      if (!hasComponents(store, store.activeType)) {
        table.setData([head, ['  loading…', '', '', '']]);
        screen.render();
        return;
      }
      const rows = visibleRows(store);
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
      if (rows.length === 0) data.push(['  (no matches)', '', '', '']);
      table.setData(data);
      screen.render();
    }

    function renderBasket() {
      const groups = selectionGrouped(store);
      if (groups.length === 0) {
        basket.setContent('{gray-fg}Nothing selected yet.\nSpace to check a row.{/gray-fg}');
      } else {
        const lines = [];
        for (const g of groups) {
          lines.push(`{bold}{green-fg}${g.type}{/green-fg}{/bold} (${g.items.length})`);
          for (const item of g.items) lines.push(`  • ${item}`);
          lines.push('');
        }
        basket.setContent(lines.join('\n'));
      }
      screen.render();
    }

    function renderFooter() {
      footer.setContent(
        ' {cyan-fg}↑↓{/cyan-fg} move  {cyan-fg}enter{/cyan-fg} open type  {cyan-fg}space{/cyan-fg} check  {cyan-fg}a{/cyan-fg} all  {cyan-fg}c{/cyan-fg} clear  {cyan-fg}/{/cyan-fg} filter  {cyan-fg}1-4{/cyan-fg} sort  {cyan-fg}r{/cyan-fg} refresh  {cyan-fg}t{/cyan-fg} target  {cyan-fg}l{/cyan-fg} test-level\n' +
        ' {green-fg}b{/green-fg} build package.xml   {green-fg}v{/green-fg} validate   {green-fg}d{/green-fg} deploy   {red-fg}q{/red-fg} quit',
      );
      screen.render();
    }

    function renderAll() {
      renderHeader(); renderTypes(); renderTable(); renderBasket(); renderFooter();
    }

    function status(msg) {
      footer.setContent(` {yellow-fg}${msg}{/yellow-fg}`);
      screen.render();
    }

    // ---- data loading ----------------------------------------------------
    async function ensureLoaded(type, { refresh = false } = {}) {
      if (hasComponents(store, type) && !refresh) return;
      busy = true;
      status(`Loading ${type} from ${store.sourceOrg}…`);
      try {
        await loadComponents(type, { refresh });
      } catch (e) {
        status(`Error loading ${type}: ${e.message}`);
      }
      busy = false;
      renderAll();
    }

    // ---- interactions ----------------------------------------------------
    typesList.on('select', async (_item, index) => {
      const t = store.types[index];
      if (!t) return;
      setActiveType(store, t.name);
      renderAll();
      await ensureLoaded(t.name);
      table.focus();
    });

    function activeRow() {
      const rows = visibleRows(store);
      // listtable selected index includes the header row at 0
      const i = table.selected - 1;
      return i >= 0 && i < rows.length ? rows[i] : null;
    }

    screen.key('space', () => {
      if (busy) return;
      const r = activeRow();
      if (!r) return;
      toggleSelect(store, r.type, r.fullName);
      renderTable(); renderBasket(); renderHeader(); renderTypes();
    });

    screen.key('a', () => { selectAllVisible(store); renderAll(); });
    screen.key('c', () => { clearVisible(store); renderAll(); });

    // sort by column number 1..4, or click a header cell
    for (let n = 1; n <= COLUMNS.length; n += 1) {
      screen.key(String(n), () => { setSort(store, COLUMNS[n - 1].key); renderTable(); });
    }
    table.on('click', (data) => {
      // Clicking the top (header) row cycles that column's sort.
      const rel = data.y - (table.atop + (table.iheight ? 1 : 1));
      if (rel <= 0) {
        const innerW = table.width - 2;
        const colW = innerW / COLUMNS.length;
        const col = Math.min(COLUMNS.length - 1, Math.max(0, Math.floor((data.x - table.aleft - 1) / colW)));
        setSort(store, COLUMNS[col].key);
        renderTable();
      }
    });

    screen.key('/', () => { filterBox.focus(); });
    filterBox.on('submit', (val) => { setFilter(store, val || ''); renderTable(); table.focus(); });
    filterBox.on('cancel', () => { filterBox.clearValue(); setFilter(store, ''); renderTable(); table.focus(); });
    filterBox.key('escape', () => { filterBox.cancel(); });

    screen.key('r', async () => {
      if (busy) return;
      await ensureLoaded(store.activeType, { refresh: true });
      table.focus();
    });

    screen.key('l', () => {
      const i = TEST_LEVELS.indexOf(testLevel);
      testLevel = TEST_LEVELS[(i + 1) % TEST_LEVELS.length];
      renderHeader(); renderFooter();
    });

    screen.key('t', () => {
      if (orgs.length === 0) { status('No other orgs found.'); return; }
      const picker = blessed.list({
        parent: screen, label: ' Pick target org ', top: 'center', left: 'center',
        width: '50%', height: '50%', border: 'line', keys: true, mouse: true,
        items: orgs.map((o) => o.label),
        style: { selected: { bg: 'cyan', fg: 'black' }, border: { fg: 'cyan' } },
      });
      picker.focus();
      picker.on('select', (_i, idx) => {
        store.targetOrg = orgs[idx].value;
        picker.destroy();
        renderHeader(); renderFooter(); table.focus();
      });
      picker.key('escape', () => { picker.destroy(); renderFooter(); table.focus(); });
      screen.render();
    });

    function finish(action) {
      if (action !== 'build' && selectionCount(store) === 0) {
        status('Select at least one component first.');
        return;
      }
      screen.destroy();
      resolve({ action, testLevel, targetOrg: store.targetOrg, entries: manifestEntries(store) });
    }

    screen.key('b', () => finish('build'));
    screen.key('v', () => finish('validate'));
    screen.key('d', () => finish('deploy'));
    screen.key(['q', 'C-c'], () => { screen.destroy(); resolve({ action: 'quit' }); });

    // tab cycles focus between the three panes
    screen.key('tab', () => {
      const order = [typesList, table, basket];
      const cur = order.findIndex((el) => el.focused);
      order[(cur + 1) % order.length].focus();
      screen.render();
    });

    // ---- boot ------------------------------------------------------------
    renderAll();
    typesList.focus();
    if (store.activeType) ensureLoaded(store.activeType).then(() => table.focus());
    screen.render();
  });
}
