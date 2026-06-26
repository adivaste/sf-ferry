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
  .option('--import <file>', 'pre-select components from an existing package.xml or metadata .zip')
  .option('--refetch', 're-retrieve from the source org even if a matching zip is cached')
  .option('--demo', 'run with fixture data, no org connection')
  .action(async (cmdOpts) => {
    const { apiVersion, manifestDir } = settings(program.opts());
    const retrieveDir = path.resolve('.sfm-retrieve');

    const { createStore, setTypes, setComponents, setSelection } = await import('../src/store.js');
    const { loadSession, saveSession } = await import('../src/session.js');
    const store = createStore({ sourceOrg: '', targetOrg: cmdOpts.target || '' });
    let prepare;
    let seedNote = null; // splash line describing imported/restored selection
    let initialTestLevel = null;

    if (cmdOpts.demo) {
      store.sourceOrg = 'DEMO';
      store.targetOrg = cmdOpts.target || 'DEMO-prod';
      prepare = async (step) => {
        step.begin('Loading demo data …');
        const { DEMO_TYPES, DEMO_COMPONENTS } = await import('../src/demo.js');
        step.done('Demo data ready');
        if (seedNote) { step.begin(seedNote); step.done(); }
        return {
          types: DEMO_TYPES,
          loadComponents: async (type) => { setComponents(store, type, DEMO_COMPONENTS[type] || []); },
          orgs: [],
        };
      };
    } else {
      // Source org is chosen BEFORE blessed (it needs an inquirer prompt when
      // --source isn't given); the slow connect+describe happens under the splash.
      let source = cmdOpts.source;
      if (!source) {
        const { listOrgs, orgLabel } = await import('../src/org.js');
        const orgs = await listOrgs();
        if (orgs.length === 0) { console.error('No authenticated orgs. Run `sf org login web`.'); process.exit(1); }
        const { select } = await import('@inquirer/prompts');
        source = await select({
          message: 'Source org to browse',
          choices: orgs.map((o) => ({ name: orgLabel(o), value: o.aliases?.[0] || o.username })),
        });
      }
      store.sourceOrg = source;
      prepare = async (step) => {
        step.begin('Loading Salesforce libraries …');
        const { connect, listOrgs, orgLabel } = await import('../src/org.js'); // pulls @salesforce/core
        const { describeTypes, listComponents, FOLDER_TYPES } = await import('../src/metadata.js');
        step.done('Loaded libraries');
        step.begin(`Connecting to ${source} …`);
        const conn = await connect(source);
        step.done(`Connected to ${source}`);
        step.begin('Describing metadata types …');
        const types = (await describeTypes(conn, apiVersion)).filter((t) => !FOLDER_TYPES.has(t.name));
        step.done(`Found ${types.length} metadata types`);
        if (seedNote) { step.begin(seedNote); step.done(); }
        const all = await listOrgs();
        const orgs = all
          .filter((o) => (o.aliases?.[0] || o.username) !== source)
          .map((o) => ({ label: orgLabel(o), value: o.aliases?.[0] || o.username }));
        const loadComponents = async (type, { refresh = false } = {}) => {
          const rows = await listComponents(conn, type, { apiVersion, orgKey: source, refresh });
          setComponents(store, type, rows);
        };
        return { types, loadComponents, orgs };
      };
    }

    // Seed the selection: --import (a package.xml/zip) takes precedence;
    // otherwise restore the last session for this source org.
    if (cmdOpts.import) {
      try {
        const { importPackage } = await import('../src/import-manifest.js');
        const { entries, wildcards } = await importPackage(path.resolve(cmdOpts.import));
        setSelection(store, entries);
        seedNote = `Imported ${entries.length} component(s) from ${path.basename(cmdOpts.import)}`
          + (wildcards.length ? ` · skipped ${wildcards.length} '*' type(s)` : '');
      } catch (e) {
        console.error(`Could not import ${cmdOpts.import}: ${e.message}`);
        process.exit(1);
      }
    } else {
      const session = loadSession(store.sourceOrg);
      if (session && (session.entries || []).length) {
        setSelection(store, session.entries);
        if (!cmdOpts.target && session.targetOrg) store.targetOrg = session.targetOrg;
        initialTestLevel = session.testLevel || null;
        seedNote = `Restored ${session.entries.length} staged component(s) from last session`;
      }
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
    const result = await runTui({ store, prepare, initialTestLevel });

    // Persist the selection (+ last target/test level) for next time, regardless
    // of the action — so quitting or a failed deploy keeps everything staged.
    saveSession(store.sourceOrg, {
      entries: result.entries || [],
      targetOrg: result.targetOrg || store.targetOrg,
      testLevel: result.testLevel,
    });

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
    const { actionBanner, step, resultBox, fmtElapsed, c } = await import('../src/cli-ui.js');
    const t0 = Date.now();
    const elapsed = () => fmtElapsed(Date.now() - t0);

    console.log(actionBanner({
      action: result.action,
      source: store.sourceOrg,
      target: result.targetOrg,
      count: result.entries.length,
      testLevel: result.testLevel,
    }));

    console.log(step(1, 2, `Retrieving ${result.entries.length} components from ${c.yellow(store.sourceOrg)} …`));
    const r = await retrieveFromSource({
      manifestDir, retrieveDir, sourceOrg: store.sourceOrg, entries: result.entries, apiVersion, refetch: cmdOpts.refetch,
    });
    if (r.reused) console.log(c.gray('      ↳ reused the cached zip (selection unchanged) — pass --refetch to re-pull'));
    if (r.code !== 0) {
      console.error(resultBox({ ok: false, label: r.error || 'Retrieve failed' }));
      console.error(c.gray(`Your selection is saved — run "sfm ui" again to retry (it'll be pre-checked).`));
      process.exit(r.code);
    }

    const verb = result.action === 'validate' ? 'Validating' : 'Deploying';
    console.log(step(2, 2, `${verb} to ${c.yellow(result.targetOrg)} (${result.testLevel}) …`));
    const deployCode = await deployToTarget({
      retrieveDir,
      targetOrg: result.targetOrg,
      testLevel: result.testLevel,
      tests,
      validate: result.action === 'validate',
    });

    const past = result.action === 'validate' ? 'Validated' : 'Deployed';
    console.log(resultBox({
      ok: deployCode === 0,
      label: deployCode === 0
        ? `${past} · ${result.entries.length} components · ${elapsed()}`
        : `${result.action === 'validate' ? 'Validation' : 'Deploy'} failed · see output above · ${elapsed()}`,
    }));
    if (deployCode !== 0) {
      console.error(c.gray(`Your selection is saved — run "sfm ui" again to retry (it'll be pre-checked).`));
    }
    process.exit(deployCode);
  });

program.parseAsync(process.argv);
