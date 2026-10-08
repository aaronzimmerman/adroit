import { useState } from 'react';
import type { DerivedModel, LedgerSnapshot, PendingFieldEntry } from '@adroit/shared';
import { api, ApiRefusal } from '../api.js';

/**
 * @DecisionRef ui:roots-get-native-treatments — models read as contracts with actual
 * fields, not decision trees.
 * @DecisionRef ui:current-and-proposed-visible — wherever a model appears, a pending
 * change shows both states — deployed reality and ruled intent — as the normal view.
 */
export function ModelsView({
  snapshot,
  onTravel,
  onChanged,
  highlight,
}: {
  snapshot: LedgerSnapshot;
  onTravel: (id: string) => void;
  onChanged: (m: string) => void;
  highlight?: string | null;
}) {
  return (
    <div className="models-view">
      {snapshot.models.map((m) => (
        <ModelCard
          key={m.id}
          model={m}
          snapshot={snapshot}
          onTravel={onTravel}
          onChanged={onChanged}
          highlighted={highlight === m.id}
        />
      ))}
      {snapshot.changes.length > 0 && (
        <section className="migrations">
          <h3>migrations in flight</h3>
          {snapshot.changes.map((c) => (
            <div key={c.path} className="migration-card">
              <div>
                <strong>{c.doc.name}</strong> on <code>{c.doc.model}</code> —{' '}
                <em>{c.doc.state}</em>
              </div>
              <div className="muted">
                ruled by{' '}
                {c.doc.origin.map((o) => (
                  <button key={o} className="link" onClick={() => onTravel(o)}>
                    {o}
                  </button>
                ))}
              </div>
              <ul>
                {c.doc.operations.map((op) => (
                  <li key={op.field}>
                    <code>{op.field}</code>: <FromTo op={op} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function FromTo({ op }: { op: PendingFieldEntry }) {
  if (op.op === 'add') {
    return (
      <span>
        <em className="intended">absent → {op.intended}</em>
      </span>
    );
  }
  if (op.op === 'remove') {
    return (
      <span>
        <em className="current">{op.current}</em> → <em className="intended">removed</em>
      </span>
    );
  }
  return (
    <span>
      <em className="current">{op.current}</em> → <em className="intended">{op.intended}</em>
    </span>
  );
}

function ModelCard({
  model,
  snapshot,
  onTravel,
  onChanged,
  highlighted,
}: {
  model: DerivedModel;
  snapshot: LedgerSnapshot;
  onTravel: (id: string) => void;
  onChanged: (m: string) => void;
  highlighted: boolean;
}) {
  const openOps = snapshot.changes
    .filter((c) => c.doc.model === model.id)
    .flatMap((c) => c.doc.operations.map((op) => ({ ...op, migration: c.doc.name })));
  const filePending = model.doc.pending ?? [];
  const pendingByField = new Map<string, PendingFieldEntry & { migration?: string }>();
  for (const p of [...filePending, ...openOps]) pendingByField.set(p.field, p);
  const addedFields = [...pendingByField.values()].filter((p) => p.op === 'add');

  // field text carries ruling citations like (app:some-rule); make them travelable
  const citedIds = (text: string): string[] =>
    [...text.matchAll(/\(([a-z][a-z-]*:[a-z][a-z-]*)\)/g)].map((m) => m[1]).filter(
      (id) => snapshot.records[id] !== undefined,
    );

  return (
    <div className={`model-card ${highlighted ? 'highlight' : ''}`} id={`rec-${model.id.replace(':', '-')}`}>
      <div className="model-head">
        <code className="record-id">{model.id}</code>
        {model.consumers.length > 0 && (
          <span className="muted">
            consumed by{' '}
            {model.consumers.map((c) => (
              <button key={c} className="link" onClick={() => onTravel(c)}>
                {c}
              </button>
            ))}
          </span>
        )}
      </div>
      <p>{model.doc.summary}</p>
      <table className="fields-table">
        <thead>
          <tr>
            <th>field</th>
            <th>deployed (what the store holds)</th>
            <th>ruled intent, when pending</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(model.doc.fields).map(([name, text]) => {
            const pending = pendingByField.get(name);
            return (
              <tr key={name} className={pending ? 'pending-migration' : ''}>
                <td>
                  <code>{name}</code>
                  {pending && <div className="pending-tag">pending-migration</div>}
                </td>
                <td>
                  {text}{' '}
                  {citedIds(text).map((id) => (
                    <button key={id} className="link" onClick={() => onTravel(id)}>
                      {id}
                    </button>
                  ))}
                </td>
                <td>
                  {pending ? (
                    pending.op === 'remove' ? (
                      <em className="intended">removed{pending.migration ? ` (migration ${pending.migration})` : ''}</em>
                    ) : (
                      <em className="intended">
                        {pending.intended}
                        {pending.migration ? ` (migration ${pending.migration})` : ''}
                      </em>
                    )
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            );
          })}
          {addedFields.map((p) => (
            <tr key={p.field} className="pending-migration">
              <td>
                <code>{p.field}</code>
                <div className="pending-tag">pending-migration</div>
              </td>
              <td>
                <span className="muted">not deployed yet</span>
              </td>
              <td>
                <em className="intended">{p.intended}</em>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <FieldUsage modelId={model.id} />
      <ModelChangeForms model={model} onChanged={onChanged} />
    </div>
  );
}

/** @DecisionRef ui:trace-dependence — how heavily each field is used in fact; an unused
 * field is visible, a hundred-use field reads as load-bearing. */
function FieldUsage({ modelId }: { modelId: string }) {
  const [usage, setUsage] = useState<{ field: string; count: number }[] | null>(null);
  const [axis, setAxis] = useState('');
  if (usage === null) {
    return (
      <button
        className="link"
        onClick={() =>
          api.modelUsage(modelId).then((r) => {
            setUsage(r.usage);
            setAxis(r.axis);
          }).catch(() => setUsage([]))
        }
      >
        measure field usage from the code
      </button>
    );
  }
  const max = Math.max(1, ...usage.map((u) => u.count));
  return (
    <div className="field-usage">
      <div className="muted">usage measured from the code ({axis})</div>
      {usage.map((u) => (
        <div key={u.field} className="usage-row">
          <code>{u.field}</code>
          <div className="usage-bar" style={{ width: `${(u.count / max) * 160 + 2}px` }} />
          <span className={u.count === 0 ? 'unused' : ''}>
            {u.count === 0 ? 'unused' : `${u.count} reference(s)`}
          </span>
        </div>
      ))}
    </div>
  );
}

function ModelChangeForms({
  model,
  onChanged,
}: {
  model: DerivedModel;
  onChanged: (m: string) => void;
}) {
  const [op, setOp] = useState<'add' | 'change' | 'remove'>('change');
  const [field, setField] = useState('');
  const [intended, setIntended] = useState('');
  const [origin, setOrigin] = useState('');
  const [migName, setMigName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const pendField = async () => {
    setError(null);
    try {
      await api.change({
        operations: [
          {
            op: 'set-model-field',
            model: model.id,
            entry: {
              field: field.trim(),
              op,
              ...(op !== 'remove' ? { intended: intended.trim() } : {}),
              ...(origin.trim() ? { origin: origin.split(/[\s,]+/).filter(Boolean) } : {}),
            },
          },
        ],
      });
      onChanged(`pending ${op} of ${model.id}.${field} recorded`);
    } catch (e) {
      setError(e instanceof ApiRefusal ? e.message : 'failed');
    }
  };

  const begin = async () => {
    setError(null);
    const fields = (model.doc.pending ?? []).map((p) => p.field);
    try {
      await api.change({
        operations: [
          {
            op: 'begin-migration',
            model: model.id,
            name: migName.trim(),
            fields,
            origin: [...new Set((model.doc.pending ?? []).flatMap((p) => p.origin ?? []))],
          },
        ],
      });
      onChanged(`migration ${migName} begun on ${model.id}`);
    } catch (e) {
      setError(e instanceof ApiRefusal ? e.message : 'failed');
    }
  };

  return (
    <details className="model-forms">
      <summary>rule a field change</summary>
      <div className="edit-row">
        <select value={op} onChange={(e) => setOp(e.target.value as typeof op)}>
          <option value="add">add</option>
          <option value="change">change</option>
          <option value="remove">remove</option>
        </select>
        <input placeholder="field" value={field} onChange={(e) => setField(e.target.value)} />
      </div>
      {op !== 'remove' && (
        <input
          placeholder="intended definition (the ruled shape)"
          value={intended}
          onChange={(e) => setIntended(e.target.value)}
        />
      )}
      <input
        placeholder="origin decision ids (the rulings that force this)"
        value={origin}
        onChange={(e) => setOrigin(e.target.value)}
      />
      <button onClick={pendField} disabled={!field.trim()}>
        record pending entry and commit
      </button>
      {(model.doc.pending ?? []).length > 0 && (
        <div className="edit-row">
          <input
            placeholder="migration name"
            value={migName}
            onChange={(e) => setMigName(e.target.value)}
          />
          <button onClick={begin} disabled={!migName.trim()}>
            begin migration over all pending entries
          </button>
        </div>
      )}
      {error && <div className="refusal">{error}</div>}
    </details>
  );
}
