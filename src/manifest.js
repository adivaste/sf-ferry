import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { ComponentSet, RegistryAccess } from '@salesforce/source-deploy-retrieve';

const registry = new RegistryAccess();

const STATE_FILE = '.selection.json';
export const PACKAGE_FILE = 'package.xml';
export const DESTRUCTIVE_FILE = 'destructiveChanges.xml';
export const EMPTY_PACKAGE_FILE = 'empty-package.xml';

function statePath(manifestDir) {
  return path.join(manifestDir, STATE_FILE);
}

/** Load the persisted selection (changes + destructive) for a manifest dir. */
export function loadState(manifestDir, apiVersion) {
  const file = statePath(manifestDir);
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    return {
      apiVersion: saved.apiVersion || apiVersion,
      changes: saved.changes || [],
      destructive: saved.destructive || [],
    };
  }
  return { apiVersion, changes: [], destructive: [] };
}

export function saveState(manifestDir, state) {
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(statePath(manifestDir), JSON.stringify(state, null, 2));
}

/** Merge new {type, fullName} entries into a list, de-duplicating by type:fullName. */
export function mergeEntries(existing, additions) {
  const map = new Map(existing.map((e) => [`${e.type}:${e.fullName}`, e]));
  for (const a of additions) map.set(`${a.type}:${a.fullName}`, a);
  return [...map.values()].sort((a, b) =>
    a.type === b.type
      ? a.fullName.localeCompare(b.fullName)
      : a.type.localeCompare(b.type),
  );
}

export function removeEntries(existing, removals) {
  const drop = new Set(removals.map((r) => `${r.type}:${r.fullName}`));
  return existing.filter((e) => !drop.has(`${e.type}:${e.fullName}`));
}

function buildComponentSet(entries, apiVersion) {
  const cs = new ComponentSet();
  cs.apiVersion = apiVersion;
  for (const entry of entries) {
    // Throws a clear error if a metadata type name is invalid.
    const type = registry.getTypeByName(entry.type);
    cs.add({ fullName: entry.fullName, type });
  }
  return cs;
}

async function toXml(cs) {
  // getPackageXml is synchronous in current SDR, but tolerate a Promise too.
  return Promise.resolve(cs.getPackageXml());
}

/**
 * Regenerate package.xml, destructiveChanges.xml and an empty-package.xml
 * from the persisted selection state. destructiveChanges.xml uses the same
 * schema as package.xml, so SDR's generator produces a valid file for both.
 */
export async function writeManifests(manifestDir, state) {
  mkdirSync(manifestDir, { recursive: true });

  const pkg = buildComponentSet(state.changes, state.apiVersion);
  writeFileSync(path.join(manifestDir, PACKAGE_FILE), await toXml(pkg));

  const written = [PACKAGE_FILE];

  if (state.destructive.length > 0) {
    const destr = buildComponentSet(state.destructive, state.apiVersion);
    writeFileSync(path.join(manifestDir, DESTRUCTIVE_FILE), await toXml(destr));
    written.push(DESTRUCTIVE_FILE);

    // An empty package.xml is required to pair with a destructive-only deploy.
    const empty = new ComponentSet();
    empty.apiVersion = state.apiVersion;
    writeFileSync(path.join(manifestDir, EMPTY_PACKAGE_FILE), await toXml(empty));
    written.push(EMPTY_PACKAGE_FILE);
  }

  return written;
}
