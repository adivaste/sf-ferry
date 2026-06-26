import { readFileSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

/**
 * Parse a package.xml string into selection entries.
 * Returns { entries: [{type, fullName}], wildcards: [type...], version }.
 * `<members>*</members>` can't be turned into concrete picks here, so those
 * types are reported in `wildcards` (the caller can warn / select-all later).
 */
export function parsePackageXml(xml) {
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false, // keep members + version as strings (e.g. "62.0", numeric names)
    isArray: (name) => name === 'types' || name === 'members',
  });
  const obj = parser.parse(xml);
  const pkg = obj && (obj.Package || obj.package);
  if (!pkg) throw new Error('No <Package> root element found — is this a package.xml?');

  const entries = [];
  const wildcards = [];
  const seen = new Set();
  for (const t of [].concat(pkg.types || [])) {
    const type = t && t.name;
    if (!type) continue;
    for (const raw of [].concat(t.members || [])) {
      const member = String(raw).trim();
      if (!member) continue;
      if (member === '*') { wildcards.push(type); continue; }
      const key = `${type}:${member}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ type, fullName: member });
    }
  }
  entries.sort((a, b) => (a.type === b.type ? a.fullName.localeCompare(b.fullName) : a.type.localeCompare(b.type)));
  return { entries, wildcards: [...new Set(wildcards)], version: pkg.version != null ? String(pkg.version) : null };
}

/** Read the package.xml text from a .xml file or from inside a metadata .zip. */
export async function readPackageXml(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.xml') return readFileSync(filePath, 'utf8');
  if (ext === '.zip') {
    const zip = await JSZip.loadAsync(readFileSync(filePath));
    let entry = zip.file('package.xml') || zip.file('unpackaged/package.xml');
    if (!entry) {
      const match = Object.keys(zip.files)
        .filter((n) => !zip.files[n].dir && /(^|\/)package\.xml$/i.test(n))
        .sort((a, b) => a.length - b.length)[0]; // shallowest first
      if (match) entry = zip.file(match);
    }
    if (!entry) throw new Error('No package.xml found inside the zip.');
    return entry.async('string');
  }
  throw new Error(`Unsupported file: "${ext || filePath}" — provide a .zip or a package.xml.`);
}

/** Read + parse a .zip/.xml into { entries, wildcards, version }. */
export async function importPackage(filePath) {
  return parsePackageXml(await readPackageXml(filePath));
}
