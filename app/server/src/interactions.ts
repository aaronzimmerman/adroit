// @DecisionRef eng:log-ledger-interactions — the interactions log is machine-local usage
// telemetry at ~/.adroit/<corpus>/interactions.jsonl, outside any repository. It is read
// line by line, a malformed line is reported and skipped, and an absent log reads empty.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { InteractionEvent } from '@adroit/shared';

const KINDS = ['resolved-fork', 'prevented', 'gap'];

export function interactionsPathFor(corpus: string): string {
  return path.join(os.homedir(), '.adroit', corpus, 'interactions.jsonl');
}

export interface InteractionsRead {
  events: InteractionEvent[];
  /** Count of malformed lines skipped (reported, never a failure of the corpus). */
  skipped: number;
}

export function readInteractions(file: string): InteractionsRead {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { events: [], skipped: 0 };
  }
  const events: InteractionEvent[] = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const raw = JSON.parse(line) as Record<string, unknown>;
      const ids = raw.ids;
      if (
        !Array.isArray(ids) ||
        !ids.every((i) => typeof i === 'string') ||
        typeof raw.kind !== 'string' ||
        !KINDS.includes(raw.kind) ||
        typeof raw.note !== 'string'
      ) {
        skipped++;
        continue;
      }
      events.push({
        ids: ids as string[],
        kind: raw.kind as InteractionEvent['kind'],
        note: raw.note,
        ...(typeof raw.where === 'string' ? { where: raw.where } : {}),
        ...(typeof raw.at === 'string' ? { at: raw.at } : {}),
      });
    } catch {
      skipped++;
    }
  }
  return { events, skipped };
}

/** Per-decision earned-its-keep counts, derived from the events at read time. */
export function interactionCounts(events: InteractionEvent[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of events) {
    for (const id of e.ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
