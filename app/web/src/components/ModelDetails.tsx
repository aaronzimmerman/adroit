import { useState } from 'react';
import type { ModelView, Operation, PendingChangeDoc } from '@adroit/shared';
import { labelOf, useLedger } from '../context.js';
import { ChangeFlow } from './ChangeFlow.jsx';

/**
 * A model read as its fields: each deployed definition beside the intended one while a pending
 * entry or migration carries it.
 * @DecisionRef ui:models-read-as-fields — fields, not a decision tree.
 * @DecisionRef ui:current-and-proposed-visible — both states, as the normal view.
 */
export function ModelDetails({ model }: { model: ModelView }) {
  const { view, travel } = useLedger();
  const [ops, setOps] = useState<Operation[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [newField, setNewField] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [origin, setOrigin] = useState('');
  if (ops) return <ChangeFlow operations={ops} onCancel={() => setOps(null)} />;

  // @DecisionRef ui:set-model-field — the intended definition is recorded beside the deployed one.
  const setIntended = (field: string, intended: string) =>
    setOps([{ op: 'set-model-field', model: model.id, field, intended }]);
  const pendingHere = model.fields.filter((f) => f.pendingIn === 'model');

  return (
    <article className="model-details">
      <h2>{model.id}</h2>
      <p>{model.decision}</p>
      <table className="fields">
        <thead>
          <tr>
            <th />
            <th>field</th>
            <th>deployed</th>
            <th>intended</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {model.fields.map((f) => (
            <tr key={f.name} className={f.intended !== undefined ? 'pending' : ''}>
              <td>
                {f.pendingIn === 'model' && (
                  <input
                    type="checkbox"
                    aria-label={`gather ${f.name}`}
                    checked={chosen.has(f.name)}
                    onChange={(e) => {
                      const next = new Set(chosen);
                      if (e.target.checked) next.add(f.name);
                      else next.delete(f.name);
                      setChosen(next);
                    }}
                  />
                )}
              </td>
              <td>
                <code>{f.name}</code>
              </td>
              <td>{f.deployed ?? <span className="muted">not deployed</span>}</td>
              <td>
                {editing === f.name ? (
                  <input aria-label={`${f.name} intended`} value={draft} onChange={(e) => setDraft(e.target.value)} />
                ) : f.intended !== undefined ? (
                  <>
                    {f.intended}{' '}
                    {f.pendingIn && f.pendingIn !== 'model' && (
                      <button className="link" onClick={() => travel(f.pendingIn!)}>
                        in migration {labelOf(view, f.pendingIn)}
                      </button>
                    )}
                  </>
                ) : (
                  <span className="muted">as deployed</span>
                )}
              </td>
              <td>
                {editing === f.name ? (
                  <>
                    <button className="primary" onClick={() => setIntended(f.name, draft)}>
                      set
                    </button>
                    <button onClick={() => setEditing(null)}>cancel</button>
                  </>
                ) : (
                  f.pendingIn === undefined || f.pendingIn === 'model' ? (
                    <button
                      onClick={() => {
                        setEditing(f.name);
                        setDraft(f.intended ?? f.deployed ?? '');
                      }}
                    >
                      set intended
                    </button>
                  ) : null
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="form row">
        <input placeholder="a new field's name" value={newField} onChange={(e) => setNewField(e.target.value)} />
        <button
          disabled={!newField.trim()}
          onClick={() => {
            setEditing(newField.trim());
            setDraft('');
            setOps(null);
          }}
        >
          intend a new field
        </button>
      </div>
      {editing && !model.fields.some((f) => f.name === editing) && (
        <div className="form row">
          <code>{editing}</code>
          <input aria-label={`${editing} intended`} placeholder="kind (decision ids) — meaning" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button className="primary" onClick={() => setIntended(editing, draft)}>
            set
          </button>
        </div>
      )}
      {pendingHere.length > 0 && (
        <div className="form" aria-label="begin a migration">
          <h3>Begin a migration</h3>
          {/* @DecisionRef ui:begin-migration — from the pending entries the user names. */}
          <p className="muted">Tick the pending entries it gathers; they move into one pending change.</p>
          <label>
            name <input value={name} placeholder="kebab-name" onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            the decisions whose ruling requires it{' '}
            <input value={origin} placeholder="domain:slug, …" onChange={(e) => setOrigin(e.target.value)} />
          </label>
          <button
            className="primary"
            disabled={chosen.size === 0 || !name.trim()}
            onClick={() =>
              setOps([
                {
                  op: 'begin-migration',
                  name: name.trim(),
                  origin: origin.split(/[\s,]+/).filter(Boolean),
                  entries: [...chosen].map((field) => ({ model: model.id, field })),
                },
              ])
            }
          >
            begin migration
          </button>
        </div>
      )}
    </article>
  );
}

/**
 * A migration in flight, and the attestation that lands it.
 * @DecisionRef ui:land-migration — the person attests it shipped; the model takes the intended
 * shape and the pending change goes, in one commit.
 * @DecisionRef eng:one-step-reversible — landing rewrites what the model says is deployed, so it
 * keeps its confirmation.
 */
export function PendingChangeDetails({ change }: { change: PendingChangeDoc }) {
  const { view, travel } = useLedger();
  const [asking, setAsking] = useState(false);
  const [ops, setOps] = useState<Operation[] | null>(null);
  if (ops) return <ChangeFlow operations={ops} onCancel={() => setOps(null)} />;
  return (
    <article className="change-details">
      <h2>Migration {String(change.name)}</h2>
      <p className="muted">state: {String(change.state)}</p>
      <p>
        required by{' '}
        {(change.origin ?? []).map((id) => (
          <button key={id} className="link" onClick={() => view.decisions[id] && travel(view.decisions[id])}>
            {id}
          </button>
        ))}
      </p>
      <table className="fields">
        <thead>
          <tr>
            <th>model</th>
            <th>field</th>
            <th>deployed</th>
            <th>intended</th>
          </tr>
        </thead>
        <tbody>
          {(change.operations ?? []).map((o) => (
            <tr key={`${o.model} ${o.field}`}>
              <td>{o.model}</td>
              <td>
                <code>{o.field}</code>
              </td>
              <td>{o.deployed ?? <span className="muted">not deployed</span>}</td>
              <td>{o.intended}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {asking ? (
        <div className="row">
          <span>Has this migration shipped?</span>
          <button className="primary" onClick={() => setOps([{ op: 'land-migration', name: String(change.name) }])}>
            yes — it has shipped; land it
          </button>
          <button onClick={() => setAsking(false)}>not yet</button>
        </div>
      ) : (
        <button onClick={() => setAsking(true)}>land this migration…</button>
      )}
    </article>
  );
}
