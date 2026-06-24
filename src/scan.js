import { existsSync } from 'node:fs';
import { ComponentSet } from '@salesforce/source-deploy-retrieve';

/**
 * Resolve every metadata component found under one or more source directories
 * using Salesforce's own resolver (SDR). Returns a sorted, de-duplicated list of
 * { type, fullName } where fullName is already the manifest-correct member name
 * (e.g. "Account.MyField__c" for a custom field, the bundle name for an LWC, etc.).
 */
export function scanSource(sourceDirs) {
  const dirs = Array.isArray(sourceDirs) ? sourceDirs : [sourceDirs];
  const missing = dirs.filter((d) => !existsSync(d));
  if (missing.length === dirs.length) {
    throw new Error(`No source directory found. Looked in: ${dirs.join(', ')}`);
  }

  const existing = dirs.filter((d) => existsSync(d));
  const cs = ComponentSet.fromSource(existing);

  const seen = new Set();
  const items = [];
  for (const component of cs.getSourceComponents()) {
    const type = component.type?.name;
    const fullName = component.fullName;
    if (!type || !fullName) continue;
    const key = `${type}:${fullName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      type,
      fullName,
      path: component.xml || component.content || '',
    });
  }

  items.sort((a, b) =>
    a.type === b.type
      ? a.fullName.localeCompare(b.fullName)
      : a.type.localeCompare(b.type),
  );
  return items;
}
