import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as path from 'node:path';
import request from 'supertest';
import type { LedgerView, SearchHit } from '@adroit/shared';
import { createApp } from '../src/app.js';
import { commitAll, ledgerOf, makeFixtureRepo, rmFixture, write } from './fixture.js';

let repo: string;
beforeEach(() => {
  repo = makeFixtureRepo();
});
afterEach(() => rmFixture(repo));

const app = () => createApp({ ledgerDir: ledgerOf(repo) });
const search = async (q: string): Promise<SearchHit[]> =>
  (await request(app()).get(`/api/search?q=${encodeURIComponent(q)}`)).body.hits;

describe('search', () => {
  // @DecisionRef ui:search-any-text — names, decision text, rejected text, context, a view's
  // field names, and ids.
  it('finds any text: a rejected alternative, context, a view\'s field name, a question', async () => {
    expect((await search('too chaotic'))[0]).toMatchObject({ place: 'product/demo/parent-rule', field: 'rejected 1' });
    expect((await search('know'))[0]).toMatchObject({ place: 'product/demo/parent-rule', field: 'context' });
    expect((await search('parts'))[0]).toMatchObject({ place: 'models/widget.yaml', field: 'field parts' });
    expect((await search('widget name')).map((h) => h.place)).toContain('models/widget.yaml');
    expect((await search('Quiet hours'))[0]).toMatchObject({ place: 'capabilities/notify/quiet-hours.yaml', field: 'name' });
    expect((await search('accounts'))[0]).toMatchObject({ place: 'product/demo', field: 'question 1' });
  });

  // @DecisionRef ui:no-privileged-id-lookup — a pasted id matches as text, like anything else.
  it('a pasted id finds its decision because its text matches', async () => {
    const hits = await search('app:deep-leaf');
    expect(hits[0]).toMatchObject({ place: 'product/demo/parent-rule/online-only/deep-leaf.yaml', field: 'id' });
  });

  // @DecisionRef ui:hit-shows-its-place — the trail of places above the hit.
  it('every hit shows where it lives in the hierarchy; words may sit apart', async () => {
    const [hit] = await search('deep live');
    expect(hit.trail).toEqual(['product', 'Demo', 'Parent rule', 'Online only']);
    expect(await search('   ')).toEqual([]);
  });
});

describe('routes', () => {
  it('serves the view of the opened ledger', async () => {
    const res = await request(app()).get('/api/ledger');
    expect(res.status).toBe(200);
    const v = res.body as LedgerView;
    expect(v.corpus).toBe('fixture');
    expect(v.repo).toBeTruthy();
    expect(v.places['product/demo'].node!.doc.name).toBe('Demo');
  });

  // @DecisionRef ui:open-any-ledger — the user points the tool at another ledger directory.
  it('opens another ledger directory, and refuses a path that is no directory', async () => {
    const other = makeFixtureRepo({ 'domains.yaml': { corpus: 'second', app: 'The demo app.', eng: 'Engineering practice.' } });
    try {
      const a = app();
      const opened = await request(a).post('/api/open').send({ dir: ledgerOf(other) });
      expect(opened.status).toBe(200);
      expect(opened.body.corpus).toBe('second');
      expect((await request(a).get('/api/ledger')).body.corpus).toBe('second');
      const bad = await request(a).post('/api/open').send({ dir: path.join(other, 'nope') });
      expect(bad.status).toBe(422);
      expect(bad.body.refusal).toMatch(/is not a directory/);
    } finally {
      rmFixture(other);
    }
  });

  // @DecisionRef eng:refusal-explains-itself — a refusal arrives as 422 with its reason.
  it('previews and lands a change, and a refusal explains itself', async () => {
    const a = app();
    const op = { op: 'edit-node', place: 'product/demo/parent-rule', field: 'decision', value: 'Kinder.' };
    const preview = await request(a).post('/api/change/preview').send({ operations: [op] });
    expect(preview.body.suspects).toHaveLength(3);
    const landed = await request(a).post('/api/change').send({ operations: [op] });
    expect(landed.body.marked).toHaveLength(3);
    const refused = await request(a).post('/api/change').send({ operations: [{ op: 'confirm', place: 'product/demo/sibling.yaml' }] });
    expect(refused.status).toBe(422);
    expect(refused.body.refusal).toMatch(/not marked dubious/);
  });
});

describe('the code lens', () => {
  // @DecisionRef ui:lens-shows-snippets — each citation with its code around it.
  // @DecisionRef ui:lens-shows-what-changed — a file that moved since the rule did, with its diff.
  it('reads the code citing a decision, and what changed since the decision did', async () => {
    // the fixture's own citation, split so this repository's binding scan does not read it as ours
    const cite = `// @Decision${'Ref'} app:parent-rule — the widget obeys its parent`;
    write(repo, 'src/widget.ts', [cite, 'export const w = 1;', ''].join('\n'));
    commitAll(repo, 'code', Math.floor(Date.now() / 1000) - 5000);
    const a = app();
    await request(a).post('/api/change').send({ operations: [{ op: 'edit-node', place: 'product/demo/parent-rule', field: 'decision', value: 'Kinder.' }] });
    let res = await request(a).get('/api/lens?id=app:parent-rule');
    expect(res.body.citations).toHaveLength(1);
    expect(res.body.citations[0]).toMatchObject({ file: 'src/widget.ts', line: 1, changedSinceDecision: false, diff: '' });
    expect(res.body.citations[0].snippet).toContain('export const w = 1;');

    write(repo, 'src/widget.ts', [cite, 'export const w = 2;', ''].join('\n'));
    commitAll(repo, 'comply', Math.floor(Date.now() / 1000) + 5);
    res = await request(a).get('/api/lens?id=app:parent-rule');
    expect(res.body.citations[0].changedSinceDecision).toBe(true);
    expect(res.body.citations[0].diff).toContain('+export const w = 2;');
    // the lens never reads the ledger itself as code
    expect((await request(a).get('/api/lens?id=app:sibling')).body.citations).toEqual([]);
  });
});
