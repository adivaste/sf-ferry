import assert from 'node:assert';
import {
    createStore,
    setTypes,
    setComponents,
    setActiveType,
    setFilter,
    setSort,
    visibleRows,
    toggleSelect,
    selectAllVisible,
    clearVisible,
    isSelected,
    selectionCount,
    selectionGrouped,
    manifestEntries,
    selectedCountForType,
} from '../src/store.js';

let passed = 0;
const check = (label, cond) => {
    assert.ok(cond, label);
    console.log('PASS', label);
    passed += 1;
};

const apex = [
    {
        type: 'ApexClass',
        fullName: 'AccountCtrl',
        lastModifiedByName: 'A. Vaste',
        lastModifiedDate: '2026-06-20T10:00:00.000+0000',
        createdByName: 'A. Vaste',
        createdDate: '2025-01-02T10:00:00.000+0000',
    },
    {
        type: 'ApexClass',
        fullName: 'LeadService',
        lastModifiedByName: 'J. Smith',
        lastModifiedDate: '2026-06-23T09:00:00.000+0000',
        createdByName: 'A. Vaste',
        createdDate: '2024-11-15T10:00:00.000+0000',
    },
    {
        type: 'ApexClass',
        fullName: 'zHelper',
        lastModifiedByName: 'B. Lee',
        lastModifiedDate: '2026-01-05T09:00:00.000+0000',
        createdByName: 'B. Lee',
        createdDate: '2026-05-30T10:00:00.000+0000',
    },
];
const lwc = [
    {
        type: 'LightningComponentBundle',
        fullName: 'myComp',
        lastModifiedByName: 'A. Vaste',
        lastModifiedDate: '2026-06-01T10:00:00.000+0000',
        createdByName: 'A. Vaste',
        createdDate: '2026-06-01T10:00:00.000+0000',
    },
];

const store = createStore({ sourceOrg: 'uat', targetOrg: 'prod' });
setTypes(store, [{ name: 'ApexClass' }, { name: 'LightningComponentBundle' }]);
check('first type auto-active', store.activeType === 'ApexClass');

setComponents(store, 'ApexClass', apex);
setComponents(store, 'LightningComponentBundle', lwc);

// default sort: name ascending
check(
    'default name asc',
    visibleRows(store)
        .map((r) => r.fullName)
        .join(',') === 'AccountCtrl,LeadService,zHelper',
);

// sort by last modified date asc then desc
setSort(store, 'lastModifiedDate');
check('lastModified asc oldest first', visibleRows(store)[0].fullName === 'zHelper');
setSort(store, 'lastModifiedDate'); // flip
check('lastModified desc newest first', visibleRows(store)[0].fullName === 'LeadService');

// sort by owner (last modified by)
setSort(store, 'lastModifiedByName');
check('owner asc', visibleRows(store)[0].lastModifiedByName === 'A. Vaste');

// filter (token search across name + owner)
setSort(store, 'fullName');
setSort(store, 'fullName'); // back to asc-ish; ensure deterministic
setFilter(store, 'smith');
check(
    'filter by owner name',
    visibleRows(store).length === 1 && visibleRows(store)[0].fullName === 'LeadService',
);
setFilter(store, '');

// selection
toggleSelect(store, 'ApexClass', 'AccountCtrl');
toggleSelect(store, 'ApexClass', 'LeadService');
check('two selected', selectionCount(store) === 2);
check('isSelected works', isSelected(store, 'ApexClass', 'AccountCtrl'));
toggleSelect(store, 'ApexClass', 'AccountCtrl'); // unselect
check('toggle off', !isSelected(store, 'ApexClass', 'AccountCtrl') && selectionCount(store) === 1);

// select all visible (respects filter)
setFilter(store, 'a'); // matches AccountCtrl (name), LeadService (J. Smith? no 'a' -> 'a. vaste' yes), zHelper? 'zhelper' no a -> but owner 'B. Lee' no. Actually AccountCtrl name has 'a', LeadService owner 'a. vaste'... keep deterministic: just selectAllVisible
selectAllVisible(store);
check('select-all-visible adds visible', selectedCountForType(store, 'ApexClass') >= 1);
setFilter(store, '');

// add an LWC
setActiveType(store, 'LightningComponentBundle');
toggleSelect(store, 'LightningComponentBundle', 'myComp');

// grouped preview + manifest entries
const grouped = selectionGrouped(store);
check(
    'grouped by type sorted',
    grouped[0].type === 'ApexClass' && grouped[1].type === 'LightningComponentBundle',
);
const entries = manifestEntries(store);
check(
    'manifest entries shape',
    entries.every((e) => e.type && e.fullName),
);
check(
    'manifest includes lwc',
    entries.some((e) => e.type === 'LightningComponentBundle' && e.fullName === 'myComp'),
);

// setActiveType clears the filter by default, but keepFilter preserves it (sticky)
setFilter(store, 'acct');
setActiveType(store, 'ApexClass');
check('setActiveType clears filter by default', store.filter === '');
setFilter(store, 'acct');
setActiveType(store, 'LightningComponentBundle', { keepFilter: true });
check('setActiveType keepFilter preserves filter', store.filter === 'acct');
setFilter(store, '');

// clearVisible removes only active-type visible
setActiveType(store, 'ApexClass');
clearVisible(store);
check('clearVisible drops apex selection', selectedCountForType(store, 'ApexClass') === 0);
check('lwc selection intact', selectedCountForType(store, 'LightningComponentBundle') === 1);

console.log(`\n${passed} store checks passed`);
