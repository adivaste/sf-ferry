import assert from 'node:assert';
import {
    candidateTestNames,
    suggestTestClasses,
    buildTargetIndex,
    classifyStatus,
    resolveDependencies,
    missingCount,
} from '../src/dependencies.js';

let n = 0;
const ok = (label, cond) => {
    assert.ok(cond, label);
    console.log('PASS', label);
    n += 1;
};

// --- naming conventions ---
const names = candidateTestNames('AccountService');
ok(
    'candidateTestNames covers common patterns',
    ['AccountServiceTest', 'AccountService_Test', 'TestAccountService'].every((x) => names.includes(x)),
);

// --- test-class pairing ---
const sourceApex = new Set(['AccountService', 'AccountService_Test', 'LeadCtrl', 'LeadCtrlTest', 'zHelper']);
const tests = suggestTestClasses(['AccountService', 'LeadCtrl'], sourceApex, new Set());
ok(
    'suggests existing test classes',
    tests.some((t) => t.fullName === 'AccountService_Test') &&
        tests.some((t) => t.fullName === 'LeadCtrlTest'),
);
ok(
    'test suggestion carries a reason',
    tests.every((t) => /test of/.test(t.why)),
);
ok('does not suggest a missing test', !suggestTestClasses(['zHelper'], sourceApex).length);
ok(
    'skips already-selected tests',
    !suggestTestClasses(['AccountService'], sourceApex, new Set(['ApexClass:AccountService_Test'])).length,
);
ok(
    'does not treat a test class as needing its own test',
    !suggestTestClasses(['AccountService_Test'], sourceApex).length,
);

// --- target index + classification ---
const targetIndex = buildTargetIndex({
    ApexClass: [{ fullName: 'AccountService', lastModifiedDate: '2026-01-01T00:00:00.000Z' }],
    CustomField: [{ fullName: 'Account.Region__c', lastModifiedDate: '2026-06-01T00:00:00.000Z' }],
});
ok(
    'missing when absent from target',
    classifyStatus({ type: 'ApexClass', fullName: 'Nope' }, targetIndex) === 'missing',
);
ok(
    'present when target is newer/equal',
    classifyStatus(
        { type: 'CustomField', fullName: 'Account.Region__c' },
        targetIndex,
        '2026-05-01T00:00:00.000Z',
    ) === 'present',
);
ok(
    'older when target predates source',
    classifyStatus(
        { type: 'ApexClass', fullName: 'AccountService' },
        targetIndex,
        '2026-03-01T00:00:00.000Z',
    ) === 'older',
);

// --- resolve: dedupe, drop selected, sort missing-first ---
const rows = resolveDependencies({
    candidates: [
        { type: 'ApexClass', fullName: 'AccountService', why: 'used by X' }, // present/older
        { type: 'ApexClass', fullName: 'AccountService', why: 'dup' }, // duplicate → dropped
        { type: 'CustomField', fullName: 'Account.New__c', why: 'used by X' }, // missing
        { type: 'ApexClass', fullName: 'AlreadyPicked', why: 'x' }, // selected → dropped
    ],
    targetIndex,
    sourceDates: new Map([['ApexClass:AccountService', '2026-09-01T00:00:00.000Z']]),
    selectedSet: new Set(['ApexClass:AlreadyPicked']),
});
ok('dedupes and drops already-selected', rows.length === 2);
ok(
    'missing sorts before present/older',
    rows[0].status === 'missing' && rows[0].fullName === 'Account.New__c',
);
ok(
    'carries target date for present rows',
    rows.some((r) => r.type === 'ApexClass' && r.targetDate),
);
ok('missingCount counts only missing', missingCount(rows) === 1);

console.log(`\n${n} dependency checks passed`);
