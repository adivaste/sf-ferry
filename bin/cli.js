#!/usr/bin/env node
import path from 'node:path';
import { Command } from 'commander';
import { resolveProject } from '../src/config.js';
import { loadConfig } from '../src/userconfig.js';
import { PACKAGE_FILE } from '../src/constants.js';

// Heavy modules (SDR, @salesforce/core, blessed) are imported lazily inside the
// actions that need them, so `--help` / `orgs` start almost instantly.

const program = new Command();

program
  .name('ferry')
  .description('Live, change-set-style Salesforce metadata migrator (org → org).')
  .option('-m, --manifest-dir <dir>', 'where package.xml is written', 'manifest')
  .option('-a, --api-version <ver>', 'API version (default: from sfdx-project.json or 62.0)');

function settings(opts) {
  const cfg = loadConfig(); // ~/.ferry/config.json
  const project = resolveProject();
  const apiVersion = opts.apiVersion || cfg.apiVersion || project.apiVersion;
  const manifestDir = path.resolve(opts.manifestDir || 'manifest');
  return { apiVersion, manifestDir, defaultTestLevel: cfg.defaultTestLevel || null };
}

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
  .command('go', { isDefault: true })
  .aliases(['deploy', 'ui', 'board'])
  .description('Launch the live selector → validate/deploy (this is the default — just run `ferry`)')
  .option('-s, --source <org>', 'source org to browse (alias or username)')
  .option('-o, --target <org>', 'target org to deploy to')
  .option('--import <file>', 'pre-select components from an existing package.xml or metadata .zip')
  .option('--refetch', 're-retrieve from the source org even if a matching zip is cached')
  .option('--demo', 'run with fixture data, no org connection')
  .action(async (cmdOpts) => {
    const { apiVersion, manifestDir, defaultTestLevel } = settings(program.opts());
    const { retrieveDir: retrievePath } = await import('../src/paths.js');

    const { createStore, setTypes, setComponents, setSelection } = await import('../src/store.js');
    const { listSessions, addSession } = await import('../src/session.js');
    const store = createStore({ sourceOrg: '', targetOrg: cmdOpts.target || '' });
    const orgKey = () => store.sourceUsername || store.sourceOrg;
    let prepare;
    let seedNote = null; // splash line describing an imported selection

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
        const { startSpinner } = await import('../src/cli-ui.js');
        const stop = startSpinner('Loading your authenticated orgs …');
        const { listOrgs, orgLabel } = await import('../src/org.js'); // pulls @salesforce/core (~1.8s)
        const orgs = await listOrgs();
        stop();
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
        const username = conn.getUsername() || source;
        store.sourceUsername = username;
        step.done(`Connected to ${username}`);
        step.begin('Describing metadata types …');
        const types = (await describeTypes(conn, apiVersion)).filter((t) => !FOLDER_TYPES.has(t.name));
        step.done(`Found ${types.length} metadata types`);
        if (seedNote) { step.begin(seedNote); step.done(); }
        const all = await listOrgs();
        const orgs = all
          .filter((o) => (o.aliases?.[0] || o.username) !== source)
          .map((o) => ({ label: orgLabel(o), value: o.aliases?.[0] || o.username }));
        const loadComponents = async (type, { refresh = false } = {}) => {
          const { rows, fetchedAt } = await listComponents(conn, type, { apiVersion, orgKey: username, refresh });
          setComponents(store, type, rows, fetchedAt);
        };
        return { types, loadComponents, orgs };
      };
    }

    // --import pre-selects from a package.xml/zip. Past sessions are NOT
    // auto-restored — press R in the UI to pick one from the history.
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
    const result = await runTui({
      store,
      prepare,
      initialTestLevel: defaultTestLevel,
      onListSessions: () => listSessions(orgKey()),
    });

    // Checkpoint the selection to history on a real action, so a failed deploy
    // can be picked back up later via the R picker.
    if (result.action !== 'quit' && (result.entries || []).length) {
      addSession(orgKey(), { entries: result.entries, targetOrg: result.targetOrg || store.targetOrg, testLevel: result.testLevel });
    }

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
    const retrieveDir = retrievePath(orgKey());
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
      console.error(c.gray(`Your selection is saved — run "ferry ui" again to retry (it'll be pre-checked).`));
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
      console.error(c.gray(`Your selection is saved — run "ferry ui" again to retry (it'll be pre-checked).`));
    }
    process.exit(deployCode);
  });

program
  .command('status')
  .description('Show ferry cached state: saved sessions, metadata cache, retrieve zips')
  .action(async () => {
    const { gatherStatus } = await import('../src/status.js');
    const { ago, c } = await import('../src/cli-ui.js');
    const s = gatherStatus();
    console.log(`${c.bold('ferry state')}  ${c.gray(s.home)}\n`);
    console.log(c.cyan('Saved sessions') + c.gray('  (press s in the UI to load one)'));
    if (!s.sessions.length) console.log('  (none)');
    for (const x of s.sessions) console.log(`  ${x.org.padEnd(38)} ${String(x.count).padStart(2)} saved · newest ${ago(x.newest)}`);
    console.log(`\n${c.cyan('Metadata cache')}${c.gray('  (press r in the UI to refresh a type)')}`);
    if (!s.cache.length) console.log('  (none)');
    for (const x of s.cache) console.log(`  ${x.org.padEnd(38)} ${String(x.types).padStart(3)} types · newest ${ago(x.newest)}`);
    console.log(`\n${c.cyan('Retrieve zips')}`);
    if (!s.retrieve.length) console.log('  (none)');
    for (const x of s.retrieve) console.log(`  ${x.org.padEnd(38)} ${x.sizeKb} KB · ${ago(x.at)}`);
    console.log(`\n${c.gray('ferry clean        remove cache + retrieve (keeps sessions)')}`);
    console.log(c.gray('ferry clean --all  remove everything under ~/.ferry'));
  });

program
  .command('clean')
  .description('Remove ferry cached state (cache + retrieve; --all also removes saved sessions)')
  .option('--all', 'also remove saved sessions (everything under ~/.ferry)')
  .option('-y, --yes', 'skip the confirmation prompt')
  .action(async (cmdOpts) => {
    const { ferryHome } = await import('../src/paths.js');
    const { rm } = await import('node:fs/promises');
    const home = ferryHome();
    const targets = cmdOpts.all
      ? [home]
      : [path.join(home, 'cache'), path.join(home, 'retrieve')];
    console.log('Will remove:');
    for (const t of targets) console.log(`  ${t}`);
    if (!cmdOpts.yes) {
      const { confirm } = await import('@inquirer/prompts');
      const go = await confirm({
        message: cmdOpts.all ? 'Remove ALL ferry state, including saved sessions?' : 'Remove cache + retrieve zips?',
        default: false,
      });
      if (!go) return console.log('Cancelled.');
    }
    for (const t of targets) await rm(t, { recursive: true, force: true });
    console.log('Done.');
  });

program.parseAsync(process.argv);
