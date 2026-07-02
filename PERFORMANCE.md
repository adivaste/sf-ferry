# ferry — performance audit & report

Audit of startup, rendering hot paths, memory, and storage, with before/after
benchmarks. Measured on Windows 11, Node 22, a synthetic 50,000-row metadata
type (the advertised worst case). Bench harness lives outside the repo; numbers
are best/avg of repeated runs.

## TL;DR — what changed

| Area | Before | After | Win |
|------|--------|-------|-----|
| Select-all / clear on a filtered 50k type (`a`/`c`) | 28.5 ms | 12.6 ms | **~2.3× faster** — reuse the cached view instead of re-filter+re-sort |
| Selected-pane render/navigate (20k selected) | 2–3× `selectionGrouped`/key | 1× | **~2–3× less work** per keystroke |
| Metadata cache file (50k rows) | 13.55 MB, pretty-printed | 10.40 MB, compact | **23% smaller, 21% faster** to write |
| Metadata cache write | `writeFileSync` (truncates on crash) | atomic tmp+rename | **no corruption** on Ctrl-C/crash |
| Types pane on every toggle | full `setItems()` rebuild → region repaint | single `setItem()` badge | **no flicker** (earlier fix) |
| Renders per bulk action | 2 (`refreshMarks` + `status`) | 1 | **half the paints** |

No functional regressions — full test suite (29 suites) green throughout.

## Startup (cold spawn, best of 6)

| Command | Time |
|---------|------|
| `ferry --version` | 80 ms |
| `ferry --help` | 84 ms |
| `ferry log` | 89 ms |
| `ferry status` | 87 ms |

Startup is dominated by Node's own boot (~40–50 ms) plus `commander` (~20 ms).
The heavy libraries are correctly **lazy-loaded** and never touch these paths:

| Module | Import cost | Loaded when |
|--------|-------------|-------------|
| `@salesforce/source-deploy-retrieve` | **1833 ms** | only at deploy / validate / `p` preview |
| `blessed` | 88 ms | only when the UI opens |
| `@salesforce/core` | ~9 ms (pulled via SDR/org) | only when connecting to an org |
| light modules (store, paths, session, history, prefs) | 1–6 ms each | as needed |

This matches the #1 CLI-startup best practice: only the arg parser and dispatch
load up front; everything expensive is deferred. There is no meaningful win left
on the light path without dropping `commander` (not worth the risk).

## Rendering hot paths (the interactive feel)

The virtualization core was already sound: the filtered+sorted array (`view`) is
computed once per filter/sort/type change and cached; only the visible slice is
ever formatted. Navigation and toggling are O(viewport), not O(rows). The fixes
targeted the selection paths that still did full-array or full-selection work:

1. **`selectAllVisible`/`clearVisible` re-sorted 50k rows** just to enumerate
   names for a Set. They now accept the already-computed `view` from the TUI —
   no re-filter, no re-sort. `a`/`c` on a 50k type: **28.5 ms → 12.6 ms**.
2. **The Selected pane grouped+sorted the whole selection 2–3× per keystroke**
   (`selectionGrouped` called directly in `renderBasket`, again via `basketFlat`
   for its length, and again in `basketMove`/`basketRemove`). Now it groups
   **once** per render and caches the flat list. On a 20k selection that's
   ~11 ms saved per basket keystroke.
3. **The Types pane rebuilt every list item on every toggle** (`setItems`),
   forcing blessed to repaint the whole pane region — the visible flicker. Now a
   single `setItem()` updates just the changed badge. (Shipped earlier.)
4. **Two renders per bulk action** (`refreshMarks()` then `status()`), plus a
   double render in `relayout()` — collapsed to one paint each.
5. **`filteredTypes()` re-derived on every toggle** — now cached by filter key.
6. **Resize** now debounced (50 ms trailing) so a window drag coalesces to one
   repaint.

Not changed on purpose: `visibleRows()` keeps its simple in-place sort. A
decorate-sort-undecorate speeds a full re-sort (45→28 ms) but regresses the
common already-sorted open-a-type case (6→12 ms) and adds 100k allocations per
sort (GC pressure). Since `view` is cached and sorting only happens on an
explicit sort/filter/type change (never per keystroke), the simple version wins.

## Memory

No leaks found. A probe of **2,000 filter+toggle cycles** on the 50k type showed
a heap delta of **−3.6 MB** (stable; the negative is GC reclaiming). Steady
state ~45 MB heap / ~137 MB RSS with a 50k-row type fully loaded.

Verified good (no action needed):
- All `setInterval`/`setTimeout` (spinner, splash, filter debounce, resize) are
  cleared and `.unref()`'d; `cleanup()` clears them on exit.
- Every modal (picker, prompt, preview, help, confirm) calls `.destroy()`, so
  element-scoped listeners go with it — no listener accumulation.
- All `screen.key`/element `.key` bindings register once at setup, never per
  render or per keystroke.
- The `program.emit` keypress-dedupe override is symmetric and restored on exit.

## Storage / IO

1. **Metadata cache** (`cache/<org>/<Type>.json`, up to MBs): was written
   pretty-printed and non-atomically. Now **compact** (23% smaller, 21% faster
   to serialize) and **atomic** (write `*.tmp`, then rename) so a crash mid-write
   can't leave a truncated file that silently forces a full network re-fetch.
2. **Atomic writes everywhere** via a shared `writeJsonAtomic` helper —
   sessions, prefs, and the deploy log can no longer be truncated to "no data"
   by a crash/Ctrl-C during the write.
3. **Cache staleness bug fixed**: the cache stored `apiVersion` but never checked
   it on read, so a different `--api-version` served old rows. It's now part of
   the cache-hit check.

## Logical bugs fixed

- **Unhandled rejection**: `program.parseAsync` had no `.catch`; a thrown async
  action printed a raw stack trace and (after the UI) could leave the terminal in
  raw mode. Now caught → clean message, terminal restored, exit 1.
- **`status`** pushed a corrupt non-array session file as-is (`list.length`
  undefined) — now guarded with `Array.isArray`.
- **Dead import** of `setTypes` in `bin/cli.js` removed.

## Known trade-offs / not addressed (by design)

- **SDR's 1.8 s import** is inherent to the library; it's paid once, only at
  deploy/validate/preview, behind a spinner. Replacing SDR is out of scope.
- **`ferry run` keys the retrieve dir by the source string as typed**, while the
  UI keys it by canonical username. Aligning them would force `run` to open a
  (slow) org connection just to canonicalize; the only cost today is that a
  UI-warmed zip isn't reused by CI (and vice-versa) — acceptable.

## How to reproduce

The benchmark harness imports `src/store.js` against a generated 50k-row type and
times `visibleRows`, `selectAllVisible` (old vs new signature), `selectionGrouped`,
and cache serialization; a `--expose-gc` memory probe runs 2,000 mutate cycles.
The repo's own `test/tui-perf.test.mjs` (600+ renders over 50k rows) and
`test/startup.test.mjs` (`--help` under threshold) guard against regressions in CI.
