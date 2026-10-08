import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeFixtureRepo, rmFixture } from './fixture.js';

let repo: string;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  repo = makeFixtureRepo();
  app = createApp({ repoRoot: repo, codeDirs: ['app'], snapshot: { interactionsFile: '/nonexistent' } });
});
afterEach(() => rmFixture(repo));

describe('http api', () => {
  it('GET /api/ledger serves the full derived snapshot', async () => {
    const res = await request(app).get('/api/ledger');
    expect(res.status).toBe(200);
    expect(res.body.corpus).toBe('fixture');
    expect(res.body.records['app:child-rule'].parent).toBe('app:parent-rule');
    expect(res.body.records['app:child-rule'].effectiveCommitments.map((c: { id: string }) => c.id)).toContain('works-offline');
    expect(res.body.capabilities[0].adherents).toContain('story:demo');
    expect(res.body.models[0].projectedFields).toBeDefined();
  });

  it('GET /api/search returns hits with match and location', async () => {
    const res = await request(app).get('/api/search').query({ q: 'demo things' });
    expect(res.status).toBe(200);
    expect(res.body.hits.some((h: { id: string }) => h.id === 'story:demo')).toBe(true);
  });

  it('GET /api/impact names descendants and consumers', async () => {
    const res = await request(app).get('/api/impact').query({ id: 'app:parent-rule' });
    expect(res.status).toBe(200);
    expect(res.body.descendants).toContain('app:deep-leaf');
    expect(res.body.consumers).toContain('app:consumer-rule');
  });

  it('POST /api/change lands a commit and reports the outcome honestly', async () => {
    const res = await request(app)
      .post('/api/change')
      .send({
        operations: [
          { op: 'edit-field', id: 'app:child-rule', field: 'decision', value: 'Edited over http.' },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.committed).toBe(true);
    expect(res.body.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(res.body.touched).toEqual(['ledger/product/demo/app.parent-rule/app.child-rule.yaml']);
  });

  // @DecisionRef eng:refusal-explains-itself — the refusal states what was wrong in the
  // user's own terms, with no internals.
  it('a refusal answers 422 with the reason and writes nothing', async () => {
    const res = await request(app)
      .post('/api/change')
      .send({
        operations: [{ op: 'edit-field', id: 'app:child-rule', field: 'id', value: 'app:evil-twin' }],
      });
    expect(res.status).toBe(422);
    expect(res.body.ok).toBe(false);
    expect(res.body.refusal).toContain('not editable');
    expect(res.body.refusal).not.toMatch(/at .*\.ts/); // no stack detail
  });

  it('POST /api/confirm clears a dubious record end to end', async () => {
    await request(app)
      .post('/api/change')
      .send({
        operations: [
          { op: 'edit-field', id: 'app:parent-rule', field: 'decision', value: 'Rule moved.' },
        ],
      });
    let snap = await request(app).get('/api/ledger');
    expect(snap.body.records['app:child-rule'].dubious.length).toBeGreaterThan(0);
    const res = await request(app).post('/api/confirm').send({ id: 'app:child-rule', note: 'checked' });
    expect(res.status).toBe(200);
    snap = await request(app).get('/api/ledger');
    expect(snap.body.records['app:child-rule'].dubious).toEqual([]);
  });

  it('GET /api/lens/model-usage names its measurement axis', async () => {
    const res = await request(app).get('/api/lens/model-usage').query({ id: 'model:widget' });
    expect(res.status).toBe(200);
    expect(res.body.axis).toContain('name-reference');
    expect(res.body.usage.map((u: { field: string }) => u.field).sort()).toEqual(['name', 'size']);
  });
});
