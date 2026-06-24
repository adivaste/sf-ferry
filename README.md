# sfm — Salesforce Manifest Builder

Interactive CLI that lets you **search and select** local metadata components,
writes a correct `package.xml` / `destructiveChanges.xml` for you, and then
**deploys** them to any org with full control over the **test level** — exactly
like a real change-set / metadata deployment, but driven from the terminal and
without writing XML by hand.

It uses Salesforce's own resolver (`@salesforce/source-deploy-retrieve`, the same
library the `sf` CLI is built on), so member names for every metadata type
(fields as `Object.Field__c`, LWC bundles, in-folder metadata, etc.) come out
correct automatically.

## Install

```bash
cd sf-manifest-cli
npm install
npm link        # makes the `sfm` command available globally
```

Requires Node 18+ and the `sf` CLI (used for the deploy step).

## How it works

Your selection is stored in `manifest/.selection.json`. Every time you add,
delete, or remove components, the XML files are regenerated from that state:

| File | Purpose |
|------|---------|
| `manifest/package.xml` | components to add/update |
| `manifest/destructiveChanges.xml` | components to delete |
| `manifest/empty-package.xml` | empty package paired with destructive-only deploys |

## Workflow

Run these from inside your SFDX project (it auto-detects the package directory
and API version from `sfdx-project.json`).

```bash
# 1. Pick components to add/update (fuzzy search → multi-select)
sfm add

# 2. (optional) Pick components to delete
sfm delete                 # pick from local source
sfm delete --manual        # or type "ApexClass:OldCtrl, CustomField:Account.X__c"

# 3. Review what you've staged
sfm show

# 4. Un-stage something you added by mistake
sfm remove

# 5. Deploy (or validate) with a chosen test level
sfm deploy --target prod --test-level RunLocalTests
sfm deploy --target prod --check --test-level RunLocalTests        # validate only
sfm deploy --target prod --test-level RunSpecifiedTests -t MyTest OtherTest
sfm deploy                                                         # fully interactive
```

### Selecting components (two-level, live search)
Picking is intuitive and happens in two steps:

1. **Pick a metadata type** — a searchable list of every type present in your
   source, with counts and how many you've already staged
   (`ApexClass  (42) — 3 selected`). Type to filter the list, enter to open it.
2. **Pick the members** — a live-search checklist of that type's components:
   - **type** any text → the list filters as you go
   - **↑ / ↓** → move the highlight
   - **space** → check / uncheck
   - **enter** → confirm and go back to the type list
3. Choose another type, or pick **✔ Finish & save**.

Already-staged components show up **pre-checked**, so the same screen is used to
add *and* remove — just uncheck what you no longer want. This applies to `add`,
`delete`, and `remove`.

### Test levels (same as a real deployment)
- `NoTestRun` — sandbox/scratch only
- `RunSpecifiedTests` — prompts you to pick the test classes (or pass `-t`)
- `RunLocalTests` — all local tests (typical for production)
- `RunAllTestsInOrg`

`--check` runs a **validate-only** (check-only) deploy — nothing is committed,
exactly like "Validate" in the change-set UI. You can later quick-deploy the
validated build with the standard `sf project deploy quick` if you want.

## Commands

| Command | Description |
|---------|-------------|
| `sfm add` | search/select components for `package.xml` |
| `sfm delete [--manual]` | select components for `destructiveChanges.xml` |
| `sfm remove` | remove previously staged components |
| `sfm show` | print the current selection |
| `sfm build` | regenerate the XML from the saved selection |
| `sfm clear` | reset the selection |
| `sfm deploy` | deploy/validate against an org with a test level |

## Global options

| Option | Default |
|--------|---------|
| `-d, --source-dir <dir>` | from `sfdx-project.json`, else `force-app` |
| `-m, --manifest-dir <dir>` | `manifest` |
| `-a, --api-version <ver>` | from `sfdx-project.json`, else `62.0` |

## Migrating uat → prod (your use case)

1. Make sure your uat changes are in your local project source (`force-app/`).
2. `sfm add` and pick the components you changed.
3. `sfm delete` for anything removed in uat.
4. `sfm deploy --target prod --check --test-level RunLocalTests` to validate.
5. If it passes, drop `--check` to deploy for real.
