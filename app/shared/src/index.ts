// @DecisionRef eng:shapes-typed-once — the node and view shapes are declared here once and
// imported by both the server and the view across the boundary.
// @DecisionRef eng:typescript-end-to-end — one language on both sides of that boundary.

// ---------------------------------------------------------------------------
// At rest: the files a ledger holds (ADROIT.md, The node; Views)

/** A node file: one decision, with its keys in file order. */
export interface NodeDoc {
  id: string;
  name: string;
  decision: string;
  rejected?: string[];
  /** The views this decision governs, as the file lists them. */
  references?: string[];
  includes?: string[];
  dubious?: string;
  questions?: string[];
  /** One free-form text; an older file may still hold a mapping. */
  context?: unknown;
}

// ---------------------------------------------------------------------------
// Derived on the server, rendered by the view (eng:browser-is-pure-view: the view never
// derives from disk — everything below arrives from the server).

/** A place in the ledger directory: the hierarchy IS the filesystem. */
export type PlaceKind = 'root' | 'dir' | 'node' | 'view' | 'file';

export interface Place {
  /** Ledger-relative path: a directory node's directory, a leaf's file; '' is the ledger itself. */
  path: string;
  kind: PlaceKind;
  /** The node's name, the view's id, or the file or directory name. */
  label: string;
  parent: string | null;
  children: string[];
  node?: NodeView;
  view?: ViewRecord;
  /** A file the parser refused: its text, so it can still be read. */
  raw?: string;
  /** True when a file at this place differs from the last commit. */
  uncommitted: boolean;
}

export interface NodeView {
  /** The node file, ledger-relative. */
  rel: string;
  /** product/<app>, capabilities/<name> or engineering. */
  tree: string;
  /** As read; a malformed node keeps whatever could be read. */
  doc: NodeDoc;
  /** Every view the decision governs: its references, then each view a field token names. */
  views: string[];
  /** Ancestor places, root first. */
  ancestors: string[];
  /** When this node lives in a capability: the capability's name. */
  capability?: string;
  /** When this node is a capability's root: the places of every node including it. */
  includers?: string[];
  /** How many nodes become suspect when this node's decision changes. */
  dependents: number;
  /** The context as text, for editing in place. */
  contextText: string;
}

/** One typed field of a view. */
export interface ViewField {
  name: string;
  /** The type token as written; '?' when the field does not parse. */
  type: string;
  /** Decision ids the field cites. */
  cites: string[];
  meaning: string;
  /** The definition as the file writes it. */
  raw: string;
}

/** A view read as its typed fields (ADROIT.md, Views). */
export interface ViewRecord {
  id: string;
  decision: string;
  rejected: string[];
  fields: ViewField[];
  /** The views it consumes and the principles it grounds in. */
  consumes: string[];
  grounds: string[];
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
  /** Record id — a decision's or a view's — -> its place. */
  ids: Record<string, string>;
}

// ---------------------------------------------------------------------------
// The write path: every change is a list of operations landing as one commit.

/** The node fields edited in place; the id is not among them (ui:all-but-id-editable). The
 * dubious mark is edited by marking and confirming. */
export type NodeField = 'name' | 'decision' | 'rejected' | 'references' | 'includes' | 'context' | 'questions';

export type Operation =
  | { op: 'edit-node'; place: string; field: NodeField; value: unknown; clearDubious?: boolean }
  | { op: 'create-node'; parent: string; doc: Pick<NodeDoc, 'id' | 'name' | 'decision' | 'rejected'> }
  | { op: 'delete-node'; place: string }
  | { op: 'move-node'; place: string; newParent: string }
  | { op: 'extract-capability'; place: string; name: string; includers: string[] }
  | { op: 'mark-dubious'; place: string; reason: string }
  | { op: 'confirm'; place: string };

export interface ChangeRequest {
  operations: Operation[];
  /** Commit message; defaulted from the operations when omitted. */
  message?: string;
}

export interface Suspect {
  /** Where the node lives once the change lands. */
  place: string;
  /** Where to read it now, before the change lands (differs only when the change moves it). */
  readAt: string;
  name: string;
  /** Why it is suspect, naming the node whose change made it so. */
  reason: string;
}

/** A node a change deletes, with its decision. */
export interface Removed {
  /** Where it is now. */
  place: string;
  name: string;
  id: string;
  decision: string;
}

/** What a change would do, measured before anything is written. */
export interface ChangePreview {
  suspects: Suspect[];
  /** Every node, with its decision, the change deletes. */
  removed: Removed[];
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
  removed: Removed[];
  /** The suspects this commit marked dubious. */
  marked: string[];
  /** Where the user lands: the changed node's place, or the parent of a deleted one. */
  landedAt?: string;
}

export interface SearchHit {
  place: string;
  /** What matched: name, id, decision, rejected, context, a view field... */
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

/** A commit offered by the opened ledger's history. */
export interface HistoryCommit {
  hash: string;
  author: string;
  /** Commit time in epoch seconds, rendered with the app's shared time helper. */
  epoch: number;
  subject: string;
}

export interface HistoryPage {
  /** The history's fixed tip for subsequent pages; null in an unborn repository. */
  head: string | null;
  commits: HistoryCommit[];
  hasMore: boolean;
}

export interface HistoryFile {
  /** Ledger-relative path, including files that no longer exist. Moves are delete/add pairs. */
  path: string;
  status: 'A' | 'M' | 'D' | 'T';
}

export interface HistoryFiles {
  commit: string;
  /** The first parent; null for the initial commit. */
  parent: string | null;
  files: HistoryFile[];
}

export interface HistoryDiff {
  commit: string;
  path: string;
  /** Git's unified patch, including file headers and any non-text change information. */
  patch: string;
}
