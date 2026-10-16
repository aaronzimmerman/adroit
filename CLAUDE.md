# Adroit

This repository holds three things:

- **`ADROIT.md`** — the methodology. Read it first, in full: it is how to read and work in the
  ledger, and it is not part of any ledger.
- **`ledger/`** — the ledger of the adroit ledger UI (`product/ui/` under `story:ui`, and the UI's
  `engineering/`). It is worked under ADROIT.md like any adopting project's ledger.
- **`seed/`** — the template of default engineering decisions a new project copies from
  (ADROIT.md, The engineering seed). It binds nothing in this repository.

## Tools

- `node tools/dump.mjs --scope <id|path>` — the agent read; `--subtree`, `--referrers`,
  `--maintenance`, `--interactions` as ADROIT.md, The tools describes.
- `node tools/server.mjs --check` — validate `ledger/`; exit 1 on any error. `--diff [ref]`,
  `--open`.
- `node --test tools/ledger.test.mjs` — the tools' own tests.

## The app

The ledger UI lives in `app/` (`app/shared`, `app/server`, `app/web`):

- `npm run app` — build and serve on port 4181.
- `npm run dev` — dev servers.
- `npm test` — build, server and web tests, dead-export check.

Code cites decisions with `@DecisionRef <id>` and marks unresolved questions `@DecisionGap`.
