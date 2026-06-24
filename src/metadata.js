import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

/**
 * In-folder metadata (Reports, Dashboards, Documents, EmailTemplates) needs
 * per-folder enumeration; we skip these in the first pass and surface them
 * separately so the count is never silently wrong.
 */
export const FOLDER_TYPES = new Set(['Report', 'Dashboard', 'Document', 'EmailTemplate']);

const CACHE_ROOT = '.sfm-cache';

function safe(name) {
  return name.replace(/[^a-zA-Z0-9._@-]/g, '_');
}

function cachePath(orgKey, type) {
  return path.join(CACHE_ROOT, safe(orgKey), `${safe(type)}.json`);
}

/**
 * All selectable metadata types in the org. Includes both top-level types
 * (xmlName) AND child types (childXmlNames) such as CustomField, ValidationRule,
 * RecordType, WebLink, ListView, FieldSet, CompactLayout, BusinessProcess, etc.
 * — these are listable via listMetadata and appear in change sets, but are NOT
 * returned as top-level metadataObjects, which is why they were missing before.
 */
export async function describeTypes(conn, apiVersion) {
  const res = await conn.metadata.describe(apiVersion);
  const objects = res?.metadataObjects || [];
  const byName = new Map();
  for (const m of objects) {
    if (m.xmlName && !byName.has(m.xmlName)) {
      byName.set(m.xmlName, {
        name: m.xmlName,
        inFolder: m.inFolder === true || m.inFolder === 'true',
      });
    }
    for (const child of [].concat(m.childXmlNames || [])) {
      if (child && !byName.has(child)) byName.set(child, { name: child, inFolder: false });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function normalize(fp) {
  return {
    type: fp.type,
    fullName: fp.fullName,
    lastModifiedByName: fp.lastModifiedByName || '',
    lastModifiedDate: fp.lastModifiedDate || '',
    createdByName: fp.createdByName || '',
    createdDate: fp.createdDate || '',
    id: fp.id || '',
  };
}

/**
 * List the components of a metadata type as normalized rows (with owner +
 * created/last-modified info from FileProperties). Cached to disk per org+type;
 * pass { refresh:true } to bypass the cache.
 */
export async function listComponents(conn, type, { apiVersion, orgKey, refresh = false } = {}) {
  const file = cachePath(orgKey, type);
  if (!refresh && existsSync(file)) {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      // fall through and re-fetch on a corrupt cache file
    }
  }

  const res = await conn.metadata.list([{ type }], apiVersion);
  const arr = Array.isArray(res) ? res : res ? [res] : [];
  const rows = arr.filter((fp) => fp && fp.fullName).map(normalize);
  rows.sort((a, b) => a.fullName.localeCompare(b.fullName));

  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(rows, null, 2));
  return rows;
}
