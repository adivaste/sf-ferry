/**
 * Pure UI state + logic for the selection screen. No I/O, no blessed — so it
 * can be unit-tested in isolation. The TUI renders this and dispatches actions.
 */

export const COLUMNS = [
  { key: 'fullName', label: 'Name' },
  { key: 'lastModifiedByName', label: 'Last Modified By' },
  { key: 'lastModifiedDate', label: 'Last Modified' },
  { key: 'createdDate', label: 'Created' },
];

export function createStore({ sourceOrg = '', targetOrg = '' } = {}) {
  return {
    sourceOrg,
    targetOrg,
    types: [], // [{name, inFolder}]
    activeType: null,
    componentsByType: {}, // type -> rows[]
    filter: '',
    sortKey: 'fullName',
    sortDir: 1, // 1 asc, -1 desc
    selected: {}, // type -> Set<fullName>
  };
}

export function setTypes(store, types) {
  store.types = types;
  if (!store.activeType && types.length) store.activeType = types[0].name;
}

export function setComponents(store, type, rows) {
  store.componentsByType[type] = rows;
}

export function hasComponents(store, type) {
  return Array.isArray(store.componentsByType[type]);
}

export function setActiveType(store, type) {
  store.activeType = type;
  store.filter = '';
}

export function setFilter(store, value) {
  store.filter = value;
}

/** Click/keypress on a column: same column flips direction, new column → ascending. */
export function setSort(store, key) {
  if (store.sortKey === key) store.sortDir *= -1;
  else {
    store.sortKey = key;
    store.sortDir = 1;
  }
}

function compare(a, b, key) {
  const av = (a[key] || '').toString().toLowerCase();
  const bv = (b[key] || '').toString().toLowerCase();
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

/** Rows of the active type after filter + sort. */
export function visibleRows(store) {
  const rows = store.componentsByType[store.activeType] || [];
  const term = store.filter.trim().toLowerCase();
  const tokens = term ? term.split(/\s+/) : [];
  const filtered = tokens.length
    ? rows.filter((r) => {
        const hay = `${r.fullName} ${r.lastModifiedByName} ${r.createdByName}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      })
    : rows.slice();
  filtered.sort((a, b) => compare(a, b, store.sortKey) * store.sortDir);
  return filtered;
}

function bucket(store, type) {
  if (!store.selected[type]) store.selected[type] = new Set();
  return store.selected[type];
}

export function isSelected(store, type, fullName) {
  return !!store.selected[type] && store.selected[type].has(fullName);
}

/** Replace the whole selection from a flat [{type, fullName}] list (restore). */
export function setSelection(store, entries) {
  store.selected = {};
  for (const e of entries || []) {
    if (!e || !e.type || !e.fullName) continue;
    if (!store.selected[e.type]) store.selected[e.type] = new Set();
    store.selected[e.type].add(e.fullName);
  }
}

export function toggleSelect(store, type, fullName) {
  const set = bucket(store, type);
  if (set.has(fullName)) set.delete(fullName);
  else set.add(fullName);
  if (set.size === 0) delete store.selected[type];
}

export function selectAllVisible(store) {
  const set = bucket(store, store.activeType);
  for (const r of visibleRows(store)) set.add(r.fullName);
  if (set.size === 0) delete store.selected[store.activeType];
}

export function clearVisible(store) {
  const set = store.selected[store.activeType];
  if (!set) return;
  for (const r of visibleRows(store)) set.delete(r.fullName);
  if (set.size === 0) delete store.selected[store.activeType];
}

export function selectionCount(store) {
  return Object.values(store.selected).reduce((n, s) => n + s.size, 0);
}

export function selectedCountForType(store, type) {
  return store.selected[type] ? store.selected[type].size : 0;
}

/** Selection grouped by type, sorted, for the preview pane. */
export function selectionGrouped(store) {
  return Object.keys(store.selected)
    .sort((a, b) => a.localeCompare(b))
    .map((type) => ({
      type,
      items: [...store.selected[type]].sort((a, b) => a.localeCompare(b)),
    }));
}

/** Flat {type, fullName}[] for manifest generation. */
export function manifestEntries(store) {
  const out = [];
  for (const { type, items } of selectionGrouped(store)) {
    for (const fullName of items) out.push({ type, fullName });
  }
  return out;
}
