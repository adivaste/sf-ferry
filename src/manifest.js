import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ComponentSet, RegistryAccess } from '@salesforce/source-deploy-retrieve';
import { PACKAGE_FILE, DESTRUCTIVE_FILE, EMPTY_PACKAGE_FILE } from './constants.js';

// This module pulls in SDR (~2s to import) — keep it OUT of the hot path and
// import it lazily, only when manifests actually need to be written.

const registry = new RegistryAccess();

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
 * Build the package.xml text for a selection WITHOUT writing anything to disk —
 * used for the in-UI preview (press `p`). Throws (via getTypeByName) if a type
 * name is invalid, so the caller can surface it.
 */
export async function buildPackageXml(entries, apiVersion) {
    return toXml(buildComponentSet(entries, apiVersion));
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
