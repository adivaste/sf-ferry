import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  DESTRUCTIVE_FILE,
  EMPTY_PACKAGE_FILE,
  PACKAGE_FILE,
  TEST_LEVELS,
} from './constants.js';

// deploy.js stays light (no SDR/core) — re-export for back-compat.
export { TEST_LEVELS };

/**
 * Build the argument list for `sf project deploy <validate|start>`.
 * Exported (and pure) so it can be unit-tested without spawning sf.
 */
export function buildDeployArgs({
  manifestDir,
  target,
  validate,
  testLevel,
  tests = [],
  hasChanges,
  hasDestructive,
  wait = 60,
}) {
  const args = ['project', 'deploy', validate ? 'validate' : 'start'];

  // Pair an empty package.xml with destructive-only deploys.
  const manifestFile = hasChanges ? PACKAGE_FILE : EMPTY_PACKAGE_FILE;
  args.push('--manifest', path.join(manifestDir, manifestFile));

  if (hasDestructive) {
    args.push('--post-destructive-changes', path.join(manifestDir, DESTRUCTIVE_FILE));
  }

  if (target) args.push('--target-org', target);

  args.push('--test-level', testLevel);
  if (testLevel === 'RunSpecifiedTests') {
    for (const t of tests) args.push('--tests', t);
  }

  args.push('--wait', String(wait));
  args.push('--verbose');
  return args;
}

export function preflight({ manifestDir, hasChanges, hasDestructive }) {
  const problems = [];
  const required = [hasChanges ? PACKAGE_FILE : EMPTY_PACKAGE_FILE];
  if (hasDestructive) required.push(DESTRUCTIVE_FILE);
  for (const f of required) {
    if (!existsSync(path.join(manifestDir, f))) {
      problems.push(`missing ${f} — run "sfm build" first`);
    }
  }
  if (!hasChanges && !hasDestructive) {
    problems.push('selection is empty — add components first');
  }
  return problems;
}

/** Spawn the real sf CLI, streaming its output to the user. */
export function runSf(args) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'sf.cmd' : 'sf';
    const child = spawn(cmd, args, { stdio: 'inherit', shell: isWin });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}
