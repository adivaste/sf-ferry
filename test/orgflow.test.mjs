import assert from 'node:assert';
import { buildRetrieveArgs, buildOrgDeployArgs, RETRIEVE_ZIP } from '../src/orgflow.js';

let n = 0;
const ok = (label, cond) => { assert.ok(cond, label); console.log('PASS', label); n += 1; };

// Retrieve must use metadata format (--target-metadata-dir), NOT --output-dir
// (source-format retrieve was silently filtered by the project's .forceignore).
const ra = buildRetrieveArgs({ manifestPath: 'manifest/package.xml', sourceOrg: 'uat', metadataDir: '.sfm-retrieve' });
ok('retrieve uses --target-metadata-dir', ra.includes('--target-metadata-dir') && ra.includes('.sfm-retrieve'));
ok('retrieve does NOT use --output-dir', !ra.includes('--output-dir'));
ok('retrieve passes manifest + source org', ra.includes('manifest/package.xml') && ra[ra.indexOf('--target-org') + 1] === 'uat');

// Deploy must use --metadata-dir <zip> and NOT --single-package (zip has an
// unpackaged/ wrapper) and NOT --source-dir.
const da = buildOrgDeployArgs({ zipPath: `.sfm-retrieve/${RETRIEVE_ZIP}`, targetOrg: 'prod', testLevel: 'RunLocalTests' });
ok('deploy uses --metadata-dir zip', da.includes('--metadata-dir') && da.includes(`.sfm-retrieve/${RETRIEVE_ZIP}`));
ok('deploy NOT --single-package', !da.includes('--single-package'));
ok('deploy NOT --source-dir', !da.includes('--source-dir'));
ok('deploy is start by default', da.includes('start') && !da.includes('validate'));

const va = buildOrgDeployArgs({ zipPath: 'z.zip', targetOrg: 'prod', testLevel: 'RunSpecifiedTests', tests: ['T1', 'T2'], validate: true });
ok('validate mode', va.includes('validate') && !va.includes('start'));
ok('RunSpecifiedTests passes --tests', va.filter((x) => x === '--tests').length === 2 && va.includes('T1') && va.includes('T2'));

console.log(`\n${n} orgflow checks passed`);
