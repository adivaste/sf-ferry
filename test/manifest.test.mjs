import assert from 'node:assert';
import { buildPackageXml } from '../src/manifest.js';

let n = 0;
const ok = (label, cond) => {
    assert.ok(cond, label);
    console.log('PASS', label);
    n += 1;
};

const entries = [
    { type: 'ApexClass', fullName: 'AccountService' },
    { type: 'ApexClass', fullName: 'LeadController' },
    { type: 'CustomObject', fullName: 'Broker__c' },
];

const xml = await buildPackageXml(entries, '62.0');

ok('returns a string', typeof xml === 'string' && xml.length > 0);
ok('is a Package document', xml.includes('<Package') && xml.includes('</Package>'));
ok('includes ApexClass members', xml.includes('AccountService') && xml.includes('LeadController'));
ok('groups the ApexClass type', xml.includes('<name>ApexClass</name>'));
ok('includes the CustomObject', xml.includes('Broker__c') && xml.includes('<name>CustomObject</name>'));
ok('carries the api version', xml.includes('<version>62.0</version>'));

// an invalid metadata type name must throw (so the preview surfaces it)
let threw = false;
try {
    await buildPackageXml([{ type: 'NotARealType', fullName: 'X' }], '62.0');
} catch {
    threw = true;
}
ok('invalid type throws', threw);

console.log(`\n${n} manifest checks passed`);
