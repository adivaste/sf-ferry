// Verifies child types (CustomField, ValidationRule, RecordType, …) are
// included in the type list — they are childXmlNames, not top-level objects.
import assert from 'node:assert';
import { describeTypes } from '../src/metadata.js';

const fakeConn = {
  metadata: {
    describe: async () => ({
      metadataObjects: [
        { xmlName: 'CustomObject', inFolder: false, childXmlNames: ['CustomField', 'ValidationRule', 'RecordType', 'WebLink', 'ListView'] },
        { xmlName: 'ApexClass', inFolder: false },
        { xmlName: 'Report', inFolder: true },
        { xmlName: 'CustomObject', inFolder: false }, // duplicate, must be de-duped
      ],
    }),
  },
};

const types = await describeTypes(fakeConn, '62.0');
const names = types.map((t) => t.name);

for (const expected of ['ApexClass', 'CustomObject', 'CustomField', 'ValidationRule', 'RecordType', 'WebLink', 'ListView']) {
  assert.ok(names.includes(expected), `missing type: ${expected}`);
  console.log('PASS includes', expected);
}
assert.strictEqual(names.filter((n) => n === 'CustomObject').length, 1, 'CustomObject de-duped');
console.log('PASS CustomObject de-duped');
assert.deepStrictEqual(names, [...names].sort((a, b) => a.localeCompare(b)), 'sorted');
console.log('PASS sorted');
console.log('\nmetadata describeTypes checks passed');
