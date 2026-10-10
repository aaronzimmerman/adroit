import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { parseLedger, type ParsedLedger } from '../src/ledger.js';
import { searchLedger } from '../src/search.js';
import { makeFixtureRepo, rmFixture } from './fixture.js';

let repo: string;
let ledger: ParsedLedger;
beforeAll(() => {
  repo = makeFixtureRepo();
  ledger = parseLedger(path.join(repo, 'ledger'));
});
afterAll(() => rmFixture(repo));

// @DecisionRef ui:search-any-text — a match on any text in the whole ledger directory,
// every hit showing what matched and where it lives.
describe('searchLedger', () => {
  it('matches decision text and shows the field and hierarchy', () => {
    const hits = searchLedger(ledger, 'follow the parent rule');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].id).toBe('app:child-rule');
    expect(hits[0].field).toBe('decision');
    expect(hits[0].hierarchy).toEqual(['story:demo', 'app:parent-rule']);
    expect(hits[0].snippet.toLowerCase()).toContain('follow the parent rule');
  });

  it('matches rejected alternatives and context', () => {
    const rejectedHit = searchLedger(ledger, 'too chaotic');
    expect(rejectedHit.some((h) => h.id === 'app:parent-rule' && h.field.startsWith('rejected'))).toBe(true);
    const contextHit = searchLedger(ledger, 'because');
    expect(contextHit.some((h) => h.id === 'app:parent-rule' && h.field === 'context.why')).toBe(true);
  });

  it('a pasted id finds its record because it matches, not because it is an id', () => {
    const hits = searchLedger(ledger, 'app:deep-leaf');
    expect(hits.some((h) => h.id === 'app:deep-leaf' && h.field === 'id')).toBe(true);
  });

  it('matches a model field name and a contract text', () => {
    const fieldHits = searchLedger(ledger, 'size');
    expect(fieldHits.some((h) => h.id === 'model:widget' && h.field === 'fields.size')).toBe(true);
    const contractHits = searchLedger(ledger, 'something happened');
    expect(contractHits.some((h) => h.id === 'notify' && h.field === 'summary')).toBe(true);
  });

  it('matches commitment text', () => {
    const hits = searchLedger(ledger, 'no network');
    expect(hits.some((h) => h.id === 'story:demo' && h.field === 'commitments.works-offline')).toBe(true);
  });

  it('matches the reason a dubious mark gives', () => {
    const rec = ledger.records.get('app:child-rule')!;
    rec.doc = { ...rec.doc, dubious: 'contradicts the quartz rule' };
    const hits = searchLedger(ledger, 'quartz');
    expect(hits.some((h) => h.id === 'app:child-rule' && h.field === 'dubious')).toBe(true);
    delete rec.doc.dubious;
  });

  it('an empty query returns nothing', () => {
    expect(searchLedger(ledger, '  ')).toEqual([]);
  });
});
