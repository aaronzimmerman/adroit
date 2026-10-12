// @DecisionRef eng:shapes-typed-once — the node and model shapes are declared here once and
// imported by both the server and the view across the boundary.
// @DecisionRef eng:typescript-end-to-end — one language on both sides of that boundary.

// ---------------------------------------------------------------------------
// At rest: the files a ledger holds (ADROIT.md, The node; Models)

/** One peer decision of a node. */
export interface DecisionEntry {
  id: string;
  decision: string;
  rejected?: string[];
  severable?: boolean;
}

/** A node file: a name and its peer decisions, plus the optional keys, in file order. */
export interface NodeDoc {
  name: string;
  decisions: DecisionEntry[];
  includes?: string[];
  severed?: string[];
  dubious?: string;
  questions?: string[];
  context?: unknown;
}

/** A model or view file under models/: its own format, not a node. */
export interface ModelDoc {
  id: string;
  decision: string;
  shape?: {
    /** Field name -> its deployed definition (kind, cited decision ids, meaning). */
    fields?: Record<string, string>;
    /** Field name -> its intended definition, recorded beside the deployed one. */
    pending?: Record<string, string>;
  };
  [other: string]: unknown;
}

/** One field change a pending change carries. */
export interface PendingOperation {
  model: string;
  field: string;
  /** The deployed definition it replaces; absent when the field is new. */
  deployed?: string;
  intended: string;
}

/** A migration in flight, one file under models/pending-changes/. */
export interface PendingChangeDoc {
  name: string;
  origin: string[];
  operations: PendingOperation[];
  state: string;
}

// ---------------------------------------------------------------------------
// Derived on the server, rendered by the view (eng:browser-is-pure-view: the view never
// derives from disk — everything below arrives from the server).

/** A place in the ledger directory: the hierarchy IS the filesystem. */
export type PlaceKind = 'root' | 'dir' | 'node' | 'model' | 'pending-change' | 'file';

export interface Place {
  /** Ledger-relative path: a directory node's directory, a leaf's file; '' is the ledger itself. */
  path: string;
  kind: PlaceKind;
  /** The node's name, the model's id, or the file or directory name. */
  label: string;
  parent: string | null;
  children: string[];
  node?: NodeView;
  model?: ModelView;
  change?: PendingChangeDoc;
  /** A file the parser refused: its text, so it can still be read. */
  raw?: string;
  /** True when a file at this place differs from the last commit. */
  uncommitted: boolean;
}

export interface CapabilityInScope {
  name: string;
  /** The capability root's place, when it has one. */
  root: string | null;
  /** The place of the chain node (or capability) that brings it into scope. */
  via: string;
  /** How many decisions the capability's whole tree holds. */
  decisionCount: number;
}

export interface NodeView {
  /** The node file, ledger-relative. */
  rel: string;
  /** product/<app>, capabilities/<name> or engineering. */
  tree: string;
  /** As read; a malformed node keeps whatever could be read. */
  doc: NodeDoc;
  /** Ancestor places, root first. */
  ancestors: string[];
  /** Every capability in scope: included on the chain, and what those include. */
  capabilities: CapabilityInScope[];
  /** Severed decision id -> the place of the chain node that severs it. */
  severed: Record<string, string>;
  /** When this node lives in a capability: the capability's name. */
  capability?: string;
  /** When this node is a capability's root: the places of every node including it. */
  includers?: string[];
  /** How many nodes become suspect when this node's decisions change. */
  dependents: number;
  /** The context as the file writes it, for editing in place. */
  contextText: string;
}

export interface ModelFieldView {
  name: string;
  /** Absent when the field is not yet deployed. */
  deployed?: string;
  /** Present while a pending entry or pending change carries an intended definition. */
  intended?: string;
  /** Where the intended definition lives: the model file, or a pending change's place. */
  pendingIn?: 'model' | string;
  /** Decision ids the field's definition cites. */
  cites: string[];
}

export interface ModelView {
  id: string;
  decision: string;
  fields: ModelFieldView[];
}

export interface Finding {
  /** The place the finding is shown on. */
  place: string;
  /** What the check names: a decision id or a ledger path. */
  subject: string;
  rule: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface LedgerView {
  /** The opened ledger directory, absolute. */
  dir: string;
  corpus: string;
  domains: Record<string, string>;
  /** The git repository holding the ledger; null when there is none. */
  repo: string | null;
  places: Record<string, Place>;
  /** The top-level places, in reading order. */
  roots: string[];
  findings: Finding[];
  /** Decision id -> the place of its node. */
  decisions: Record<string, string>;
}

// ---------------------------------------------------------------------------
// The write path: every change is a list of operations landing as one commit.

/** The node fields edited whole; a decision's id is not among them (ui:all-but-id-editable). */
export type NodeField = 'name' | 'includes' | 'severed' | 'context' | 'questions';
/** The decision fields edited in place. */
export type DecisionField = 'decision' | 'rejected' | 'severable';

export type Operation =
  | { op: 'edit-node'; place: string; field: NodeField; value: unknown; clearDubious?: boolean }
  | { op: 'edit-decision'; place: string; id: string; field: DecisionField; value: unknown; clearDubious?: boolean }
  | { op: 'add-decision'; place: string; entry: DecisionEntry; clearDubious?: boolean }
  | { op: 'create-node'; parent: string; doc: NodeDoc }
  | { op: 'move-node'; place: string; newParent: string }
  | { op: 'extract-capability'; place: string; name: string; includers: string[] }
  | { op: 'mark-dubious'; place: string; reason: string }
  | { op: 'confirm'; place: string }
  | { op: 'set-model-field'; model: string; field: string; intended: string }
  | { op: 'begin-migration'; name: string; origin: string[]; entries: { model: string; field: string }[] }
  | { op: 'land-migration'; name: string };

export interface ChangeRequest {
  operations: Operation[];
  /** Commit message; defaulted from the operations when omitted. */
  message?: string;
  /** Suspect places the user read through and confirmed during the walk. */
  worked?: string[];
}

export interface Suspect {
  /** Where the node lives once the change lands; later operations of the change name it so. */
  place: string;
  /** Where to read it now, before the change lands (differs only when the change moves it). */
  readAt: string;
  name: string;
  /** Why it is suspect, naming the node whose change made it so. */
  reason: string;
}

/** What a change would do, measured before anything is written. */
export interface ChangePreview {
  suspects: Suspect[];
  /** Ledger-relative paths the change writes. */
  touched: string[];
}

// @DecisionRef eng:outcome-honesty — the response reports what actually happened, the marks
// this commit wrote included.
export interface ChangeOutcome {
  ok: true;
  commit: string;
  touched: string[];
  suspects: Suspect[];
  /** The suspects this commit marked dubious: the unworked part of the suspect set. */
  marked: string[];
  /** Where the changed node now lives, when the change moved or created one. */
  landedAt?: string;
}

export interface SearchHit {
  place: string;
  /** What matched: name, a decision id's text, rejected, context, a model field... */
  field: string;
  snippet: string;
  /** Where it lives: the labels of the places above it, root first. */
  trail: string[];
}

export interface CodeCitation {
  id: string;
  file: string;
  line: number;
  /** The citing line with the code around it. */
  snippet: string;
  /** Epoch seconds of the file's last content change; 0 when uncommitted now. */
  fileLastChanged: number;
  /** True when the file changed after the decision's text last changed. */
  changedSinceDecision: boolean;
  /** The file's diff since the decision last changed; empty when it has not moved. */
  diff: string;
}
