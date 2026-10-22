import { useState, type ReactNode } from 'react';
import type { Operation } from '@adroit/shared';
import { ChangeFlow } from './ChangeFlow.jsx';

/**
 * A field shown as itself, with an editor that takes its place on edit; saving hands the
 * operations to the change flow.
 * @DecisionRef ui:edit-in-the-details-panel — the current node is edited where it is read.
 * @DecisionRef eng:same-operation-same-control — every field of every node edits through this.
 */
export function EditInPlace<T>({
  label,
  value,
  render,
  editor,
  toOps,
  dependents = 0,
  dubious = false,
  editText = 'edit',
}: {
  label: string;
  value: T;
  render: (v: T) => ReactNode;
  editor: (draft: T, setDraft: (v: T) => void) => ReactNode;
  toOps: (draft: T, clearDubious: boolean) => Operation[];
  /** How many nodes this edit makes suspect; zero for a field that casts none. */
  dependents?: number;
  /** Whether the node carries a dubious mark the edit could clear. */
  dubious?: boolean;
  /** The edit button's text, where a bare "edit" would not say what it opens. */
  editText?: string;
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'flow'>('view');
  const [draft, setDraft] = useState<T>(value);
  // @DecisionRef eng:defaults-are-likely-usage — editing a node you read through clears its own
  // mark by default; the lever is visible and can be turned off right there.
  // @DecisionRef ui:edit-offers-clearing — the clear-mark checkbox, on by default.
  const [clear, setClear] = useState(true);

  if (mode === 'flow') return <ChangeFlow operations={toOps(draft, dubious && clear)} onCancel={() => setMode('edit')} />;
  if (mode === 'view') {
    return (
      <div className="editable">
        <div className="editable-body">{render(value)}</div>
        <button
          className="edit-button"
          aria-label={`edit ${label}`}
          onClick={() => {
            setDraft(value);
            setMode('edit');
          }}
        >
          {editText}
        </button>
      </div>
    );
  }
  return (
    <div className="editing">
      {editor(draft, setDraft)}
      {/* @DecisionRef ui:change-shows-implications — the reach is in front of the user while
          they edit, not discovered after. */}
      {dependents > 0 && (
        <div className="implication">
          Changing this makes {dependents} node{dependents === 1 ? '' : 's'} that depend on it suspect.
        </div>
      )}
      {dubious && (
        <label className="checkbox-row">
          <input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} /> I read this node through: the
          edit also clears its dubious mark
        </label>
      )}
      <div className="row">
        <button className="primary" onClick={() => setMode('flow')}>
          save
        </button>
        <button onClick={() => setMode('view')}>cancel</button>
      </div>
    </div>
  );
}

/** A text editor for one value. */
export const textEditor = (aria: string, rows = 3) =>
  function TextEditor(draft: string, set: (v: string) => void) {
    return <textarea aria-label={aria} rows={rows} value={draft} onChange={(e) => set(e.target.value)} />;
  };

/** A list edited as lines, one entry per line. */
export const linesEditor = (aria: string, rows = 4) =>
  function LinesEditor(draft: string[], set: (v: string[]) => void) {
    return (
      <textarea
        aria-label={aria}
        rows={rows}
        placeholder="one per line"
        value={draft.join('\n')}
        onChange={(e) => set(e.target.value.split('\n'))}
      />
    );
  };
