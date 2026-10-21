import { useLedger } from '../context.js';

/** A well-formed field token: `{slug.field}`, the view's slug and the field's name (ADROIT.md). */
const FIELD_TOKEN = /\{([a-z][a-z0-9-]*)\.([^\s.{}]+)\}/g;

/**
 * Decision text with each field token that names an existing field shown as that field, selectable.
 * A token naming no existing field stays plain text: the check reports it.
 * @DecisionRef ui:field-token-opens-its-view — selecting it makes the view current, the field
 * picked out.
 */
export function TokenText({ text }: { text: string }) {
  const { view, travel } = useLedger();
  const parts: (string | JSX.Element)[] = [];
  let at = 0;
  for (const m of text.matchAll(FIELD_TOKEN)) {
    const [raw, slug, field] = m;
    const place = view.ids[`view:${slug}`];
    if (place === undefined || !view.places[place]?.view?.fields.some((f) => f.name === field)) continue;
    parts.push(text.slice(at, m.index));
    parts.push(
      <button
        key={m.index}
        className="link field-token"
        title={`view:${slug} — ${field}`}
        aria-label={`field ${field} of view:${slug}`}
        onClick={() => travel(place, field)}
      >
        {raw}
      </button>,
    );
    at = m.index! + raw.length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}
