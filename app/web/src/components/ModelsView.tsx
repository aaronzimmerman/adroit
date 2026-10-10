import { useState } from 'react';
import type { DerivedModel, LedgerSnapshot, PendingFieldEntry } from '@adroit/shared';
import { api, ApiRefusal } from '../api.js';
import { DubiousBadge } from './Badges.jsx';

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
              <LandMigration name={c.doc.name} model={c.doc.model} onChanged={onChanged} />
              <div>
                <strong>{c.doc.name}</strong> on <code>{c.doc.model}</code> —{' '}
                <em>{c.doc.state}</em>
              </div>
              <div className="muted">
                ruled by{' '}
                {c.doc.origin.map((o) => (
                  <span key={o}>
                    <button className="link" onClick={() => onTravel(o)}>
                      {o}
                    </button>
                    {snapshot.records[o] && <DubiousBadge record={snapshot.records[o]} />}
                  </span>
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

/**
 * Landing is the user's attestation that the migration shipped — the tool cannot observe a
 * deployment — so it is always this explicit act: the deployed shape takes the intended
 * shape, the change file goes, one commit (change-propose land-migration).
 * @DecisionRef adr:models-memorialize-deployed-shape — the model updates only when the
 * migration lands.
 * @DecisionRef eng:refusal-explains-itself — a refused landing shows the server's reason.
 */
function LandMigration({
  name,
  model,
  onChanged,
}: {
  name: string;
  model: string;
  onChanged: (m: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const land = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await api.change({ operations: [{ op: 'land-migration', name }] });
      onChanged(`migration ${name} landed on ${model} in commit ${outcome.commit?.slice(0, 8) ?? ''}`);
    } catch (e) {
      setError(e instanceof ApiRefusal ? e.message : 'landing failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="land-migration">
      <button onClick={land} disabled={busy}>
        it shipped — land {name}
      </button>
      <span className="muted"> the deployed shape takes the intended shape</span>
      {error && <div className="refusal">{error}</div>}
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

  // the server reads each field's ruling citations as links (adr:fields-link-their-rulings)
  const citedIds = (name: string): string[] => model.fieldLinks[name] ?? [];
  const dangling = (name: string) => model.danglingCitations.filter((d) => d.field === name);

  return (
    <div className={`model-card ${highlighted ? 'highlight' : ''}`} id={`rec-${model.id.replace(':', '-')}`}>
      <div className="model-head">
        <code className="record-id">{model.id}</code>
        {model.consumers.length > 0 && (
          <span className="muted">
            consumed by{' '}
            {model.consumers.map((c) => (
              <span key={c}>
                <button className="link" onClick={() => onTravel(c)}>
                  {c}
                </button>
                {snapshot.records[c] && <DubiousBadge record={snapshot.records[c]} />}
              </span>
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
                  {model.orphanFields.includes(name) && (
                    <div className="orphan-tag" title="no ruling governs this field, so it probably is not needed">
                      probable orphan
                    </div>
                  )}
                </td>
                <td>
                  {text}{' '}
                  {citedIds(name).map((id) => (
                    <button key={id} className="link" onClick={() => onTravel(id)}>
                      {id}
                    </button>
                  ))}
                  {dangling(name).map((d) => (
                    <span key={d.id} className="refusal">
                      {' '}
                      cites {d.id}, which does not resolve
                    </span>
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
      <ModelChangeForms model={model} onChanged={onChanged} />
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
