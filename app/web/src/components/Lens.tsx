import { useEffect, useState } from 'react';
import type { CodeCitation } from '@adroit/shared';
import { api, reasonOf } from '../api.js';
import { renderInstant } from '../time.js';

/**
 * The code citing one decision: each snippet in context, whether the file moved since the
 * decision's text last changed, and how.
 * @DecisionRef ui:read-only-code-lens — it reads the code and offers no way to change it.
 * @DecisionRef ui:lens-shows-snippets — the citing lines with the code around them.
 * @DecisionRef ui:lens-shows-what-changed — the file's diff since the decision changed.
 */
export function Lens({ id }: { id: string }) {
  const [citations, setCitations] = useState<CodeCitation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.lens(id).then(
      (r) => live && setCitations(r.citations),
      (e) => live && setError(reasonOf(e, 'the code could not be read')),
    );
    return () => {
      live = false;
    };
  }, [id]);
  if (error) return <div className="lens muted">{error}</div>;
  if (!citations) return <div className="lens muted">reading the code…</div>;
  return (
    <div className="lens" aria-label={`code citing ${id}`}>
      {citations.length === 0 && <p className="muted">No code cites this decision.</p>}
      {citations.map((c) => (
        <div key={`${c.file}:${c.line}`} className="citation">
          <div className="row">
            <code>
              {c.file}:{c.line}
            </code>
            <span className={c.changedSinceDecision ? 'badge moved' : 'badge still'}>
              {c.changedSinceDecision ? 'changed since the decision did' : 'not changed since the decision did'}
            </span>
            <span className="muted">file last changed {renderInstant(c.fileLastChanged)}</span>
          </div>
          <pre>{c.snippet}</pre>
          {c.diff && (
            <details>
              <summary>what changed since the decision did</summary>
              <pre className="diff">{c.diff}</pre>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}
