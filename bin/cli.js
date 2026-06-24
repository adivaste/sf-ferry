#!/usr/bin/env node
import path from 'node:path';
import { Command } from 'commander';
import { select } from '@inquirer/prompts';
import { resolveProject } from '../src/config.js';
import { scanSource } from '../src/scan.js';
import { pickComponents, pickTestClasses } from '../src/select.js';
import {
  DESTRUCTIVE_FILE,
  PACKAGE_FILE,
  loadState,
  mergeEntries,
  saveState,
  writeManifests,
} from '../src/manifest.js';
import {
  TEST_LEVELS,
  buildDeployArgs,
  preflight,
  runSf,
} from '../src/deploy.js';

const program = new Command();

program
  .name('sfm')
  .description('Build Salesforce package.xml / destructiveChanges.xml interactively, then deploy.')
  .option('-d, --source-dir <dir>', 'metadata source dir (default: from sfdx-project.json or force-app)')
  .option('-m, --manifest-dir <dir>', 'where manifests are written', 'manifest')
  .option('-a, --api-version <ver>', 'API version (default: from sfdx-project.json)');

/** Resolve effective settings from global flags + project autodetect. */
function settings(opts) {
  const project = resolveProject();
  const sourceDir = opts.sourceDir ? path.resolve(opts.sourceDir) : project.sourceDir;
  const apiVersion = opts.apiVersion || project.apiVersion;
  const manifestDir = path.resolve(opts.manifestDir || 'manifest');
  return { sourceDir, apiVersion, manifestDir };
}

function loadComponents(sourceDir) {
  process.stdout.write(`Scanning ${sourceDir} ...\n`);
  const items = scanSource(sourceDir);
  process.stdout.write(`Found ${items.length} components.\n`);
  return items;
}

async function regenerate(manifestDir, state) {
  saveState(manifestDir, state);
  const written = await writeManifests(manifestDir, state);
  console.log(`\nUpdated: ${written.map((f) => path.join(manifestDir, f)).join(', ')}`);
  console.log(`Selection: ${state.changes.length} change(s), ${state.destructive.length} deletion(s).`);
}

program
  .command('add')
  .description('Search and select components to ADD/UPDATE (package.xml)')
  .action(async () => {
    const { sourceDir, apiVersion, manifestDir } = settings(program.opts());
    const items = loadComponents(sourceDir);
    const state = loadState(manifestDir, apiVersion);
    // Already-staged items start checked; the returned set replaces the bucket,
    // so unchecking here removes them too.
    const picked = await pickComponents(items, {
      message: 'package.xml (add / update)',
      preselected: state.changes,
    });
    state.changes = picked;
    await regenerate(manifestDir, state);
  });

program
  .command('delete')
  .description('Select components to DELETE (destructiveChanges.xml)')
  .option('--manual', 'type Type:Name entries instead of picking from local source')
  .action(async (cmdOpts) => {
    const { sourceDir, apiVersion, manifestDir } = settings(program.opts());
    const state = loadState(manifestDir, apiVersion);
    let picked;
    if (cmdOpts.manual) {
      const { input } = await import('@inquirer/prompts');
      const raw = await input({
        message: 'Entries to delete, comma-separated as Type:FullName\n  (e.g. ApexClass:OldCtrl, CustomField:Account.Legacy__c):',
      });
      picked = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const idx = s.indexOf(':');
          return { type: s.slice(0, idx), fullName: s.slice(idx + 1) };
        });
      state.destructive = mergeEntries(state.destructive, picked);
    } else {
      const items = loadComponents(sourceDir);
      // Pre-check already-staged deletions; returned set replaces the bucket.
      picked = await pickComponents(items, {
        message: 'destructiveChanges.xml (delete)',
        preselected: state.destructive,
      });
      state.destructive = picked;
    }
    await regenerate(manifestDir, state);
  });

program
  .command('remove')
  .description('Review staged components and uncheck the ones to drop')
  .action(async () => {
    const { apiVersion, manifestDir } = settings(program.opts());
    const state = loadState(manifestDir, apiVersion);
    const bucket = await select({
      message: 'Edit which list?',
      choices: [
        { name: `changes (${state.changes.length})`, value: 'changes' },
        { name: `destructive (${state.destructive.length})`, value: 'destructive' },
      ],
    });
    const current = state[bucket];
    if (current.length === 0) return console.log('That list is already empty.');
    // Everything staged starts checked — uncheck to drop, then save.
    const picked = await pickComponents(current, {
      message: `${bucket}: uncheck the ones to remove`,
      preselected: current,
    });
    state[bucket] = picked;
    await regenerate(manifestDir, state);
  });

program
  .command('show')
  .description('Show the current selection and manifest paths')
  .action(() => {
    const { apiVersion, manifestDir } = settings(program.opts());
    const state = loadState(manifestDir, apiVersion);
    console.log(`API version: ${state.apiVersion}`);
    console.log(`\n# Changes (${PACKAGE_FILE}) — ${state.changes.length}`);
    for (const e of state.changes) console.log(`  ${e.type}: ${e.fullName}`);
    console.log(`\n# Deletions (${DESTRUCTIVE_FILE}) — ${state.destructive.length}`);
    for (const e of state.destructive) console.log(`  ${e.type}: ${e.fullName}`);
    console.log(`\nManifest dir: ${manifestDir}`);
  });

program
  .command('build')
  .description('Re-write the XML manifests from the saved selection')
  .action(async () => {
    const { apiVersion, manifestDir } = settings(program.opts());
    const state = loadState(manifestDir, apiVersion);
    await regenerate(manifestDir, state);
  });

program
  .command('clear')
  .description('Reset the selection (does not delete generated XML)')
  .action(async () => {
    const { apiVersion, manifestDir } = settings(program.opts());
    await regenerate(manifestDir, { apiVersion, changes: [], destructive: [] });
  });

program
  .command('deploy')
  .description('Deploy (or validate) the built manifests against a target org with a chosen test level')
  .option('-o, --target <org>', 'target org username or alias (e.g. prod, sandbox)')
  .option('-l, --test-level <level>', `one of: ${TEST_LEVELS.join(', ')}`)
  .option('-t, --tests <names...>', 'test classes for RunSpecifiedTests')
  .option('--check', 'validate only (check-only deploy), do not commit')
  .option('-w, --wait <min>', 'minutes to wait', '60')
  .action(async (cmdOpts) => {
    const { sourceDir, apiVersion, manifestDir } = settings(program.opts());
    const state = loadState(manifestDir, apiVersion);
    const hasChanges = state.changes.length > 0;
    const hasDestructive = state.destructive.length > 0;

    const problems = preflight({ manifestDir, hasChanges, hasDestructive });
    if (problems.length) {
      console.error('Cannot deploy:');
      for (const p of problems) console.error(`  - ${p}`);
      process.exitCode = 1;
      return;
    }

    const target = cmdOpts.target
      || (await (async () => {
        const { input } = await import('@inquirer/prompts');
        return input({ message: 'Target org (username or alias):' });
      })());

    const testLevel = cmdOpts.testLevel
      || (await select({
        message: 'Test level',
        choices: TEST_LEVELS.map((l) => ({ name: l, value: l })),
      }));

    let tests = cmdOpts.tests || [];
    if (testLevel === 'RunSpecifiedTests' && tests.length === 0) {
      const items = loadComponents(sourceDir);
      tests = await pickTestClasses(items);
      if (tests.length === 0) {
        console.error('RunSpecifiedTests requires at least one test class.');
        process.exitCode = 1;
        return;
      }
    }

    const validate = Boolean(cmdOpts.check);
    const args = buildDeployArgs({
      manifestDir,
      target,
      validate,
      testLevel,
      tests,
      hasChanges,
      hasDestructive,
      wait: Number(cmdOpts.wait) || 60,
    });

    console.log(`\n${validate ? 'VALIDATING' : 'DEPLOYING'} -> ${target}`);
    console.log(`Test level: ${testLevel}${tests.length ? ` (${tests.join(', ')})` : ''}`);
    console.log(`> sf ${args.join(' ')}\n`);

    const code = await runSf(args);
    process.exitCode = code;
  });

program.parseAsync(process.argv);
