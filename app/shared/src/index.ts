// @DecisionRef eng:typescript-end-to-end — the record and contract shapes are typed once here
// and shared by the server and the view across the boundary.

/** A commitment entry as it sits in a record's `commitments` list (model:record). */
// @DecisionRef eng:commitments-endure-until-canceled — one atomic entry per id, in exactly
// three forms: declaration (id + description, severable by default), adherence (id + one
// line), negation (id + flag).
// @DecisionGap no record fixes the YAML spelling of a commitment entry; chosen here as
// {id, description?|adherence?|negation?, severable?} — the smallest shape carrying the
// ruled attributes.
export interface CommitmentEntry {
  id: string;
  /** Present on a declaration. */
  description?: string;
  /** Declaration only; defaults to true when absent. */
  severable?: boolean;
  /** Present on an adherence: one line on how this decision plays out under the commitment. */
  adherence?: string;
  /** Present (true) on a negation. */
  negation?: boolean;
}

/** The closed field list of one decision at rest (model:record, eng:decision-per-file). */
export interface RecordDoc {
  id: string;
  decision: string;
  rejected: string[];
  links: RecordLinks;
  context: Record<string, unknown>;
  commitments?: CommitmentEntry[];
}

export interface RecordLinks {
  grounds?: string[];
  consumes?: string[];
  tension?: string[];
  /** Classifiers, e.g. domain / module, plus any project-defined ones. */
  [classifier: string]: unknown;
}

/** A model record: flat shape at rest plus pending entries (adr:models-flat-views-derived). */
export interface ModelDoc {
  id: string;
  summary: string;
  fields: Record<string, string>;
  /** Ruled divergence not yet migrated (change-propose set-model-field). */
  pending?: PendingFieldEntry[];
}

// @DecisionRef eng:changes-are-projectable — a pending model change is a normalized,
// machine-readable field change any tool can project onto the model at read time.
export interface PendingFieldEntry {
  field: string;
  op: 'add' | 'change' | 'remove';
  /** The ruled shape (absent for remove). */
  intended?: string;
  /** The deployed shape the model file keeps stating (absent for add). */
  current?: string;
  /** Decision ids whose committing ruled this entry into existence. */
  origin?: string[];
}

/** A migration in flight at rest (model:change), under models/pending-changes/. */
export interface ChangeDoc {
  name: string;
  model: string;
  origin: string[];
  operations: PendingFieldEntry[];
  state: string;
}

/** A capability's published interface (adr:capability-contract-artifact). */
export interface ContractDoc {
  capability: string;
  version: number;
  summary: string;
  operations?: Record<string, string>;
  outputs?: Record<string, string>;
  'not-offered'?: string;
  'blast-radius'?: string;
  /** Declarations incorporated by every consuming root (eng:commitments-endure-until-canceled). */
  commitments?: { id: string; description: string; severable?: boolean }[];
  [extra: string]: unknown;
}

// ---------------------------------------------------------------------------
// Derived facts the server computes and the view renders (eng:thin-server-owns-files:
// the browser never derives from disk; everything below arrives from the server).

export type RootKind = 'product' | 'capabilities' | 'models' | 'engineering';

export interface EffectiveCommitment {
  id: string;
  description: string;
  severable: boolean;
  /** Record id, or `capability:<name>` when incorporated from a contract. */
  declaredBy: string;
  /** This record's own adherence line, when it wrote one. */
  adherence?: string;
}

export interface DubiousReason {
  kind: 'ancestor-decision' | 'moved' | 'consumed-change';
  /** The ancestor or consumed thing whose change cast the suspicion. */
  source: string;
  /** Epoch seconds of the casting change (0 = uncommitted, i.e. now). */
  at: number;
}

export interface DerivedRecord {
  id: string;
  /** Path relative to the ledger directory. */
  path: string;
  root: RootKind;
  /** Product tree name or capability name when applicable. */
  treeName?: string;
  parent?: string;
  children: string[];
  depth: number;
  doc: RecordDoc;
  /** Records whose links.consumes name this record. */
  consumers: string[];
  /** Nodes in this record's subtree, including itself. */
  subtreeSize: number;
  effectiveCommitments: EffectiveCommitment[];
  /** Commitment ids this record negates. */
  negations: string[];
  // @DecisionRef ui:edits-cast-suspicion — an unworked suspect reads as DUBIOUS wherever it
  // appears; the reasons say what cast it.
  dubious: DubiousReason[];
  /** Interaction-log earned-its-keep count (eng:log-ledger-interactions). */
  interactionCount: number;
}

// @DecisionRef ui:surface-structural-skew — the macro view surfaces where the mass
// concentrates without being asked; these are the server-measured signals.
export interface SkewSignal {
  id: string;
  kind: 'concentration' | 'sparse';
  /** For concentration: the child holding the mass and its share of the subtree. */
  child?: string;
  share?: number;
  note: string;
}

export interface CommitmentIncoherence {
  recordId: string;
  commitmentId: string;
  kind:
    | 'adherence-out-of-force'
    | 'negation-out-of-force'
    | 'negation-of-unseverable'
    | 'declare-beneath-negation'
    | 'adhere-and-negate';
  note: string;
}

export interface DerivedModel {
  id: string;
  path: string;
  doc: ModelDoc;
  /** The pending entries projected onto the deployed fields: the ruled shape. */
  projectedFields: Record<string, string>;
  consumers: string[];
  dubious: DubiousReason[];
}

export interface DerivedCapability {
  name: string;
  contractPath: string;
  contract: ContractDoc;
  /** Record ids whose links.consumes name this capability. */
  adherents: string[];
  /** The capability's own records, if any. */
  records: string[];
}

export interface LedgerSnapshot {
  corpus: string;
  domains: Record<string, string>;
  productTrees: { name: string; rootId: string }[];
  records: Record<string, DerivedRecord>;
  models: DerivedModel[];
  changes: { path: string; doc: ChangeDoc }[];
  capabilities: DerivedCapability[];
  skew: SkewSignal[];
  incoherences: CommitmentIncoherence[];
  /** Ledger-relative paths currently differing from HEAD: the in-flight working diff. */
  workingDiff: string[];
}

// ---------------------------------------------------------------------------
// The change-propose contract's operations: the only write path.
// @DecisionRef ui:change-the-ledger — all ledger writes go through these operations.

export type Operation =
  | CreateRecordOp
  | EditFieldOp
  | MoveRecordOp
  | SetModelFieldOp
  | BeginMigrationOp
  | PublishContractOp;

export interface CreateRecordOp {
  op: 'create-record';
  /** Parent record id, or a root designator like `product/ui`, `engineering`. */
  parent: string;
  record: RecordDoc;
}

// @DecisionRef ui:all-but-id-editable — the editable set is every field but the id;
// refines is not a field (the path carries it).
export type EditableField = 'decision' | 'rejected' | 'links' | 'context' | 'commitments';

export interface EditFieldOp {
  op: 'edit-field';
  id: string;
  field: EditableField;
  value: unknown;
}

export interface MoveRecordOp {
  op: 'move-record';
  id: string;
  /** New parent record id or root designator. */
  newParent: string;
}

export interface SetModelFieldOp {
  op: 'set-model-field';
  model: string;
  entry: PendingFieldEntry;
}

export interface BeginMigrationOp {
  op: 'begin-migration';
  model: string;
  name: string;
  /** The pending entries (by field name) this migration gathers. */
  fields: string[];
  origin: string[];
}

export interface PublishContractOp {
  op: 'publish-contract';
  name: string;
  contract: ContractDoc;
}

export interface ChangeRequest {
  operations: Operation[];
  /** Commit message; defaulted from the operations when omitted. */
  message?: string;
  /** When false, apply to the working tree without committing (in-flight state). */
  commit?: boolean;
}

// @DecisionRef eng:outcome-honesty — the response reports what actually happened,
// divergences included.
export interface ChangeOutcome {
  ok: boolean;
  committed: boolean;
  commit?: string;
  touched: string[];
  /** Record ids the change casts suspicion over (ui:edits-cast-suspicion). */
  suspects: string[];
  /** Populated on refusal: nothing was written (eng:refusal-writes-nothing). */
  refusal?: string;
}

export interface SearchHit {
  /** Record / model / change / contract id when the hit lives in one. */
  id?: string;
  path: string;
  /** Which field matched (decision, rejected[1], context.why, id, ...). */
  field: string;
  snippet: string;
  /** Where it lives in the hierarchy: ancestor ids from root. */
  hierarchy: string[];
  root: RootKind | 'ledger';
}

export interface CodeCitation {
  id: string;
  file: string;
  line: number;
  /** The citing line plus surrounding context. */
  snippet: string;
  /** Epoch seconds of the file's last commit, 0 when uncommitted. */
  fileLastChanged: number;
  /** True when the file changed after the decision's rule last changed. */
  changedSinceDecision?: boolean;
}

export interface InteractionEvent {
  ids: string[];
  kind: 'resolved-fork' | 'prevented' | 'gap';
  note: string;
  where?: string;
  at?: string;
}
