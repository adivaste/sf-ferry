# ⚓ ferry

**Move Salesforce metadata from one org to another, right from your terminal.**
Browse a source org, tick the components you want, and validate or deploy them to
a target org — like a change set, without the clicking.

[![npm version](https://img.shields.io/npm/v/sf-ferry.svg)](https://www.npmjs.com/package/sf-ferry)
[![node](https://img.shields.io/node/v/sf-ferry.svg)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/sf-ferry.svg)](./LICENSE)

![ferry — browse a source org, tick components, deploy to a target](https://raw.githubusercontent.com/adivaste/sf-ferry/main/assets/tui.png)

## Install

```bash
npm install -g sf-ferry
```

Needs **Node 18+** and the Salesforce **`sf` CLI**, already logged in to your orgs
(ferry reuses those logins — it never asks you to sign in again).

## Quick start

```bash
ferry --source uat --target prod
```

Opens the selector on `uat`. Pick your components, press **`d`** to deploy (or
**`v`** to validate). No local project or hand-written `package.xml` required.

Just kicking the tires?

```bash
ferry --demo      # runs on fixture data, no org connection
```

## Why ferry

- **Real columns.** Sort by owner, last-modified, and created date — details that
  live in the org, not in local files.
- **Pick fast.** Filter, range-select, select-all; check components across any
  number of types, including child types like CustomField and ValidationRule.
- **Deploy or validate** straight to the target with any test level.
- **Never lose your place.** It remembers your selection, last target, and a
  history of past selections — resume a failed deploy right where you left off.
- **Scriptable.** `ferry run … --json` does the same thing headless, for CI.

## Keys (the essentials)

| Key | Does |
|-----|------|
| `↑ ↓` / `j k` | move |
| `space` | check / uncheck (or remove, in the Selected pane) |
| `/` | filter · `f` keep the filter across types |
| `V` | range-select |
| `t` · `l` | pick target org · pick test level |
| `v` · `d` | validate · deploy |
| `s` · `S` | load a saved selection · save one by name |
| `?` | full keybinding help · `q` quit |

## Commands

| Command | Does |
|---------|------|
| `ferry` | the interactive selector (default) |
| `ferry run` | headless deploy/validate for CI — `--import`/`--session`, `--validate`, `--json` |
| `ferry log` | recent deploy history |
| `ferry status` | what's cached (sessions, metadata, retrieve zips) |
| `ferry clean` | clear cached state (`--all` includes saved sessions) |
| `ferry orgs` | list your authenticated orgs |

**Start from an existing manifest:**

```bash
ferry --source uat --import path/to/package.xml   # or a metadata .zip
```

**Validate in CI:**

```bash
ferry run --source uat --target prod --import manifest/package.xml \
  --validate --test-level RunLocalTests --json
```

## Learn more

- Full keybindings — press **`?`** inside the app.
- A visual guide — usage, how it works, and where state is stored — lives in
  [`docs/index.html`](./docs/index.html).
- Inspect what's cached with `ferry status`.

## License

[MIT](./LICENSE)
