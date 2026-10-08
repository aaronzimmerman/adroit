// The browser is a pure view: every fact arrives from the thin server and every write
// goes back through it (@DecisionRef eng:thin-server-owns-files).
import type {
  ChangeOutcome,
  ChangeRequest,
  CodeCitation,
  LedgerSnapshot,
  SearchHit,
} from '@adroit/shared';

export class ApiRefusal extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // @DecisionRef eng:refusal-explains-itself — surface the server's stated reason,
    // falling back to a generic line only when it gave none.
    throw new ApiRefusal(
      typeof body.refusal === 'string' ? body.refusal : 'the request could not be completed',
    );
  }
  return body as T;
}

export const api = {
  ledger: () => call<LedgerSnapshot>('/api/ledger'),
  search: (q: string) =>
    call<{ query: string; hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  impact: (id: string) =>
    call<{ id: string; descendants: string[]; consumers: string[]; dependents: string[] }>(
      `/api/impact?id=${encodeURIComponent(id)}`,
    ),
  change: (req: ChangeRequest) =>
    call<ChangeOutcome>('/api/change', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    }),
  confirm: (id: string, note: string) =>
    call<ChangeOutcome>('/api/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, note }),
    }),
  citations: (id: string) =>
    call<{ id: string; citations: CodeCitation[]; axis: string }>(
      `/api/lens/citations?id=${encodeURIComponent(id)}`,
    ),
  modelUsage: (id: string) =>
    call<{ id: string; usage: { field: string; count: number; files: string[] }[]; axis: string }>(
      `/api/lens/model-usage?id=${encodeURIComponent(id)}`,
    ),
};
