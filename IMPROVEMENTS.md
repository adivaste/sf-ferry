# ferry — improvements & roadmap

A running list of UX papercuts and features, from a review of the daily
uat→prod workflow. Checked items shipped on the `v3-global-state` branch;
unchecked items are candidates for later.

---

## Papercuts (small, high-intuition fixes)

- [x] **1. Editable Selected pane.** The Selected pane was read-only; you can now
  `tab` into it, move with ↑↓/jk, and `space`/`x` removes the highlighted item in
  place instead of hunting it back down in the component list.
  _(src/tui.js: `basketFlat`/`basketMove`/`basketRemove`; test `tui-basket`)_
- [x] **2. Sticky filter across type switches.** `f` pins the row filter so it
  survives switching metadata types — migrate everything named "Account" across
  ApexClass, CustomField, Layout without retyping. The Filter box shows `· pinned`.
  _(store `setActiveType({keepFilter})`; test `tui-sticky`)_
- [x] **3. Feedback on bulk ops.** `a`/`c` now flash a status line
  (`+N selected · M in Type (K shown)`) so the silent action is confirmed.
- [x] **4. Test level is a picker.** `l` opens a picker pre-selected on the current
  level (instead of one-way cycling), so any level is one jump away.
  _(test `tui-testlevel`)_
- [x] **5. Save & quit.** Quitting offers a third choice — `s` save & quit — which
  checkpoints the selection to history so an abandoned deploy is never lost.
  _(resolves `{save:true}`; wired in bin/cli.js; test `tui-savequit`)_
- [x] **6. Remember last target org per source.** Stored in `~/.ferry/prefs.json`
  and pre-filled at launch (only if the org still exists). _(src/prefs.js)_
- [x] **7. Remember last active type per source.** Reopen lands on the type you
  were last browsing. _(src/prefs.js)_
- [x] **8. Visual range-select.** `V` drops an anchor, move to extend, `space`
  (de)selects the whole run at once. _(test `tui-visual`)_
- [ ] **Honor real `TERM` / `NO_COLOR`.** The TUI forces `xterm-256color` +
  `forceUnicode`; falling back to the real terminal caps would fix garbled output
  on legacy Windows consoles / plain CI logs. _(src/tui.js:126 — still open)_

## Higher-leverage, still-small features

- [x] **`p` preview.** Shows the exact `package.xml` the selection would generate,
  built without writing to disk. _(manifest `buildPackageXml`; tests `manifest`,
  `tui-preview`)_
- [x] **Named sessions.** `S` saves the selection under a name; the `s` picker and
  `ferry status` show it. `ferry run --session <name>` can replay it in CI.
  _(session `findSession`; test `tui-namedsave`)_

## Bigger features — ranked by value

- [x] **Headless / CI mode.** `ferry run --source uat --target prod --import
  package.xml --test-level RunLocalTests [--validate] [--json]` — no UI, reuses the
  retrieve/deploy pipeline. Selection from `--import` or `--session`. Robust to
  `sf` missing from PATH. _(bin/cli.js `run`)_
- [x] **Deploy history / `ferry log`.** Every UI and CI deploy/validate is recorded
  to `~/.ferry/log.json` (what, when, result, elapsed, mode); `ferry log` prints
  it. _(src/history.js)_
- [ ] **Diff against the target org (flagship).** Retrieve the same components from
  the target and show per-row `new · changed · identical`, so you deploy only real
  diffs. The thing change sets can't do well.
- [ ] **Select from git.** Map files changed in a branch/commit range to metadata
  components and pre-check them (`--changed main..HEAD`).
- [ ] **Quick Deploy.** Reuse a recently *validated* build to deploy without
  re-running tests (store the validation id).
- [ ] **Destructive changes.** Mark components for deletion →
  `destructiveChanges.xml` (plumbing already exists in manifest.js/constants.js).
- [ ] **Folder types.** Reports / Dashboards / Documents / EmailTemplates (needs
  per-folder enumeration). Currently filtered out in `bin/cli.js`.
- [ ] **Dependency nudges.** Warn on obviously incomplete selections (a CustomField
  without its object; Apex without its test class).
- [ ] **Parsed post-deploy summary.** Turn the raw `sf` output into a component
  success/failure table.
