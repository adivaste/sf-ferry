# ferry — behaviors & state (current)

After standardization, here's exactly what the tool stores and what happens
automatically. `ui` is the only workflow (the old local `add/delete/build`
commands were retired).

## Where state lives — `~/.ferry/` (global, override `FERRY_HOME`)

Keyed by org **username** (immutable), so it follows you across folders.

| Path | Holds | Expires? |
|------|-------|----------|
| `~/.ferry/cache/<user>/<Type>.json` | metadata listing `{fetchedAt, apiVersion, rows}` | never — UI shows age, `r` re-pulls |
| `~/.ferry/sessions/<user>.json` | deduped history of selections (last 20), incl. optional names | never |
| `~/.ferry/retrieve/<user>/unpackaged.zip` (+ `.ferry-sig.json`) | retrieved metadata + selection fingerprint | overwritten per retrieve |
| `~/.ferry/prefs.json` | per-org UI prefs: `lastTarget`, `lastType` (convenience only) | overwritten |
| `~/.ferry/log.json` | deploy/validate history (last 200) — see `ferry log` | capped |
| `~/.ferry/config.json` | optional defaults (`apiVersion`, `defaultTestLevel`) | — |
| `./manifest/package.xml` | the generated manifest (only thing written into your project) | overwritten |

Inspect with **`ferry status`**, review deploys with **`ferry log`**, wipe with
**`ferry clean`** (`--all` includes sessions).

## Commands

| Command | What it does |
|---------|--------------|
| `ferry` / `ferry ui` | the interactive selector (default) |
| `ferry run` | non-interactive deploy/validate for CI (selection from `--import` or `--session`, `--json` output) |
| `ferry log` | recent deploy/validate history |
| `ferry status` / `ferry clean` | inspect / wipe cached state |
| `ferry orgs` | list authenticated orgs |

## What happens automatically (and how it's surfaced)

| Behavior | Surfaced? |
|----------|-----------|
| metadata served from cache, no expiry | yes — "fetched Xh ago (r=refresh)" on the Components pane |
| deploy reuses the cached zip if the selection is unchanged | yes — grey note; `--refetch` forces fresh |
| selections are checkpointed to history on a real action, or on **save & quit** | implicit, but visible via `s` picker and `ferry status` |
| last target org + last active type are remembered per source | prefilled at launch (only if the org/type still exists) |
| the row filter can be **pinned** across type switches | `f` toggles it; Filter box shows `· pinned` |
| selections are **never auto-restored** | by design — press `s` to load one, `S` to save a named one |
| every deploy/validate is logged | see `ferry log` |
| folder types (Reports/Dashboards/Documents/EmailTemplates) excluded | not yet surfaced (TODO: `--include-folders`) |
| child types (CustomField, …) included | — |
| `NoTestRun` + validate → check-only `deploy --dry-run` | not surfaced (it's the correct equivalent) |
| force-exit after the UI closes | needed (live connection keeps the loop alive) |
| component list capped at 200 rendered rows | yes — "… N more" hint |

## Defaults

- test level → `config.json` `defaultTestLevel`, else `RunLocalTests`
- api version → `--api-version` > `config.json` > `sfdx-project.json` > `62.0`
- manifest dir → `./manifest` · row cap 200 · filter debounce 110ms · deploy wait 60m

## Still open (candidates)

- surface the hidden folder-type exclusion + an `--include-folders` flag
- optional `cacheTtlHours` in config for people who want auto-invalidation
