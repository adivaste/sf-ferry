# sfm — behaviors & state (audit)

A map of everything the tool does **implicitly** (without you asking) and every
file it writes, so we can decide what to standardize. Nothing here is a bug —
it's the current contract, laid out for review.

---

## 1. Files the tool creates (all relative to your current directory)

| Path | What it holds | Written when | Read when | Expires? |
|------|---------------|--------------|-----------|----------|
| `.sfm-cache/<org>/<Type>.json` | live metadata listing per org+type (names, owner, dates) | first time you open a type in `sfm ui` | every time you open that type | **never** (only `r` in the UI re-pulls) |
| `.sfm-session.json` | last selection + target org + test level, **per source org** | **every** `sfm ui` exit (quit, build, validate, deploy) | start of next `sfm ui` (auto-restored) | never |
| `.sfm-retrieve/unpackaged.zip` | metadata pulled from the source org, ready to deploy | on validate/deploy (step 1) | on deploy; reused if selection unchanged | overwritten on next retrieve |
| `.sfm-retrieve/.sfm-sig.json` | fingerprint of the selection that produced the zip | with the zip | to decide "reuse vs re-fetch" | overwritten |
| `manifest/package.xml` (+ `destructiveChanges.xml`, `empty-package.xml`) | generated manifest | `sfm ui` deploy/validate (via retrieve) **and** local `add/delete/build/clear` | by `sf` + `sfm deploy` | overwritten |
| `manifest/.selection.json` | the **local-flow** selection (separate from `.sfm-session.json`!) | local `add/delete/remove/build/clear` | local `show/build/deploy` | never |

> All are dotted/dir artifacts and are gitignored.

---

## 2. Things that happen automatically (implicit behaviors)

| # | Behavior | Visible to you? | Risk / surprise |
|---|----------|-----------------|-----------------|
| A | `sfm ui` **auto-restores** the saved session and pre-checks it | yes — splash shows "Restored N…" | low (the thing you noticed) |
| B | Metadata list is served **from `.sfm-cache` with no expiry** | no | **medium** — you can see a stale component list; new components in the org won't show until `r` |
| C | Deploy **reuses the cached `.sfm-retrieve` zip** if selection unchanged | only a small grey note | **medium** — could deploy source as it was at first fetch, not latest (use `--refetch`) |
| D | `NoTestRun` + **validate** silently becomes `deploy start --dry-run` | no | low (it's the correct equivalent) |
| E | **Folder types** (Reports, Dashboards, Documents, EmailTemplates) are **excluded** from the type list | no | medium — you may wonder why they're missing |
| F | Child types (CustomField, ValidationRule, …) are auto-included | no | low (desired) |
| G | Component table renders **max 200 rows** at a time | yes — "… N more" hint | low |
| H | App **force-exits** (`process.exit`) after the UI closes | no | low (needed; live connection keeps the loop alive) |
| I | **Quit also saves the session** | no | medium — quitting to "cancel" still persists your edits |
| J | `--import` **silently overrides** the saved session for that run | splash note only | low |
| K | Source org is **auto-prompted** if `--source` is omitted | yes | low |
| L | Defaults applied silently: test level `RunLocalTests`, api version from `sfdx-project.json` or `62.0`, manifest dir `manifest/` | no | low |

---

## 3. Defaults & magic values (currently hardcoded)

- test level → `RunLocalTests`
- api version → `sfdx-project.json` `sourceApiVersion`, else `62.0`
- manifest dir → `manifest`, retrieve dir → `.sfm-retrieve`, cache → `.sfm-cache`
- row cap → 200 · filter debounce → 110ms · keypress de-dupe → 12ms · deploy wait → 60 min

---

## 4. The biggest smell: **two separate selection systems**

- **Local flow** (`add` / `delete` / `show` / `build` / `deploy`): stores the
  selection in `manifest/.selection.json`, builds from **local `force-app/`**.
- **UI flow** (`ui`): stores the selection in `.sfm-session.json`, reads **live
  from an org**, deploys org→org.

They don't share state and a user can't easily tell which is "the" selection.
This is the #1 thing to standardize.

---

## 5. Standardization proposals (ranked)

1. **One state home.** Put everything under a single `.sfm/` dir:
   `.sfm/cache/`, `.sfm/retrieve/`, `.sfm/session.json`, `.sfm/manifest/`.
   One thing to gitignore, one "this is sfm's data" location.
2. **`sfm status` command.** Print, in one place: current saved session per org,
   cache location + age, whether a retrieve zip exists (+ age), manifest dir.
   Directly answers "what's going on?". (+ `sfm clean` to wipe it all.)
3. **Make the implicit visible.** On the splash / banners, surface B, C, E:
   "metadata cache 3d old — press r to refresh", "reusing zip from 10:42",
   "folder types (Reports/Dashboards) hidden — use --include-folders".
4. **Opt-out flags + a config file.** `--no-restore`, `--fresh` (ignore all
   caches), `--include-folders`; and a `.sfmrc.json` for defaults
   (apiVersion, defaultTestLevel, autoRestore, cacheTtl, stateDir).
5. **Cache freshness.** Give `.sfm-cache` an age/TTL and show it; one global
   `--fresh` to bypass session + metadata + zip caches at once.
6. **Decide quit-saves-session (I).** Either keep (document it) or only save on
   an explicit action and treat quit as "discard".
7. **Reconcile the two selection systems (§4)** — at minimum document the split;
   ideally let `ui` and local commands share one named state.

None of this changes behavior yet — it's the menu. Pick what matters and we
standardize incrementally.
