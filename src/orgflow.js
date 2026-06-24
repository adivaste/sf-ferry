import { spawn } from 'node:child_process';
import path from 'node:path';
import { PACKAGE_FILE, TEST_LEVELS } from './constants.js';
import { writeManifests } from './manifest.js';

export { TEST_LEVELS };

function sf(args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const child = spawn(isWin ? 'sf.cmd' : 'sf', args, {
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      shell: isWin,
    });
    let out = '';
    if (capture) child.stdout.on('data', (d) => (out += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
  });
}

/**
 * Write package.xml from the selection, then retrieve those components from the
 * SOURCE org into `retrieveDir` (org-to-org migration step).
 */
export async function retrieveFromSource({ manifestDir, retrieveDir, sourceOrg, entries, apiVersion }) {
  await writeManifests(manifestDir, { apiVersion, changes: entries, destructive: [] });
  const args = [
    'project', 'retrieve', 'start',
    '--manifest', path.join(manifestDir, PACKAGE_FILE),
    '--target-org', sourceOrg,
    '--output-dir', retrieveDir,
  ];
  const { code } = await sf(args);
  return code;
}

/**
 * Deploy (or validate) the retrieved source to the TARGET org with a test level.
 */
export async function deployToTarget({
  retrieveDir,
  targetOrg,
  testLevel,
  tests = [],
  validate = false,
  wait = 60,
}) {
  const args = [
    'project', 'deploy', validate ? 'validate' : 'start',
    '--source-dir', retrieveDir,
    '--target-org', targetOrg,
    '--test-level', testLevel,
  ];
  if (testLevel === 'RunSpecifiedTests') for (const t of tests) args.push('--tests', t);
  args.push('--wait', String(wait), '--verbose');
  const { code } = await sf(args);
  return code;
}
