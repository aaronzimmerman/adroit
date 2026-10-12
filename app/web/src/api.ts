// The browser is a pure view: every fact arrives from the thin server and every write goes
// back through it (@DecisionRef eng:browser-is-pure-view).
import type {
  ChangeOutcome,
  ChangePreview,
  ChangeRequest,
  CodeCitation,
  LedgerView,
  SearchHit,
} from '@adroit/shared';

class ApiRefusal extends Error {}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // @DecisionRef eng:refusal-explains-itself — the server's stated reason, falling back to a
    // generic line only when it gave none.
    throw new ApiRefusal(typeof body.refusal === 'string' ? body.refusal : 'the request could not be completed');
  }
  return body as T;
}

const post = <T>(url: string, body: unknown) =>
  call<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  ledger: () => call<LedgerView>('/api/ledger'),
  open: (dir: string) => post<LedgerView>('/api/open', { dir }),
  search: (q: string) => call<{ query: string; hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  preview: (req: ChangeRequest) => post<ChangePreview>('/api/change/preview', req),
  change: (req: ChangeRequest) => post<ChangeOutcome>('/api/change', req),
  lens: (id: string) => call<{ id: string; citations: CodeCitation[] }>(`/api/lens?id=${encodeURIComponent(id)}`),
};

/** A refusal's message, or the generic line for anything else. */
export const reasonOf = (e: unknown, fallback: string): string => (e instanceof ApiRefusal ? e.message : fallback);
