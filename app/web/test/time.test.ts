import { describe, expect, it } from 'vitest';
import { localDay, renderInstant } from '../src/time.js';

// @DecisionRef eng:one-time-renderer / eng:one-display-time-format — one shared helper,
// one app-wide format, the zone named.
describe('the one time renderer', () => {
  it('renders an instant in the local day with the zone named', () => {
    const out = renderInstant(1760000000);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} \(.+\)$/);
  });

  it('renders the uncommitted sentinel honestly', () => {
    expect(renderInstant(0)).toBe('uncommitted (now)');
  });

  // @DecisionRef eng:instant-to-local-day — via the Date API in the viewer's zone,
  // never by slicing the UTC ISO string.
  it('localDay uses the local calendar, not the UTC slice', () => {
    const epoch = 1760000000;
    const d = new Date(epoch * 1000);
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
    expect(localDay(epoch)).toBe(expected);
  });
});
