# ⚓ Ferry — Salesforce metadata migrator (org → org)

Ferry is a live, **change-set-style** terminal tool for moving Salesforce
metadata between orgs (e.g. **uat → prod**) without change sets. Browse a source
org in a fast full-screen UI, pick components, then validate/deploy to a target
with full test-level control. It reuses your existing `sf` logins and reads live
metadata (owner · last modified · created) via the Metadata API.

---

## `ferry` — change-set-style selector (v2, live org → org)

A full-screen terminal UI for migrating metadata between orgs (e.g. **uat → prod**)
without change sets. Modeled on Gearset / the VS Code Org Browser.

```bash
ferry --source uat --target prod     # live: browse uat, deploy to prod
ferry --demo                         # try it with fixture data, no org needed
```

```
 ferry  source: uat  →  target: prod   test-level: RunLocalTests   selected: 12
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
**caches** it under `.ferry-cache/` (Refresh with `r`), and on deploy it retrieves
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

> Manage orgs with `ferry orgs` (lists everything `sf` is logged into).

### Import from an existing package / change set

Already have a `package.xml` or a metadata `.zip` (e.g. an exported change set)?
Pre-select all of its components in the source org:

```bash
ferry --source uat --import path/to/package.xml
ferry --source uat --import path/to/changeset.zip   # reads package.xml inside
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
everything with `ferry status`.

### State lives in `~/.ferry` (global)

All cross-project state is under `~/.ferry/` (override with `FERRY_HOME`), keyed by
org **username**, so it follows you regardless of which folder you run from:
`~/.ferry/cache/<org>/…`, `~/.ferry/sessions/<org>.json`, `~/.ferry/retrieve/<org>/…`.
The metadata cache never auto-expires — the Components pane shows
`fetched Xh ago` and `r` re-pulls. Inspect with **`ferry status`**, wipe with
**`ferry clean`** (`--all` also clears saved sessions). Defaults can be set in
`~/.ferry/config.json` (`apiVersion`, `defaultTestLevel`). The only thing written
into your project is the `package.xml` from `b`/deploy (in `./manifest`).

### Performance

Built for responsiveness on large orgs:

- **Lazy module loading.** The heavy libraries (`@salesforce/source-deploy-retrieve` ~2.3 s and `@salesforce/core` ~1.8 s to import) load only when a command actually needs them. Light commands (`--help`, `status`, `orgs`*) start in ~0.1–0.25 s instead of ~4.4 s. SDR is deferred during `ui` until you actually deploy. (*`orgs`/`ui` still pay the one-time `@salesforce/core` connect cost.)
- **Lazy, cached metadata.** `ui` makes one `describeMetadata` call for the type list, then one `listMetadata` call per type **only when you open it**, cached under `~/.ferry/cache/` (press `r` to refresh). Component source is never downloaded while browsing — only the selected components are retrieved, at deploy time.
- **True virtualization (fzf-style).** The component list renders only the rows visible in the viewport (~the window height), not the whole dataset. The full filtered+sorted array is computed once per filter/sort/type change and cached; scrolling is pure array-slicing. Measured: **600+ scroll renders over a 50,000-row type in ~0.6 s** (~1 ms/render). The filter is debounced and each action is a single repaint.
- **All metadata types.** The type list includes both top-level types and **child types** (CustomField, ValidationRule, RecordType, WebLink, ListView, FieldSet, CompactLayout, …) — everything listable that appears in a change set.

---

## Install

```bash
cd sf-manifest-cli
npm install
npm link        # makes the `ferry` command available globally
```

Requires Node 18+ and the `sf` CLI (used for the retrieve/deploy steps).

## Commands

| Command | Description |
|---------|-------------|
| `ferry` (or `ferry go`) | the live org → org selector → validate/deploy (flags: `--source`, `--target`, `--import <file>`, `--refetch`, `--demo`) |
| `ferry orgs` | list the orgs `sf` is authenticated to |
| `ferry status` | show cached state: saved sessions, metadata cache, retrieve zips |
| `ferry clean [--all]` | remove cached state (`--all` also clears saved sessions) |

## Migrating uat → prod

```bash
ferry --source uat --target prod
```

Pick components, choose a test level (`l`), then `v` to validate and `d` to
deploy. Caching, saved selections (`s`), and the org → org retrieve are handled
for you. See [BEHAVIORS.md](./BEHAVIORS.md) for exactly what is stored and where.
