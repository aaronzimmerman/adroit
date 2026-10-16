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
- `capabilities/<name>/` — reusable subtrees, each grafted wherever its "how" repeats.
- `engineering/` — decisions that shape code: platforms, postures, coding practices, UX
  principles, and the project's rulings about its own ledger practice.
- `models/` — the typed **views**: the data shapes that cross section and trust boundaries in the
  current implementation.
- `domains.yaml` — the registry of id domains.

Nothing else sits at the top level; a stray directory would hold files nobody checks. A ledger
opens only the roots it has nodes for, and an absent root is an empty one.

**The hierarchy is the filesystem.** Directory nesting is parentage. A directory's own decision is
its `self.yaml`; the directory's other files and subdirectories are its children, and a decision
with no children is a plain `<slug>.yaml`. Re-parenting is a file move. References bind to
decision ids, never to paths, so a move breaks nothing that cites the moved decision. The files
exist for git — diff, merge, blame and review — so two sessions claiming the same id surface as a
merge conflict rather than a silent overwrite.

Where a node belongs is measured, not ascribed: a rule binding all work is engineering, a "how"
that repeats in several places is a capability, and what serves one story is product. Trees emerge
from the decisions that cluster to support a story, and moving a node that grew up somewhere else
is the normal, healthy response. A measurement nominates a move; a person blesses it.

## The node

Every file under `product/`, `capabilities/` and `engineering/` is a **node**, and a node is **one
decision**. Its keys, in this order, and no others:

```yaml
id: cart:guest-checkout-allowed       # domain:slug, unique across the ledger, never edited
name: Guest checkout                  # a label for readers; the file name is its slug
decision: >-                          # one clause, stating one reversible choice
  A shopper can check out without an account, and the order is keyed to {order.email}.
rejected:                             # optional: the parallel alternatives that lost, each with why
  - account required at checkout — abandonment outweighs the retention gained
references: [view:order]              # optional: views whose data this decision governs
includes: [payments]                  # optional: capabilities grafted beneath this node
dubious: parent ruling on accounts changed — re-read   # why this node is suspect, if it is
questions:                            # open tensions, one line each
  - Does a guest see past orders when they later sign up?
context: >-                           # one free-form text: the author's own thinking; never a rule
  Requiring an account cost more carts than it retained.
```

- **Id and name.** The id is what everything cites. The name is a label for readers; the file name
  is the name as a slug, and nothing keys off either. Ids live only inside files.
- **One clause, one choice.** A decision states one independently reversible choice. A ruling
  spoken in one breath that holds several choices becomes several nodes: the clause that names the
  ruling best keeps its id, and the others become child files beneath it. Granularity is about
  reversibility, not size: a long decision of one inseparable rule is fine; a short one hiding two
  choices is not. Rationale goes to `context`; a definition is its own node beneath the node where
  the term is used. Several fields each governed separately are separate nodes.
- **Rules, not implementation.** A decision states the rule so a reader can comply or detect a
  violation. No table, column, class, route or migration names, unless the name is itself the
  thing chosen. A product decision states what someone needs to do, not how the app works; a
  mechanism is a product decision only where the mechanism is itself the choice, and the node says
  why. A story states a need, never an interface, and never why it is vague: the interface is the
  emergent result of the stories under the engineering decisions.
- **Wording.** No record ids inside decision text: relationships are structural (the parent is
  the directory, a capability is an include, a view is a reference or a field token). A term is
  defined in one decision and used, not redefined, elsewhere. Name the actor ("an organizer", "the
  shopper"), never a bare "a user". A decision never enumerates other decisions (no closed lists of
  siblings, no counts of kinds), because the set is the tree; it may list its own parts. A decision
  states only the present rule: no dates, revision notes or "previously, now" narrative. A changed
  ruling is rewritten whole to read as if it had always been so.
- **Rejected.** A decision that defies a fresh reader's instinct names the alternatives it beat,
  each with the reason it lost. This is what stops the same idea being proposed fresh. A rejected
  entry is only a parallel decision: a clear alternative that was on the table, with why it lost.
  It is never a gloss on the decision, a reading of it, or decision content kept out of the
  clause; what binds lives in `decision` or nowhere. Rejected text carries no history either: no
  dates and no account of the decision's earlier form.
- **References and field tokens.** A decision that governs a view's data lists the view under
  `references:`. A decision that addresses one field writes it inline as `{slug.field}` — the
  view's slug and the field's name — in its decision or rejected text, and the token implies the
  reference, so `references:` is needed only where no token names the view. A token replaces prose
  that names the field's data; concepts stay prose.
- **Context is the author's own thinking.** One free-form text the author writes in, with no
  sub-keys. It is never history (no dates, no account of how a decision was minted, split, lifted
  or superseded) and never provenance, source pointers or links in disguise; version control holds
  the history. Nothing in it may be needed to comply; anything that binds is a decision or part of
  what one rejected.
- **No implementation state.** No node says what code must change, what is or isn't built yet, or
  which code disagrees with it. The gap between decisions and code is found by comparing the two
  and belongs to the build plan. The only described implementation state is the views.
- **No workflow state.** Nodes carry no status. Superseded decisions are deleted, not marked.
  `dubious` and `questions` are maintenance notes, not workflow steps.

## Reading the tree

**Every decision is a "how" of its direct parent.** The tree is one document read top-down in
increasing specificity, never a scope chain. A decision describes its own node and informs the
branch beneath it, and has no bearing anywhere else, however universal it sounds. It never
legislates over its descendants: "every surface …" is the smell. A node that does something
differently from what sits above it states its own how right there, and being deeper, it is the
more specific reading. There is no severing.

**Build by depth.** A product can be built by following each hierarchy strictly by depth. A node
is judged and implemented only against its own reading: its ancestors, engineering, and the
capabilities grafted on that path — never its siblings or cousins. Siblings are considered
together only as refinements of their common parent: a decision every child of a node states is
lifted to that node, never when just some do, and a sibling whose refinement contradicts the
parent is a finding against the parent. Two siblings resolving the same situation differently is
legitimate divergence, not a contradiction. A decision that only restates a rule already in a
node's reading is deleted, and code citing it is re-pointed to the decision that holds the rule.

**Capabilities.** A capability is a subtree under `capabilities/<name>/`, rooted at its own
`self.yaml`, whose decisions together state what an includer takes on. It exists so the same thing
is built the same way everywhere its how repeats. `includes: [name]` grafts the capability's tree
beneath the including node, read exactly as if its nodes were nested there, together with whatever
its own nodes include, transitively. A capability is included on exactly the nodes that use it,
never at a common ancestor merely because every child uses it somewhere; lifting an include
follows the same every-child rule as lifting a decision. A node that does the capability's job
differently states its own how on that same node, so the divergence lands on what differs.

A capability holds **mechanics, and defaults** for when the includer says nothing. Nothing in it
reaches outside its own graft, and it never places an obligation on its includers ("whatever
includes this must declare that"): such a rule is about authoring the ledger, which code cannot
satisfy. A capability speaks its own vocabulary and never names a product or an includer.
Capabilities include one another one way only; self-includes and include cycles are errors.

**Plumbing is engineering.** A rule that binds every request — the boundary, observability,
security, flags, storage — is an engineering decision, not a capability, because nothing chooses
to include it.

**Principles** are value judgments, ids under `principle:`, living in `engineering/`. Since every
piece of work reads engineering whole, a principle binds everything with no reference needed.

## Reading a ledger

Agents read the ledger **only through the dump**, never the raw files, so that maintenance notes
are never weighed as law.

- **Read your scope** before work on a decision: the engineering tree whole, then each ancestor
  node, the target node, and every capability grafted on that path, each as its whole tree. Add
  the target's descendants when the work changes the target itself. Searching for the decisions a
  task seems to touch fails, because the decision that gets violated is the one the task did not
  seem to touch.
- **The whole ledger** is read only for whole-ledger work, such as a vocabulary sweep or a
  coherence probe.
- **The dump leaves out** `context`, `dubious` and `questions` unless maintenance work asks for
  them.
- **The referrer walk** lists a view and every decision that references it, explicitly or through
  a field token. It is a planning instrument, never part of an implementation scope.
- Detail below a decision is read from the code and its tests. There is no second description.

## Views

`models/` holds only **views**: the typed data shapes — transfer objects — that move between
sections of the system or across a trust boundary. A view describes the implementation as it
stands; it is not a decision tree. A view is one shape that crosses a boundary, never one per
screen, and invariants at rest are stated as observable promises through the views that expose
them. Storage is memorialized by the project's migrations and code, never mirrored in the ledger.

A view file holds an `id` (`view:<slug>`), a short `decision` statement of the concept, a typed
`schema:` holding `fields` only, and optionally `rejected`, `links` and `context`:

```yaml
id: view:order
decision: One order, as the shopper and the store both see it.
schema:
  fields:
    email: string (cart:guest-checkout-allowed) — the address a guest order is keyed to
    status: enum<OPEN|PAID|SHIPPED> — where the order stands
    lines: list<ref<view:order-line>> — what was bought
links:
  consumes: [view:order-line]
```

- **A field reads** `<type> [(ids)] [— meaning]`. The type is one space-free token from a closed
  vocabulary: `string`, `text`, `int`, `long`, `double`, `bool`, `epoch`, `date`, `json`,
  `enum<A|B>`, `ref<view:x>`, `derived<type>`, `list<type>`, `map<key,type>` (keys `string`, `int`
  or `long`). A bare id where no view crosses in that context is a plain scalar, never a ref to an
  invented view. Field names are plain, with no dots, so tokens can address them.
- **Citations are the wiring.** Every id a field cites must resolve; those citations link the
  shape to the decisions that rule it. A field citing nothing is reported as a probable orphan,
  never failed.
- **A view states current truth.** It has no tables and no pending shape: a ruled but unbuilt
  shape lives in the decisions that reference the view, and the view changes when the
  implementation does.
- **Links.** `consumes` names only other views; `grounds` names the principles a view grounds in.
- **A shape change is planned wide.** Before a view's shape changes, walk its referrers and address
  every one: each is declared unaffected, or given a decision at its own node saying how the new
  shape reaches it.

A ruling has no staged form: it is a point in time, its only in-flight state is the uncommitted
working tree, and source control is its history.

## Ids and the registry

An id is `domain:slug`. The slug is two to five kebab-case words naming the decision's substance
(`refusal-writes-nothing`, not `rule-7`), unique across the ledger, never numbered. The domain is
looked up, never inferred from the id's shape: a domain declared in `domains.yaml`, a capability's
name, or a reserved kind (`principle`, `story`, `view`). Declare a domain before any decision uses
it.

`domains.yaml` holds a `corpus:` key naming the ledger, then one line per domain: the lowercase
domain and a one-line scope.

Every structural name — an included capability, a reference, a field token, a field's citation —
must resolve, and no per-node waiver legalizes one that doesn't.

## Dubious

`dubious` is one line saying why a node is suspected of no longer being coherent; it is absent when
the node is not suspect. It says the node's validity is not assured.

- **What makes a node suspect.** Any edit to a node's decision, rejected, references, includes or
  context makes every descendant suspect, and, for a node inside a capability, every node that
  includes that capability, directly or through another capability it includes, with its
  descendants. Deleting a node inside a capability makes every includer of that capability
  suspect the same way. Moving a node makes the moved subtree suspect, since its reading changed. Asking, answering or dropping a question makes nothing suspect.
- **How it is written.** The commit that makes a change writes the mark onto every suspect,
  naming the node whose change made it suspect; the mark always lands, and reading a suspect
  before the commit clears nothing. A person can also
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

`questions` lists one-line open tensions in or around a node's decision. A complex system always
carries tension, and a ledger that could hold only settled rulings would either lose the tension or
call itself broken. A ledger with open questions is in good standing: the check reports them and
never counts them as faults.

A question says nothing about the validity of its node, which is what `dubious` says; a sound node
can carry questions. A question that launches new work sits on the node that work would grow from.
A question ends by removing its line: answered, by clarifying a decision or minting the decisions
that resolve it, or dropped as unhelpful. While it stays, it is future work.

## The protocol

- **Read your scope first**, through the dump.
- **Plan wide, build closed.** Work runs in two contexts. Planning reads wide: the blast radius of
  a change is assessed against the ledger, and the decisions that propagate it land with the
  person, each at the node it touches. Implementation gets a closed brief naming only the law
  already ruled, with the standing instruction "this unit only; report adjacencies, don't fix". The
  implementer surfaces anything outside its brief, never acts on it, and never receives the wider
  graph — no referrer walk, no maintenance notes. Bias toward surfacing: a false positive costs one
  sentence; a miss is a leak.
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
  of asking, becomes a node in the same change that acts on it, with what it rejected and its place
  in the tree.
- **A ruling lands as one atomic commit** across every file it touches.
- **Supersession deletes.** A superseded decision is deleted whole; git history is the archive.
  Deleting a node deletes everything nested beneath it, as deleting a feature deletes its parts;
  whatever should survive is moved out first. Code and test citations of the deleted ids are
  rebound or removed. Two decisions that disagree mean one was superseded.
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
 "note": "guest order lookup answered by the email-key rule", "where": "ledger/product/shop", "src": "checkout walk"}
```

`ts` is epoch milliseconds; `kind` is `resolved-fork`, `prevented` or `gap`; `note` is a bare
pointer of at most 200 characters, never a diary; `where` and `src` are non-empty. Routine
citations are not logged. The tools validate the log line by line, skipping a malformed line and
reading an absent log as empty. No agent reads events as decision input.

## Probes

- **Regeneration probe** — tests whether a tree is sufficient. A fresh agent with no session
  context reads only the scoped dump of the tree under test with its descendants, never a curated
  subset, and reports where two engineers would build observably different products. Its prompt
  declares facts ruled outside the tree, and neighbouring trees as black boxes, as givens. Its
  framing stays neutral: report exactly as many as found. Stop when the findings turn
  predominantly editorial.
- **Coherence probe — the compile check.** A contradiction exists only when one node's reading
  disagrees with itself: the node, its ancestor path, engineering, and the capability trees grafted
  on that path, a graft's interior nodes read against their own graft path, never against the
  includer's other branches. It is checked per node; siblings and cousins are never compared.
  Every proposed finding is validated mechanically: a pair of decisions that appear together in no
  node's reading is discarded, whatever the probe argued. Nor is the probe framed on what changed
  since: a decision is right or wrong against its reading now.

Contradiction-freedom is compilation only. Whether the decisions are functionally right is proven
by building from them, never by further editorial sweeps: once the ledger compiles, build.

Give a probe a capable model that has not seen the session. Never prompt "say none if
sufficient" or "don't go easy": framing alone has moved a finding count threefold. A capable
agent always finds something, so watch severity fall, not the count reach zero.

**Triage** each finding the moment it is raised, conversationally, into one of five buckets —
never into a task file:

1. **A real gap.** Ask the person.
2. **A re-litigation** of a ruled point. The decision lacked its losers: add them to `rejected`
   right there and don't re-ask.
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
2. Find the parent: the node this decision is a how of. If nothing fits, it may need a new story
   or capability.
3. Echo the concrete behavior in the person's words and get the yes on that.
4. Write the rule as one clause, with no implementation names and no ids. State what someone
   needs, not how the app does it. Name a view's field as a token where the decision governs it.
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
where other work's reading cannot see them.

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
| Context and rejected drifted into dated history, source pointers and glosses on the rule | Version control holds history; context is the author's own thinking, rejected holds only parallel alternatives |
| A high node said "every surface …" and its descendants inherited a rule nobody ruled for them | A decision describes its own node; a node that needs the rule states its own how |
| Siblings were compared and their divergence filed as a contradiction | Compare only within one node's reading; siblings diverging is legitimate |
| A view's shape changed and the decisions that relied on the old shape went unread | Walk the referrers first; address each one at its own node |

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
node tools/dump.mjs --referrers <view:id>[,...]       # planning only: a view and its referrers
node tools/dump.mjs --maintenance                     # keep context, dubious and questions
node tools/dump.mjs --interactions                    # append this machine's interactions log
node tools/server.mjs --check [--dir D]               # validate; exit 1 on any error
node tools/server.mjs --diff [ref]                    # semantic diff against a ref (default main)
node tools/server.mjs --open                          # the read-only explorer
```

`ADROIT_LEDGER_DIR` points the tools at another ledger, and `ADROIT_HOME` moves the interactions
log root. The check enforces this document's layout, node, view, id, include, reference and token
rules; open questions and uncited view fields are reported, never failed. A file the check cannot
parse is reported as an error and the rest of the ledger is still validated.
