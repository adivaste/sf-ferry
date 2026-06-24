import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { PACKAGE_FILE, TEST_LEVELS } from './constants.js';
import { writeManifests } from './manifest.js';

export { TEST_LEVELS };

// Org-to-org migration uses METADATA format end to end. Source-format retrieve
// into a side --output-dir is filtered by the project's .forceignore / package
// dirs (it silently wrote 0 files). --target-metadata-dir produces a single
// `unpackaged.zip` that deploys with --metadata-dir, untouched by project config.
export const RETRIEVE_ZIP = 'unpackaged.zip';

function sf(args) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const child = spawn(isWin ? 'sf.cmd' : 'sf', args, { stdio: 'inherit', shell: isWin });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/** Pure (testable) arg builders. */
export function buildRetrieveArgs({ manifestPath, sourceOrg, metadataDir, wait = 60 }) {
  return [
    'project', 'retrieve', 'start',
    '--manifest', manifestPath,
    '--target-org', sourceOrg,
    '--target-metadata-dir', metadataDir,
    '--wait', String(wait),
  ];
}

export function buildOrgDeployArgs({ zipPath, targetOrg, testLevel, tests = [], validate = false, wait = 60 }) {
  // `deploy validate` rejects NoTestRun (a validation must run tests). To still
  // offer a no-test check, fall back to a check-only `deploy start --dry-run`
  // (the approach the sf CLI itself recommends for this).
  const dryRunValidate = validate && testLevel === 'NoTestRun';
  const sub = validate && !dryRunValidate ? 'validate' : 'start';
  const args = [
    'project', 'deploy', sub,
    '--metadata-dir', zipPath, // a zip with an unpackaged/ wrapper — NOT --single-package
    '--target-org', targetOrg,
    '--test-level', testLevel,
  ];
  if (dryRunValidate) args.push('--dry-run');
  if (testLevel === 'RunSpecifiedTests') for (const t of tests) args.push('--tests', t);
  args.push('--wait', String(wait), '--verbose');
  return args;
}

/**
 * Write package.xml from the selection, then retrieve those components from the
 * SOURCE org as a metadata-format zip. Returns { code, zip, error }.
 */
export async function retrieveFromSource({ manifestDir, retrieveDir, sourceOrg, entries, apiVersion, wait = 60 }) {
  await writeManifests(manifestDir, { apiVersion, changes: entries, destructive: [] });
  await rm(retrieveDir, { recursive: true, force: true });
  const args = buildRetrieveArgs({
    manifestPath: path.join(manifestDir, PACKAGE_FILE),
    sourceOrg,
    metadataDir: retrieveDir,
    wait,
  });
  const code = await sf(args);
  const zip = path.join(retrieveDir, RETRIEVE_ZIP);
  if (code === 0 && !existsSync(zip)) {
    return {
      code: 1,
      zip,
      error: 'Nothing was retrieved from the source org — the selected components were not found there. '
        + 'Make sure you browsed the correct source org.',
    };
  }
  return { code, zip };
}

/** Deploy (or validate) the retrieved metadata zip to the TARGET org. */
export async function deployToTarget({ retrieveDir, targetOrg, testLevel, tests = [], validate = false, wait = 60 }) {
  const args = buildOrgDeployArgs({
    zipPath: path.join(retrieveDir, RETRIEVE_ZIP),
    targetOrg,
    testLevel,
    tests,
    validate,
    wait,
  });
  return sf(args);
}
