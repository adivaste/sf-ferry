import {
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { cacheFile } from './paths.js';
import { writeJsonAtomic } from './fsjson.js';

/**
 * In-folder metadata (Reports, Dashboards, Documents, EmailTemplates) needs
 * per-folder enumeration; we skip these in the first pass and surface them
 * separately so the count is never silently wrong.
 */
export const FOLDER_TYPES = new Set(['Report', 'Dashboard', 'Document', 'EmailTemplate']);

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
 * List a metadata type's components as normalized rows (owner + created/modified
 * from FileProperties). Cached under ~/.ferry/cache/<org>/<type>.json with the
 * fetch time. Never auto-expires — the UI shows the age and `r` re-pulls.
 * Returns { rows, fetchedAt }. Pass { refresh:true } to bypass the cache.
 */
export async function listComponents(conn, type, { apiVersion, orgKey, refresh = false } = {}) {
  const file = cacheFile(orgKey, type);
  if (!refresh && existsSync(file)) {
    try {
      const cached = JSON.parse(readFileSync(file, 'utf8'));
      // Honour a cached listing only if it isn't from a different API version —
      // otherwise a different --api-version would silently serve stale rows.
      if (cached && Array.isArray(cached.rows) && (!cached.apiVersion || cached.apiVersion === apiVersion)) {
        return { rows: cached.rows, fetchedAt: cached.fetchedAt || null };
      }
      if (Array.isArray(cached)) return { rows: cached, fetchedAt: null }; // legacy format
    } catch {
      // fall through and re-fetch on a corrupt cache file
    }
  }

  const res = await conn.metadata.list([{ type }], apiVersion);
  const arr = Array.isArray(res) ? res : res ? [res] : [];
  const rows = arr.filter((fp) => fp && fp.fullName).map(normalize);
  rows.sort((a, b) => a.fullName.localeCompare(b.fullName));

  const fetchedAt = new Date().toISOString();
  mkdirSync(path.dirname(file), { recursive: true });
  // Compact + atomic: the cache can be MBs (50k rows); indentation would inflate
  // it ~30-50% for a file only ferry reads, and a non-atomic write risks a
  // truncated file (→ silent re-fetch) on a crash mid-write.
  writeJsonAtomic(file, { fetchedAt, apiVersion, rows });
  return { rows, fetchedAt };
}
