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

---

## `sfm ui` — change-set-style selector (v2, live org → org)

A full-screen terminal UI for migrating metadata between orgs (e.g. **uat → prod**)
without change sets. Modeled on Gearset / the VS Code Org Browser.

```bash
sfm ui --source uat --target prod     # live: browse uat, deploy to prod
sfm ui --demo                         # try it with fixture data, no org needed
```

```
 sfm  source: uat  →  target: prod   test-level: RunLocalTests   selected: 12
┌ Types ─────┐┌ Filter (/) ───────────┐┌ Selected ───────────┐
│❯ ApexClass ││ acc                   ││ ApexClass (8)        │
│  (12)✓     │└───────────────────────┘│  • AccountController │
│  ApexTrigger│┌ Components ───────────┐│  • LeadService       │
│  CustomObj ││ [x] Name ▲ │ Mod By │…││ LWC (2)              │
│  LWC  (2)✓ ││ [x] AccountController …││  • invoiceList       │
└────────────┘└───────────────────────┘└──────────────────────┘
 ↑↓ move  enter open type  space check  a all  c clear  / filter  1-4 sort  t target  l test-level
 b build package.xml   v validate   d deploy   q quit
```

**Why live (not local files):** the columns you actually want to sort by —
**owner, created date, last modified** — only exist in the org's Metadata API
(`listMetadata` → `FileProperties`). Local source files don't carry them. So the
UI reads live metadata from the source org (reusing your existing `sf` login),
**caches** it under `.sfm-cache/` (Refresh with `r`), and on deploy it retrieves
the selected components from the source org and deploys them to the target —
true org-to-org migration, no local project required.

| Key | Action |
|-----|--------|
| `↑ ↓` / `j k` | move within a pane |
| `PgUp PgDn` / `g G` | page / jump to top / bottom of the list |
| `enter` | open the highlighted type (loads its components) |
| `space` | check / uncheck the highlighted component |
| `a` / `c` | select-all / clear (respects the current filter) |
| `/` | focus the filter box (searches name + owner) |
| `1`–`4` | sort by column; press again to reverse (or click the header) |
| `t` | choose the target org · `l` cycle the test level |
| `Ctrl+B` / `Alt+B` | hide/show the left (Types) / right (Selected) panel to widen the table |
| `?` | full keybinding help overlay |

Filtering highlights the matched letters (fzf-style), a spinner shows while a
type loads, and the footer shows the keys relevant to the focused pane.
| `r` | refresh the current type from the org (bypass cache) |
| `b` | write `package.xml` only · `v` validate · `d` deploy · `q` quit |

`v` (validate) and `d` (deploy) hand off to the `sf` CLI after the UI closes, so
deploy output streams normally. `RunSpecifiedTests` prompts for the test classes.

> Manage orgs with `sfm orgs` (lists everything `sf` is logged into).

### Import from an existing package / change set

Already have a `package.xml` or a metadata `.zip` (e.g. an exported change set)?
Pre-select all of its components in the source org:

```bash
sfm ui --source uat --import path/to/package.xml
sfm ui --source uat --import path/to/changeset.zip   # reads package.xml inside
```

It reads the manifest, checks those components in the grid (the splash shows
`Imported N component(s) from …`), and you review/adjust before deploying.
Wildcard members (`<members>*</members>`) can't be expanded to specific picks,
so those types are skipped with a note — open the type and press `a` to select
all if you want them.

### Saved selections (history) — press `s`

Selections are **not** auto-restored (no surprises on launch). Instead, every
time you act or quit, the current selection (+ target + test level) is
checkpointed to a deduped **history (last 20 per org)**. In the UI press **`s`**
to pick a past selection and load it back — handy after a failed deploy. See
everything with `sfm status`.

### State lives in `~/.sfm` (global)

All cross-project state is under `~/.sfm/` (override with `SFM_HOME`), keyed by
org **username**, so it follows you regardless of which folder you run from:
`~/.sfm/cache/<org>/…`, `~/.sfm/sessions/<org>.json`, `~/.sfm/retrieve/<org>/…`.
The metadata cache never auto-expires — the Components pane shows
`fetched Xh ago` and `r` re-pulls. Inspect with **`sfm status`**, wipe with
**`sfm clean`** (`--all` also clears saved sessions). Defaults can be set in
`~/.sfm/config.json` (`apiVersion`, `defaultTestLevel`). The only thing written
into your project is the `package.xml` from `b`/deploy (in `./manifest`).

### Performance

Built for responsiveness on large orgs:

- **Lazy module loading.** The heavy libraries (`@salesforce/source-deploy-retrieve` ~2.3 s and `@salesforce/core` ~1.8 s to import) load only when a command actually needs them. Light commands (`--help`, `status`, `orgs`*) start in ~0.1–0.25 s instead of ~4.4 s. SDR is deferred during `ui` until you actually deploy. (*`orgs`/`ui` still pay the one-time `@salesforce/core` connect cost.)
- **Lazy, cached metadata.** `ui` makes one `describeMetadata` call for the type list, then one `listMetadata` call per type **only when you open it**, cached under `~/.sfm/cache/` (press `r` to refresh). Component source is never downloaded while browsing — only the selected components are retrieved, at deploy time.
- **True virtualization (fzf-style).** The component list renders only the rows visible in the viewport (~the window height), not the whole dataset. The full filtered+sorted array is computed once per filter/sort/type change and cached; scrolling is pure array-slicing. Measured: **600+ scroll renders over a 50,000-row type in ~0.6 s** (~1 ms/render). The filter is debounced and each action is a single repaint.
- **All metadata types.** The type list includes both top-level types and **child types** (CustomField, ValidationRule, RecordType, WebLink, ListView, FieldSet, CompactLayout, …) — everything listable that appears in a change set.

---

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

1. **Pick a metadata type** — a list of every type in the org (including child
   types like CustomField). **Just start typing** to filter it like a picklist
   (e.g. type `trig` → `ApexTrigger`); backspace edits, `esc` clears. `↑↓` move,
   `enter` opens the highlighted type.
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
- `NoTestRun` — **deploy only** (e.g. metadata with no Apex, like a Custom Notification Type). `sf` rejects it for *validate*, so a `NoTestRun` validate automatically runs as a check-only `deploy --dry-run`.
- `RunSpecifiedTests` — prompts you to pick the test classes (or pass `-t`)
- `RunLocalTests` — all local tests (typical for production)
- `RunAllTestsInOrg`
- `RunRelevantTests` (Beta) — only tests relevant to the changed classes

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
