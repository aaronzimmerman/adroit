# Adroit

Adroit is a way of running a software project in which every product and engineering decision
lives as a small file in one tree, the **ledger**, and that tree is the only record of what was
decided. There is no specification beside it and no second document to fall out of step.

This document defines the methodology. It is not part of any ledger, because a ledger cannot
explain how to read itself: read this first, then read the ledger. A project that adopts adroit
links here from its own CLAUDE.md.

## Why

Decisions kept where the work happened (tickets, threads, per-feature design docs) are never
placed against one another, so each feature quietly re-argues what the last one settled. A
decision log looked up on demand fails the same way: the agent never retrieves the rule it is about
to break.

The bet is that when every decision binding a piece of work is in the agent's context, breaking one
becomes a failure of **attention** rather than of **retrieval**, and attention failures are the
kind that review catches. The ledger's purpose is that decisions endure: a new feature is placed
against the old decisions instead of re-litigating them.

## Layout

A ledger is a directory, conventionally `ledger/`, holding at most these entries:

- `product/<app>/` — one tree per application, its root node holding the application's **story**.
- `capabilities/<name>/` — reusable subtrees, each included wherever its "how" repeats.
- `engineering/` — decisions that shape code: platforms, postures, coding practices, UX
  principles, and the project's rulings about its own ledger practice.
- `models/` — the at-rest data models and views of the current implementation, with
  `models/pending-changes/` for model migrations in flight.
- `domains.yaml` — the registry of id domains.

Nothing else sits at the top level; a stray directory would hold files nobody checks. A ledger
opens only the roots it has nodes for, and an absent root is an empty one.

**The hierarchy is the filesystem.** Directory nesting is parentage. A directory's own node is its
`self.yaml`; a node with no children is a plain `<slug>.yaml`. Re-parenting is a file move.
References bind to decision ids, never to paths, so a move breaks nothing that cites the moved
decisions. The files exist for git — diff, merge, blame and review — so two sessions claiming the
same id surface as a merge conflict rather than a silent overwrite.

Where a node belongs is measured, not ascribed: a rule binding all work is engineering, a "how"
that repeats in several places is a capability, and what serves one story is product. Trees emerge
from the decisions that cluster to support a story, and moving a node that grew up somewhere else
is the normal, healthy response. A measurement nominates a move; a person blesses it.

## The node

Every file under `product/`, `capabilities/` and `engineering/` is a **node**: a friendly name and
a set of peer decisions. Its keys, in this order, and no others:

```yaml
name: Guest checkout                  # a label for readers; the file name is its slug
decisions:                            # non-empty; equal peers, none primary
  - id: cart:guest-checkout-allowed   # domain:slug, unique across the ledger, never edited
    decision: >-                      # one clause, stating one reversible choice
      A shopper can check out without an account.
    rejected:                         # optional: the alternatives that lost, each with why
      - account required at checkout — abandonment outweighs the retention gained
    severable: true                   # optional, default false
  - id: cart:order-keyed-to-email
    decision: A guest order is keyed to the email the shopper gives.
includes: [payments]                  # capabilities whose whole tree joins this node's scope
severed: [payments:card-on-file]      # severable inherited decisions this subtree is released from
dubious: parent ruling on accounts changed — re-read   # why this node is suspect, if it is
questions:                            # open tensions, one line each
  - Does a guest see past orders when they later sign up?
context:                              # the author's background; never a rule
  why: checkout abandonment study, Q3
  src: checkout walk, session 2026-10-04
```

- **Name.** A label for readers. The file name is the name as a slug, and nothing keys off either.
- **Decisions are peers.** No decision on a node is primary, and their order is display only. A
  standing commitment over a subtree is simply a decision on the node whose subtree it governs.
- **One clause, one choice.** A decision states one independently reversible choice. A ruling
  spoken in one breath that holds several choices becomes several decisions: peers on one node,
  or a governing node with the dependent choices nested beneath it. Granularity is about
  reversibility, not size: a long decision of one inseparable rule is fine; a short one hiding two
  choices is not. Splitting a decision keeps its id on the clause it names best, so citations keep
  resolving.
- **Rules, not implementation.** A decision states the rule so a reader can comply or detect a
  violation. No table, column, class, route or migration names, unless the name is itself the
  thing chosen. A product decision states what someone needs to do, not how the app works; a
  mechanism is a product decision only where the mechanism is itself the choice, and the node says
  why. A story states a need, never an interface: the interface is the emergent result of the
  stories under the engineering decisions.
- **Wording.** No ids inside decision text: relationships are structural (the parent is the
  directory, a capability is an include). A term is defined in one decision and used, not
  redefined, elsewhere. Name the actor ("an organizer", "the shopper"), never a bare "a user". A
  decision never enumerates other decisions (no closed lists of siblings, no counts of kinds),
  because the set is the tree; it may list its own parts. A decision states only the present rule:
  no dates, revision notes or "previously, now" narrative. A changed ruling is rewritten whole to
  read as if it had always been so.
- **Rejected.** A decision that defies a fresh reader's instinct names the alternatives it beat,
  each with the reason it lost. This is what stops the same idea being proposed fresh.
- **Context is background only.** Why, provenance and history. Nothing in it may be needed to
  comply; anything that binds is a decision or part of what one rejected.
- **No implementation state.** No node says what code must change, what is or isn't built yet, or
  which code disagrees with it. The gap between decisions and code is found by comparing the two
  and belongs to the build plan. The only described implementation state is the models directory.
- **No workflow state.** Nodes carry no status. Superseded decisions are deleted, not marked.
  `dubious` and `questions` are maintenance notes, not workflow steps.

## Scope

**A decision binds its own node and everything nested beneath it, and nothing else**, however
universal it sounds. It binds silently: a descendant owes no statement of how it honors an
inherited decision. A node's full context is its ancestry and its includes; there are no sideways
references between decisions.

**Build by depth.** A product can be built by following each hierarchy strictly by depth. Within a
tree, a node is judged and implemented only against its own chain — its ancestors, engineering,
and the capabilities included on that chain — never against its siblings or cousins. Siblings are
considered together only as refinements of their common parent: a restatement several siblings
share is lifted to the parent only when every child of that parent states it, never when just some
do (the same holds for an include), and a sibling whose refinement contradicts the parent is a finding
against the parent. Two siblings disagreeing is not a contradiction.

**Capabilities.** A capability is a subtree under `capabilities/<name>/`, rooted at its own
`self.yaml`, whose decisions together state what an includer takes on. A node includes it where the
capability's "how" repeats; including brings the capability's whole tree, and whatever its nodes
include, into the scope of the including node and every descendant. A capability holds
**mechanics, and defaults** for when the includer says nothing. It never places an obligation on
its includers ("whatever includes this must declare that"): such a rule is about authoring the
ledger, which code cannot satisfy. A capability speaks its own vocabulary and never names a
product or an includer. Capabilities include one another one way only; self-includes and include
cycles are errors.

**Plumbing is engineering.** A rule that binds every request — the boundary, observability,
security, flags, storage — is an engineering decision, not a capability, because nothing chooses
to include it.

**Principles** are value judgments, ids under `principle:`, living in `engineering/`. Since every
piece of work reads engineering whole, a principle binds everything with no reference needed.

**Severing.** A decision is unseverable unless marked `severable: true`. A descendant opts out of
an inherited severable decision only by listing its id under `severed`, which releases that node
and its descendants. A decision may be severed only beneath the node that holds it, or beneath a
node that includes the capability holding it. A severed decision still shows in the scoped read,
marked severed, so the opt-out stays visible. Severability belongs to the declaring decision: a
promise like data privacy is simply never severable.

## Reading a ledger

Agents read the ledger **only through the dump**, never the raw files, so that maintenance notes
are never weighed as law.

- **Read your scope** before work on a decision: the engineering tree whole, then each ancestor
  node whole, the target node, and every capability those include. Add the target's descendants
  when the work changes the target itself. Searching for the decisions a task seems to touch
  fails, because the decision that gets violated is the one the task did not seem to touch.
- **The whole ledger** is read only for whole-ledger work, such as a vocabulary sweep.
- **The dump leaves out** `context`, `dubious` and `questions` unless maintenance work asks for
  them.
- Detail below a decision is read from the code and its tests. There is no second description.

## Models

`models/` describes the data at rest in the current implementation. It is not a decision tree,
and no decision names a model, view or field: the model cites the decision, never the reverse.

A model file has an `id` (`model:<name>` or `view:<name>`), a short `decision` statement of the
concept, and `shape.fields`, one line per field naming its kind, the decision ids that govern it,
and its meaning and usage intent. A model is flat. Every transfer object that crosses a trust
context is a **view**: a read-only shape naming its audience and the models it reads, mapping each
field to the model field it projects or to the decision that defines its derivation. Only a view's
derivations carry their own definition.

Every decision id a field cites must resolve; those citations are the wiring from decisions to
shape, and the model graph derives from them. A deployed field citing nothing is reported as a
probable orphan, never failed.

**A model memorializes the deployed shape.** When a ruling changes what a model should be, the
model file keeps stating what actually persists, and the divergence is held as a pending change:

- Setting a field's intended definition records a **pending entry** on the model file beside the
  deployed shape it will replace.
- **Beginning a migration** moves named pending entries off the model file into a pending-change
  file under `models/pending-changes/`, so each entry lives in one place at a time. A pending
  change holds its `name` (unique among open changes), its `origin` (the decision ids whose ruling
  required it), its `operations` (each naming a model field and carrying the deployed and intended
  shapes) and its `state`.
- **Landing a migration** is a person's attestation that it has shipped — no tool can observe a
  deployment. In one act the model file takes the intended shape and the pending change is
  deleted. A refused landing changes nothing.
- A tool reading a model projects its pending changes onto it to show deployed and intended side
  by side.

The pending change is the only staged state that endures. A ruling has no staged form: it is a
point in time, its only in-flight state is the uncommitted working tree, and source control is its
history.

## Ids and the registry

An id is `domain:slug`. The slug is two to five kebab-case words naming the decision's substance
(`refusal-writes-nothing`, not `rule-7`), unique across the ledger, never numbered. The domain is
looked up, never inferred from the id's shape: a domain declared in `domains.yaml`, a capability's
name, or a reserved kind (`principle`, `story`, `model`, `view`). Declare a domain before any
decision uses it.

`domains.yaml` holds a `corpus:` key naming the ledger, then one line per domain: the lowercase
domain and a one-line scope.

Every structural name — an included capability, a severed id, a model field's citation — must
resolve, and no per-node waiver legalizes one that doesn't.

## Dubious

`dubious` is one line saying why a node is suspected of no longer being coherent; it is absent when
the node is not suspect. It says the node's validity is not assured.

- **What makes a node suspect.** Any edit to a node's decisions, includes, severed list or context
  makes every descendant suspect, and, for a node inside a capability, every node that includes
  that capability, with its descendants. Moving a node makes the moved subtree suspect, since its
  scope changed. Model operations make nothing suspect: they always follow from a decision change
  that already did. Asking, answering or dropping a question makes nothing suspect.
- **How it is written.** The commit that makes a change writes the mark onto every suspect not
  read through before the commit, naming the node whose change made it suspect. A person can also
  mark a node by hand on seeing a contradiction, stating what they saw. The commit is never gated
  on clearing the suspects: the mark is the guard, and it outlives the commit.
- **Cascade.** Marking a node marks every descendant too, each naming the marked ancestor. The mark
  is written into each node's file, never derived at read time.
- **Every reason kept.** A node already dubious that gains another cause keeps every reason; the
  new cause is added to its line.
- **Clearing.** The mark clears when someone reads the node through and edits or confirms it;
  confirming is removing the line and committing that removal. Clearing never cascades: each
  descendant stays dubious until it is worked itself.

The mark lives in git rather than a local store so the team sees what is suspect and who cleared
it, and it carries a reason rather than a flag because the next reader is owed why.

## Questions

`questions` lists one-line open tensions in or around a node's decisions. A complex system always
carries tension, and a ledger that could hold only settled rulings would either lose the tension or
call itself broken. A ledger with open questions is in good standing: the check reports them and
never counts them as faults.

A question says nothing about the validity of its node, which is what `dubious` says; a sound node
can carry questions. A question that launches new work sits on the node that work would grow from.
A question ends by removing its line: answered, by clarifying a decision or minting the decisions
that resolve it, or dropped as unhelpful. While it stays, it is future work.

## The protocol

- **Read your scope first**, through the dump.
- **Echo behavior before minting.** Before writing a decision from a person's ruling, restate the
  concrete behavior it will produce, in their words, and get the yes on that, not on the
  decision's wording. Translating straight into ledger vocabulary silently supplies decisions they
  never made. The forks that most need echoing are the ones that felt obvious.
- **Ask one fork at a time**, with a recommendation and the live alternative.
- **Never silently revise.** A request to build something is never permission to rewrite a
  standing decision. When work appears to contradict a decision in scope, stop: state the old rule
  and the proposed one side by side, and wait for explicit confirmation.
- **Scrutiny follows dependence.** The confirmation names what depends on the decision, measured
  from the tree (its descendants and, inside a capability, every includer), before anything
  changes. A leaf changes freely; a load-bearing node is guarded.
- **Weigh disruption, not only fitness.** Each subtree has its own tolerance for disruption,
  decaying as adoption grows; a change is judged against the tolerance of the subtree it touches.
  Better in a vacuum is not better here.
- **Every decision writes a file.** Every decision made mid-cycle, including calls below the bar
  of asking, becomes a decision in the ledger in the same change that acts on it, with its why,
  its source, what it rejected, and its place in the tree.
- **A ruling lands as one atomic commit** across every file it touches.
- **Supersession deletes.** A superseded decision is deleted whole; git history is the archive.
  Anything nested beneath a deleted node is re-parented in the same change, and code and test
  citations are rebound. Two decisions that disagree mean one was superseded.
- **Rewrite over patch.** A node patched more than twice is rewritten whole. Every programmatic
  edit verifies its anchor matched and its result landed; a work log records verified results,
  never the plan.
- **The ledger leads, the code follows.** Change a decision in the ledger first, at any time; code
  being out of step is never a reason to hold a ruling back. Bringing code into compliance is its
  own follow-up act, and the citations that go red are its worklist.
- **UX change finds the decision.** Fix an output by finding the decision whose property makes it
  wrong and changing that, never by specifying a screen.
- **The report is the diff.** A cycle's decision report is `git diff ledger/`. Beside it, log one
  interaction event per moment the ledger resolved a fork, prevented a change, or was felt
  missing.

## Citing decisions

The ledger is the single home for decision content. A code comment, CLAUDE.md, README, task file or
commit message **cites** a decision by id and adds one clause of what the thing at hand does toward
it; it never restates the rule or its rationale. A restated rule drifts invisibly when the decision
changes; an implementation hint drifts visibly with the code beside it. A declared registry whose
descriptions are its own content states facts, not restatements.

Code carries `@DecisionRef <id>` at the place it realizes a decision, and tests bind the same way;
every cited id must resolve. An unresolved question met while building is marked `@DecisionGap`
at its site and logged as a gap.

## The interactions log

Usage telemetry, not part of the ledger: `~/.adroit/<corpus>/interactions.jsonl`, machine-local
and never committed (a committed log conflicts on every merge). One JSON object per line:

```json
{"ts": 1791636134865, "kind": "resolved-fork", "decisions": ["cart:guest-checkout-allowed"],
 "note": "guest order lookup answered by the email-key rule", "where": "ledger/product/shop", "src": "checkout walk 2026-10-04"}
```

`ts` is epoch milliseconds; `kind` is `resolved-fork`, `prevented` or `gap`; `note` is a bare
pointer of at most 200 characters, never a diary; `where` and `src` are non-empty. Routine
citations are not logged. The tools validate the log line by line, skipping a malformed line and
reading an absent log as empty. No agent reads events as decision input.

## Probes

- **Regeneration probe** — tests whether a tree is sufficient. A fresh agent with no session
  context reads only the scoped dump of the tree under test with its descendants, never a curated
  subset, and reports where two engineers would build observably different products and where
  decisions contradict. Its prompt declares facts ruled outside the tree, and neighbouring trees as
  black boxes, as givens. Its framing stays neutral: report exactly as many as found. Stop when the
  findings turn predominantly editorial.
- **Coherence probe** — when a tree settled earlier may disagree with the ledger as it now stands,
  a fresh agent reads the target tree's scoped read (the subtree, engineering, its ancestor nodes
  and the capabilities included on its chain) and reports contradictions within it. It is never
  judged against the whole ledger: a decision elsewhere binds nothing in the target, so comparing
  against it manufactures false conflicts. Siblings never contradict each other (see Build by
  depth); a rule in one that tries to govern another's entity is a scope finding. Nor is the probe framed on
  what changed since: a decision is right or wrong against its scope now.

Give a probe a capable model that has not seen the session. Never prompt "say none if
sufficient" or "don't go easy": framing alone has moved a finding count threefold. A capable
agent always finds something, so watch severity fall, not the count reach zero.

**Triage** each finding into one of five buckets:

1. **A real gap.** Ask the person.
2. **A re-litigation** of a ruled point. The decision lacked its losers: add them to `rejected`
   and don't re-ask.
3. **A miss of plain text, or an artifact of the probe's scope.** Note it and move on.
4. **Your own defect** — a failed edit, a stale phrase, patch sediment. Fix it.
5. **An edge case.** Foreclose it (see Practice).

When several findings collapse into one rule, that rule is usually a missing principle; minting
it retires a whole class of questions at once.

## Practice

The protocol is the rule; this is how it is done well.

### Starting a ledger

1. Create `ledger/` with only the roots you need and a `domains.yaml`.
2. Root each product tree in a story node.
3. Copy the seed nodes you want into `engineering/`.
4. Wire the check into CI, with a test that fails when a decision id cited in code or tests no
   longer resolves.
5. Convert any existing prose specification into the ledger, then delete it.

### Minting a decision

1. Read your scope.
2. Find the parent: the node this decision sharpens. If nothing fits, it may need a new story or
   capability.
3. Echo the concrete behavior in the person's words and get the yes on that.
4. Write the rule as one clause, with no implementation names and no ids. State what someone
   needs, not how the app does it.
5. Fill `rejected` with every alternative that was actually on the table; if a fresh reader would
   find the rule surprising, this is mandatory.
6. Run the check and read its complete output and exit code — never through `tail`.

### Walking a tree with a person

This is how a tree is built or checked conversationally, one story at a time.

1. **Survey the code.** Have an agent map what is built and sort the findings: *missing* (built,
   no decision), *contradicted* (the code breaks a decision), *misplaced* (wrong parent or tree),
   and *question* (a genuine product fork). Also ask what here has no justification.
2. **Draw the as-built tree**, marking each node ✓ (ruled, and the code matches), ⊂ (partly
   covered: the decision states a mechanism or a subset of what is built) or ∅ (built with no
   governing decision).
3. **Find the root story first**, then the peer journeys under it. Stories state needs, never
   screens.
4. **Ask one question at a time**, each with a recommendation, the live alternative, and one line
   on each trade-off. Lead with the foundational fork.
5. **Echo, get the yes, then mint.**
6. **Validate** with the check and confirm every edit actually landed. Log only verified results.

### Editorial pass

Run one when a tree is ruled, or after a burst of rapid rulings: rewrite the most-patched nodes
whole, keeping every ruling; read the tree end to end as one document; sweep for vocabulary left
behind by superseded rulings; split any clause that can be reversed alone; re-home nodes filed
where other work's scope cannot see them.

### Compliance

Change the ledger whenever a decision changes; the citations that go red are the compliance
worklist, not a blocker. When a ruling changes what an identifier means, search the code for the
concept and list every use as updated or unaffected. Have a reviewer, or an adversarial agent,
read each implementation diff against the scoped ledger before it is handed back.

### Guidelines

- **The quality bar.** A decision is "we could do X, but we do Y." If you cannot name what it
  rejected or what would violate it, it is a value, not a decision: "performance matters" fails.
- **Foreclose the edge.** When a rare, functionally irrelevant edge case surfaces, don't follow it
  through the chain of decisions it would require. Rule a clean restriction that stops it from
  arising, and record in `rejected` what reopening it would force someone to decide. Lead with the
  foreclosure as your recommendation.
- **Unruled is simply unruled.** Foreclosure is for an edge case that has surfaced. A choice
  nobody has decided is absent from the ledger; it is never recorded as "latitude" or "left to the
  builder". A noticed tension that isn't ready to rule becomes a question on its node.
- **Decide and log.** A call with no real fork — mechanical, or following from standing
  decisions — is decided, written, and listed for the person to see. Batch several under one yes
  only when none is a fork.
- **Ask at the fork.** Ask first when a choice duplicates something that exists, changes what
  people see, changes data shape, or sets a precedent. Fill mechanical gaps yourself. Classify by
  the shape of the choice, never by how confident you feel.
- **Write the composition down.** When several decisions combine into a surprising outcome, state
  the outcome as a decision, or every reader re-derives it and some get it wrong.
- **Promote repeats.** When the same reasoning settles questions in several trees, mint a
  principle in engineering and delete the decisions that only restated it. When the same "how"
  repeats, extract a capability and include it where it repeats.
- **Trees emerge.** A node that keeps needing another tree's decisions has grown up there; move
  it. When one tree's decisions keep naming another tree's concepts, a shared thing needs a name.
- **Propose once, after the evidence**, and slow down when rulings compound: a wrong premise
  poisons the whole batch.
- **Scope discipline.** Flag implications for trees outside the work; don't rewrite them from
  there.
- **Walk back on churn.** When exceptions pile up around one design, the design is wrong. Walk it
  back, and record the walked-back design and its forced exceptions in the new decision's
  `rejected`.

### Anti-patterns

| What happened | Do instead |
|---|---|
| Batch edits failed silently (an unmatched replace, a script aborted halfway) and the log still claimed the fixes | Verify every edit's anchor and result; log verified results, never the plan |
| Six splices over three days left a node contradicting itself | Rewrite whole on the third touch |
| Probes kept re-litigating the same rulings | Those decisions had no `rejected`; add the losers, including any alternative proposed twice |
| A later ruling dismantled an earlier decision's rationale and the earlier decision stayed | After a structural ruling, re-read the decisions whose why depended on the old premise |
| Trees took the shape of mechanisms inherited from a code survey or a backfilled spec | Ask what need each mechanism serves, and put the need on top |
| Negative mentions ("tool A knows no X") | The mention is the leak; state the insulation once, as a principle |
| Minting in the agent's vocabulary produced behavior the person never asked for | Echo concrete, visible behavior first |
| The agent's own enumeration became structure no ruling created | Every structural element traces to a ruling, or it is deleted |
| A superseded decision was kept because a test would go red | Delete it; the red test is the worklist |
| A fix branch cited a decision that existed only on the ledger branch | Carry new nodes onto the code branch byte-identical |
| A proposal marked "awaiting sign-off" was implemented anyway | A question you wrote down is not yours to answer |

## The engineering seed

Adroit ships `seed/`: default engineering decisions known to work with the methodology. It binds
nobody. A project starts its engineering tree by **copying** the seed nodes it wants into its own
`engineering/`; from then on each copy is the project's own, to contextualize or reverse with the
reason recorded. A copy never refers back to the seed.

## Adopting adroit

A project wires in:

- a `ledger/` with the roots it needs and a `domains.yaml`;
- each product tree rooted in a story;
- engineering nodes copied from the seed;
- the dump and check tools, with the check in CI;
- `@DecisionRef` bindings in code and tests, and a test that fails when a cited id no longer
  resolves;
- a CLAUDE.md that links this document as the methodology and keeps for itself only what the
  ledger cannot hold: build commands, file locations, tool notes. It cites decisions; it never
  restates them, and where it and the ledger disagree, the ledger wins.

An existing prose specification is converted into the ledger and then deleted, not frozen as
reference. A project's ledger holds only that project's decisions, including its rulings about its
own ledger practice (as engineering nodes); this document is not copied into it.

## The tools

```bash
node tools/dump.mjs                                   # the whole ledger, one JSON line per node
node tools/dump.mjs --scope <id|path>[,...]           # the scoped read for work on a decision
node tools/dump.mjs --scope <id|path> --subtree       # ...plus the target's descendants
node tools/dump.mjs --maintenance                     # keep context, dubious and questions
node tools/dump.mjs --interactions                    # append this machine's interactions log
node tools/server.mjs --check [--dir D]               # validate; exit 1 on any error
node tools/server.mjs --diff [ref]                    # semantic diff against a ref (default main)
node tools/server.mjs --open                          # the read-only explorer
```

`ADROIT_LEDGER_DIR` points the tools at another ledger, and `ADROIT_HOME` moves the interactions
log root. The check enforces this document's layout, node, model, id, include and severing rules;
open questions and uncited model fields are reported, never failed.
