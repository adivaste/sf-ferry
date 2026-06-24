#!/usr/bin/env node
import path from 'node:path';
import { Command } from 'commander';
import { resolveProject } from '../src/config.js';
import { TEST_LEVELS, PACKAGE_FILE, DESTRUCTIVE_FILE } from '../src/constants.js';
import { loadState, saveState, mergeEntries } from '../src/state.js';

// NOTE: heavy modules (SDR ~2.3s, @salesforce/core ~1.8s, blessed, inquirer)
// are imported lazily inside the actions that need them, so light commands
// (--help, show, clear, orgs) start almost instantly.

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

async function scanLocal(sourceDir) {
  const { scanSource } = await import('../src/scan.js'); // pulls SDR
  process.stdout.write(`Scanning ${sourceDir} ...\n`);
  const items = scanSource(sourceDir);
  process.stdout.write(`Found ${items.length} components.\n`);
  return items;
}

async function regenerate(manifestDir, state) {
  saveState(manifestDir, state);
  const { writeManifests } = await import('../src/manifest.js'); // pulls SDR
  const written = await writeManifests(manifestDir, state);
  console.log(`\nUpdated: ${written.map((f) => path.join(manifestDir, f)).join(', ')}`);
  console.log(`Selection: ${state.changes.length} change(s), ${state.destructive.length} deletion(s).`);
}

program
  .command('add')
  .description('Search and select components to ADD/UPDATE (package.xml)')
  .action(async () => {
    const { sourceDir, apiVersion, manifestDir } = settings(program.opts());
    const items = await scanLocal(sourceDir);
    const state = loadState(manifestDir, apiVersion);
    const { pickComponents } = await import('../src/select.js');
    // Already-staged items start checked; the returned set replaces the bucket.
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
      const items = await scanLocal(sourceDir);
      const { pickComponents } = await import('../src/select.js');
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
    const { select } = await import('@inquirer/prompts');
    const bucket = await select({
      message: 'Edit which list?',
      choices: [
        { name: `changes (${state.changes.length})`, value: 'changes' },
        { name: `destructive (${state.destructive.length})`, value: 'destructive' },
      ],
    });
    const current = state[bucket];
    if (current.length === 0) return console.log('That list is already empty.');
    const { pickComponents } = await import('../src/select.js');
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

    const { buildDeployArgs, preflight, runSf } = await import('../src/deploy.js');

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
      || (await (async () => {
        const { select } = await import('@inquirer/prompts');
        return select({ message: 'Test level', choices: TEST_LEVELS.map((l) => ({ name: l, value: l })) });
      })());

    let tests = cmdOpts.tests || [];
    if (testLevel === 'RunSpecifiedTests' && tests.length === 0) {
      const items = await scanLocal(sourceDir);
      const { pickTestClasses } = await import('../src/select.js');
      tests = await pickTestClasses(items);
      if (tests.length === 0) {
        console.error('RunSpecifiedTests requires at least one test class.');
        process.exitCode = 1;
        return;
      }
    }

    const validate = Boolean(cmdOpts.check);
    const args = buildDeployArgs({
      manifestDir, target, validate, testLevel, tests, hasChanges, hasDestructive,
      wait: Number(cmdOpts.wait) || 60,
    });

    console.log(`\n${validate ? 'VALIDATING' : 'DEPLOYING'} -> ${target}`);
    console.log(`Test level: ${testLevel}${tests.length ? ` (${tests.join(', ')})` : ''}`);
    console.log(`> sf ${args.join(' ')}\n`);

    process.exitCode = await runSf(args);
  });

program
  .command('orgs')
  .description('List the orgs the sf CLI is authenticated to')
  .action(async () => {
    const { listOrgs } = await import('../src/org.js');
    const orgs = await listOrgs();
    if (orgs.length === 0) return console.log('No authenticated orgs. Run `sf org login web` first.');
    for (const o of orgs) {
      const alias = o.aliases?.length ? `${o.aliases.join(', ')}` : '(no alias)';
      console.log(`  ${alias.padEnd(20)} ${o.username}${o.isExpired ? '  [EXPIRED]' : ''}`);
    }
  });

program
  .command('ui')
  .description('Live, change-set-style metadata selector (org → org)')
  .option('-s, --source <org>', 'source org to browse (alias or username)')
  .option('-o, --target <org>', 'target org to deploy to')
  .option('--demo', 'run with fixture data, no org connection')
  .action(async (cmdOpts) => {
    const { apiVersion, manifestDir } = settings(program.opts());
    const retrieveDir = path.resolve('.sfm-retrieve');

    const { createStore, setTypes, setComponents } = await import('../src/store.js');

    let store;
    let loadInto;
    let orgChoices = [];

    if (cmdOpts.demo) {
      const { DEMO_TYPES, DEMO_COMPONENTS } = await import('../src/demo.js');
      store = createStore({ sourceOrg: 'DEMO', targetOrg: cmdOpts.target || 'DEMO-prod' });
      setTypes(store, DEMO_TYPES);
      loadInto = async (type) => { setComponents(store, type, DEMO_COMPONENTS[type] || []); };
    } else {
      console.log('Loading Salesforce libraries …');
      const { listOrgs, connect, orgLabel } = await import('../src/org.js'); // pulls @salesforce/core
      const { describeTypes, listComponents, FOLDER_TYPES } = await import('../src/metadata.js');

      const source = cmdOpts.source
        || (await (async () => {
          const orgs = await listOrgs();
          if (orgs.length === 0) throw new Error('No authenticated orgs. Run `sf org login web`.');
          const { select } = await import('@inquirer/prompts');
          return select({
            message: 'Source org to browse',
            choices: orgs.map((o) => ({ name: orgLabel(o), value: o.aliases?.[0] || o.username })),
          });
        })());

      console.log(`Connecting to ${source} …`);
      const conn = await connect(source);
      console.log('Describing metadata types …');
      const types = (await describeTypes(conn, apiVersion)).filter((t) => !FOLDER_TYPES.has(t.name));

      store = createStore({ sourceOrg: source, targetOrg: cmdOpts.target || '' });
      setTypes(store, types);

      const all = await listOrgs();
      orgChoices = all
        .filter((o) => (o.aliases?.[0] || o.username) !== source)
        .map((o) => ({ label: orgLabel(o), value: o.aliases?.[0] || o.username }));

      loadInto = async (type, { refresh = false } = {}) => {
        const rows = await listComponents(conn, type, { apiVersion, orgKey: source, refresh });
        setComponents(store, type, rows);
      };
    }

    // Detach any stdin listeners left by the inquirer source-org prompt so
    // blessed is the sole keypress consumer (otherwise keys fire twice).
    try {
      process.stdin.removeAllListeners('keypress');
      process.stdin.removeAllListeners('data');
      process.stdin.removeAllListeners('readable');
      if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(false);
      process.stdin.pause();
    } catch { /* ignore */ }

    const { runTui } = await import('../src/tui.js'); // pulls blessed
    const result = await runTui({ store, loadComponents: loadInto, orgs: orgChoices });

    // blessed leaves the terminal in raw mode on exit — restore cooked mode so
    // the streamed `sf` output (and any later prompt) behaves normally.
    try {
      if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(false);
      process.stdin.resume();
    } catch { /* ignore */ }

    // The live org Connection keeps a socket open, so the process won't exit on
    // its own after blessed closes — exit explicitly for a clean shutdown.
    if (result.action === 'quit') process.exit(0);

    if (result.action === 'build') {
      const { writeManifests } = await import('../src/manifest.js'); // pulls SDR — deferred until now
      await writeManifests(manifestDir, { apiVersion, changes: result.entries, destructive: [] });
      console.log(`\nWrote ${path.join(manifestDir, PACKAGE_FILE)} (${result.entries.length} components).`);
      process.exit(0);
    }

    if (cmdOpts.demo) {
      console.log('\n[demo] Would now:');
      console.log(`  1. write package.xml (${result.entries.length} components)`);
      console.log(`  2. sf project retrieve start  (from ${store.sourceOrg})`);
      console.log(`  3. sf project deploy ${result.action === 'validate' ? 'validate' : 'start'}  -> ${result.targetOrg}  test-level ${result.testLevel}`);
      process.exit(0);
    }

    if (!result.targetOrg) {
      console.error('No target org chosen (press "t" in the UI, or pass --target).');
      process.exit(1);
    }

    // Test classes for RunSpecifiedTests are now collected inside the TUI
    // (avoids handing stdin to a prompt after blessed, which broke input).
    const tests = result.tests || [];
    if (result.testLevel === 'RunSpecifiedTests' && tests.length === 0) {
      console.error('RunSpecifiedTests requires at least one test class.');
      process.exit(1);
    }

    const { retrieveFromSource, deployToTarget } = await import('../src/orgflow.js'); // pulls SDR

    console.log(`\n1/2  Retrieving ${result.entries.length} components from ${store.sourceOrg} …`);
    const r = await retrieveFromSource({
      manifestDir, retrieveDir, sourceOrg: store.sourceOrg, entries: result.entries, apiVersion,
    });
    if (r.code !== 0) { console.error(`\n${r.error || 'Retrieve failed.'}`); process.exit(r.code); }

    console.log(`\n2/2  ${result.action === 'validate' ? 'Validating' : 'Deploying'} to ${result.targetOrg} (test-level ${result.testLevel}) …`);
    const deployCode = await deployToTarget({
      retrieveDir,
      targetOrg: result.targetOrg,
      testLevel: result.testLevel,
      tests,
      validate: result.action === 'validate',
    });
    process.exit(deployCode);
  });

program.parseAsync(process.argv);
