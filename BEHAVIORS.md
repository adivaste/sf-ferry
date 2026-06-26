# sfm — behaviors & state (current)

After standardization, here's exactly what the tool stores and what happens
automatically. `ui` is the only workflow (the old local `add/delete/build`
commands were retired).

## Where state lives — `~/.sfm/` (global, override `SFM_HOME`)

Keyed by org **username** (immutable), so it follows you across folders.

| Path | Holds | Expires? |
|------|-------|----------|
| `~/.sfm/cache/<user>/<Type>.json` | metadata listing `{fetchedAt, apiVersion, rows}` | never — UI shows age, `r` re-pulls |
| `~/.sfm/sessions/<user>.json` | deduped history of selections (last 20) | never |
| `~/.sfm/retrieve/<user>/unpackaged.zip` (+ `.sfm-sig.json`) | retrieved metadata + selection fingerprint | overwritten per retrieve |
| `~/.sfm/config.json` | optional defaults (`apiVersion`, `defaultTestLevel`) | — |
| `./manifest/package.xml` | the generated manifest (only thing written into your project) | overwritten |

Inspect with **`sfm status`**, wipe with **`sfm clean`** (`--all` includes sessions).

## What happens automatically (and how it's surfaced)

| Behavior | Surfaced? |
|----------|-----------|
| metadata served from cache, no expiry | yes — "fetched Xh ago (r=refresh)" on the Components pane |
| deploy reuses the cached zip if the selection is unchanged | yes — grey note; `--refetch` forces fresh |
| selections are checkpointed to history on every action/quit | implicit, but visible via `s` picker and `sfm status` |
| selections are **never auto-restored** | by design — press `s` to load one |
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
