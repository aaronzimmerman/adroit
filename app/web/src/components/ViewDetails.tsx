import type { ViewRecord } from '@adroit/shared';
import { useLedger } from '../context.js';

/** An id that travels to its place when the ledger holds it. */
function IdLink({ id }: { id: string }) {
  const { view, travel } = useLedger();
  const at = view.ids[id];
  if (at === undefined) return <code>{id}</code>;
  return (
    <button className="link" onClick={() => travel(at)}>
      <code>{id}</code>
    </button>
  );
}

/**
 * A view read as its typed fields: each field's type, the decisions it cites and its meaning,
 * then the views it consumes and the principles it grounds in. It is read here, never changed.
 * @DecisionRef ui:views-read-as-fields — typed fields, not a decision tree.
 * @DecisionRef ui:views-not-changed-here — no control here edits a view.
 */
export function ViewDetails({ record }: { record: ViewRecord }) {
  return (
    <article className="view-details">
      <h2>{record.id}</h2>
      <p>{record.decision}</p>
      {record.rejected.length > 0 && (
        <ul className="rejected">
          {record.rejected.map((r, i) => (
            <li key={i}>
              <span className="muted">rejected:</span> {r}
            </li>
          ))}
        </ul>
      )}
      <table className="fields" aria-label="fields">
        <thead>
          <tr>
            <th>field</th>
            <th>type</th>
            <th>cites</th>
            <th>meaning</th>
          </tr>
        </thead>
        <tbody>
          {record.fields.map((f) => (
            <tr key={f.name}>
              <td>
                <code>{f.name}</code>
              </td>
              <td>{f.type === '?' ? <span className="muted">{f.raw}</span> : <code>{f.type}</code>}</td>
              <td>
                {f.cites.length === 0 ? (
                  <span className="muted">none</span>
                ) : (
                  f.cites.map((id) => (
                    <span key={id} className="cite">
                      <IdLink id={id} />{' '}
                    </span>
                  ))
                )}
              </td>
              <td>{f.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {record.fields.length === 0 && <p className="muted">This view has no typed fields.</p>}
      {(record.consumes.length > 0 || record.grounds.length > 0) && (
        <section aria-label="links">
          <h3>Links</h3>
          {record.consumes.length > 0 && (
            <p>
              consumes{' '}
              {record.consumes.map((id) => (
                <span key={id}>
                  <IdLink id={id} />{' '}
                </span>
              ))}
            </p>
          )}
          {record.grounds.length > 0 && (
            <p>
              grounds in{' '}
              {record.grounds.map((id) => (
                <span key={id}>
                  <IdLink id={id} />{' '}
                </span>
              ))}
            </p>
          )}
        </section>
      )}
    </article>
  );
}
