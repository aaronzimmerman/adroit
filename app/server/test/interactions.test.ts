import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { interactionCounts, readInteractions } from '../src/interactions.js';

// @DecisionRef eng:log-ledger-interactions — the log is validated line by line on read;
// a malformed line is reported and skipped, and an absent log reads as empty.
describe('interactions log', () => {
  it('an absent log reads as empty', () => {
    const read = readInteractions(path.join(os.tmpdir(), 'adroit-no-such-file.jsonl'));
    expect(read).toEqual({ events: [], skipped: 0 });
  });

  it('validates line by line, skipping and counting malformed lines', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'adroit-ix-')), 'ix.jsonl');
    fs.writeFileSync(
      file,
      [
        JSON.stringify({ ids: ['app:parent-rule'], kind: 'resolved-fork', note: 'picked a side' }),
        'not json at all',
        JSON.stringify({ ids: 'wrong-shape', kind: 'resolved-fork', note: 'bad ids' }),
        JSON.stringify({ ids: ['app:parent-rule', 'app:child-rule'], kind: 'gap', note: 'missing rule' }),
        JSON.stringify({ ids: [], kind: 'not-a-kind', note: 'bad kind' }),
      ].join('\n'),
    );
    const read = readInteractions(file);
    expect(read.events).toHaveLength(2);
    expect(read.skipped).toBe(3);
    const counts = interactionCounts(read.events);
    expect(counts.get('app:parent-rule')).toBe(2);
    expect(counts.get('app:child-rule')).toBe(1);
  });
});
