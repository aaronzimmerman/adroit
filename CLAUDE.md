# Adroit — a decision-ledger methodology

Adroit is a way of running a software project so that **every decision — product and
engineering — lives as one file in a typed tree**, and the tree is the system's only
authoritative description (eng:ledger-sole-record, eng:decision-per-file). There is no prose
spec beside it, no second document to fall out of step. The bet (eng:read-ledger-in-full): with every decision in an agent's context, violating one becomes an **attention
failure instead of a retrieval failure** — and attention failures are the kind that review
catches.

This repository is the methodology's authoritative home. A project that adopts adroit (see
**Adopting adroit** below) holds its own `ledger/` and cites this document as its engineering
tool; project ledgers hold project decisions, never methodology text (eng:adroit-separate-corpus).

Adroit's own decisions live in this repository's `ledger/`, under the root story `story:adroit`
(`ledger/product/adroit/`) — the methodology run on itself. **The ledger wins** wherever this
document and a record disagree (eng:readme-orients-only); read it with `node tools/dump.mjs`.

## The objects

- **Record** — one decision per file. Fields (eng:decision-per-file; `--check` refuses a record
  carrying `status`, `tokens` or `api`):
  - `id` — `domain:slug` (see IDs below)
  - `decision` — the RULE, stated so a reader can comply or detect violation. Rules, not
    implementation (eng:rules-not-implementation): no table, column, class or migration names, except when the name IS the
    concept.
  - `rejected` — the live alternatives that lost, each with the reason it lost. Load-bearing:
    a rejected alternative is what stops the same idea being re-proposed fresh. An empty array
    is honest; an absent one is a shape error (eng:decision-per-file).
  - `links` — typed references (adr:links-typed-by-relation): `grounds` (a principle this rests on), `consumes` (a
    capability/model/record whose contract this depends on), `tension` (a principle this
    deliberately diverges from), `refines` (parent — usually OMITTED because the path carries
    it), plus project-defined classifiers (`domain`, `module`).
  - `context` — non-load-bearing: `why` (one clause of rationale), `src` (the session or task
    that produced it). Nothing in `context` may be needed to comply with the rule
    (eng:decision-per-file).
- **Principle** — a root-citable value judgment (`principle:*`), grounding records across the
  corpus. Cited via `grounds`, never `refines` (adr:links-typed-by-relation).
- **Story** — a root user journey a product tree branches from (adr:roots-by-concern,
  eng:stories-not-interfaces).
- **Model / view** — what an entity IS and which fields each trust context may see
  (adr:models-flat-views-derived).
- **Contract** — `contract.yaml` published by a capability: the interface adopting decisions
  must satisfy (adr:capability-contract-artifact).
- **Domains registry** — `domains.yaml`: every id domain, lowercase, with a one-line scope
  (eng:namespace-names-kind).
- **Interactions log** — NOT part of the ledger: machine-local usage telemetry at
  `~/.adroit/<corpus>/interactions.jsonl`, outside any repository (eng:log-ledger-interactions).
  `<corpus>` is the `corpus:` key at the top of `domains.yaml` (fallback: the repository
  directory's name). The tools validate it line by line on read and read an absent log as empty.

## The tree

- **The refinement hierarchy IS the filesystem** (adr:hierarchy-is-filesystem). A record is `<stem>.yaml` (stem = id with
  `:` → `.`), or `<stem>/self.yaml` once it has children. A nested record omits
  `links.refines` — the path carries it; restating it is a check error. Re-parenting is a
  `git mv`.
- **Roots** (adr:roots-by-concern, adr:four-decision-roots, adr:engineering-shapes-code):
  `product/<app>/` (one tree per product, each descending from a root story),
  `capabilities/<name>/` (cross-product abilities, each with a `contract.yaml`), `models/`,
  `engineering/` (how the thing is built — high-level: platforms, postures, UX principles —
  never code-level), plus `domains.yaml` — nothing else. A project's rulings
  about its own ledger practice are engineering records.
- **Reference direction is one-way** (adr:references-flow-one-way, adr:capability-names-no-product): product → capability → model/view → engineering;
  capability → capability acyclic; principles citable from anywhere. Nothing points backward,
  sideways into another product. A capability record never names a product surface.

## IDs

`domain:slug` (eng:namespace-names-kind). The domain is declared in `domains.yaml`. The slug is 2–5 kebab words naming
the decision's SUBSTANCE — its rule, not its category (`user-controls-live`,
`refusal-writes-nothing`, `cite-dont-restate`) — unique across the corpus, no digits, never a
number. The file path is the claim, so a collision is a merge conflict, not a silent
overwrite.

## The protocol

- **Read the ledger in full at the start of any task** (eng:read-ledger-in-full) (the dump tool renders one
  compact line per record) and keep it as the working constitution. For detail below the
  decision, read the code and its tests — there is no second description to consult.
- **Cite governing ids** when a decision bears on the work (eng:cite-dont-restate).
- **Never silently revise** (eng:never-silently-revise). A request to build something is not permission to rewrite a
  standing decision. On apparent contradiction: stop, state the old rule and the proposed new
  one, get explicit confirmation. Scrutiny follows dependence — measured from the graph (a
  record's refinement children and consumers), never asserted: leaves change cheaply,
  load-bearing records get their dependents named before anything changes.
- **Echo behavior before minting** (eng:echo-behavior-before-minting). Restate the concrete user-visible behavior and get the yes
  on THAT, in the user's words, before writing the record. The forks that most need asking are
  the ones that felt obvious.
- **Supersession deletes** (eng:delete-superseded). Git history is the archive: delete the superseded record's file,
  re-parent anything that refined it, rebind code/test citations — never mark "retired".
- **Every mid-cycle decision writes a file** (eng:every-decision-writes-file) — ask-first outcomes and below-the-bar calls
  alike, with `context.why`, `context.src`, `rejected`, and its place in the tree.
- **The decision report is `git diff ledger/`** (eng:every-decision-writes-file,
  eng:log-ledger-interactions). A wrap-up walks that diff; alongside it, append one line to the
  machine-local interactions log (`~/.adroit/<corpus>/interactions.jsonl`) per moment the
  ledger resolved a fork, prevented a change, or was felt missing.
- **Tests bind to decisions** (eng:ledger-sole-record) (e.g. a `@DecisionRef("aud:colour-amber")` annotation), so a
  superseded record's rebind sweep finds them.

## Cite, don't restate

(eng:cite-dont-restate)

The ledger is the single point of decision tracking; every other artifact is an undesirable
home for decision content. Code comments, project CLAUDE.md files, READMEs, task files and
commit messages CITE a decision by id and add only local implementation hints — what the thing
at hand does toward the rule. They never restate the rule or its rationale: a restated
decision drifts invisibly when the record changes; an implementation hint drifts visibly with
the code beside it. Declared registries whose descriptions are their own load-bearing content
are facts, not restatements. Bare ids with no gloss are also wrong — a reader is owed one
clause of what the code does toward the rule.

## Tooling (`tools/`)

- `node tools/dump.mjs` — every record, one compact line each: the agent-context render.
- `node tools/server.mjs --open` — the explorer; `--check` — link integrity and shape rules
  (eng:dependencies-must-resolve); runs in CI so a dangling reference or restated `refines`
  fails the build. It also reports the machine-local interaction log's standing (bad lines
  skipped), which never moves the exit code (eng:log-ledger-interactions).
- `node tools/dump.mjs --interactions` — the dump with this machine's interaction log appended.
- Extraction has started (2026-09-28): these are copies of the StageDoor reference
  implementation (`~/workspace/magic-beans`, `tools/adroit/`) pointed at this repository's
  `ledger/`. The StageDoor copy is still the one its CI runs; deduplicating the two is the next
  roadmap step.

## Adopting adroit

A project wires in (adr:four-decision-roots, eng:readme-orients-only): a `ledger/` directory with
the roots above and `domains.yaml`; the dump /
check / explorer tools; the check in CI; test-to-decision bindings; and a project CLAUDE.md
that names this document as the methodology and keeps for itself only what the ledger cannot
hold — build commands, file locations, tool gotchas, and one-line pointers into `ledger/`.
