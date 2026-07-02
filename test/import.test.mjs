import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { parsePackageXml, importPackage } from '../src/import-manifest.js';

let n = 0;
const ok = (label, cond) => { assert.ok(cond, label); console.log('PASS', label); n += 1; };

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
  <types><members>A</members><members>B</members><members>A</members><name>ApexClass</name></types>
  <types><members>*</members><name>CustomObject</name></types>
  <types><members>Account.Region__c</members><name>CustomField</name></types>
  <version>62.0</version>
</Package>`;

// ---- parse ----
const parsed = parsePackageXml(XML);
const keys = parsed.entries.map((e) => `${e.type}:${e.fullName}`);
ok('parses explicit members', keys.includes('ApexClass:A') && keys.includes('ApexClass:B') && keys.includes('CustomField:Account.Region__c'));
ok('dedupes repeated member', keys.filter((k) => k === 'ApexClass:A').length === 1);
ok('reports wildcard types (not as entries)', parsed.wildcards.includes('CustomObject') && !keys.some((k) => k.includes('CustomObject')));
ok('reads version', parsed.version === '62.0');

// ---- import from a .xml file and a .zip (unpackaged/package.xml) ----
const dir = mkdtempSync(path.join(tmpdir(), 'ferry-import-'));
try {
  const xmlPath = path.join(dir, 'package.xml');
  writeFileSync(xmlPath, XML);
  const fromXml = await importPackage(xmlPath);
  ok('importPackage reads a .xml file', fromXml.entries.length === 3);

  const zip = new JSZip();
  zip.file('unpackaged/package.xml', XML);
  zip.file('unpackaged/classes/A.cls', 'public class A {}');
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const zipPath = path.join(dir, 'mychangeset.zip');
  writeFileSync(zipPath, buf);
  const fromZip = await importPackage(zipPath);
  ok('importPackage extracts package.xml from a .zip', fromZip.entries.length === 3 && fromZip.entries.some((e) => e.fullName === 'Account.Region__c'));

  let threw = false;
  try { await importPackage(path.join(dir, 'nope.txt')); } catch { threw = true; }
  ok('rejects unsupported file types', threw);

  console.log(`\n${n} import checks passed`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
