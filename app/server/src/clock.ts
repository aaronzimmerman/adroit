// @DecisionRef eng:explicit-utc-clock — every server-side read of the current date/time
// goes through these helpers, which name UTC explicitly; nothing reads the machine zone.

/** Current date-time as an explicit-UTC ISO string (trailing Z names the zone). */
function nowUtcIso(): string {
  return new Date().toISOString();
}

/** Current calendar day in UTC, for provenance lines written by the server. */
export function todayUtc(): string {
  return nowUtcIso().slice(0, 10);
}

/**
 * Sentinel recency for uncommitted working-tree changes: compares newer than any commit.
 * Reported outward as `at: 0` (meaning "uncommitted, i.e. now").
 */
export const UNCOMMITTED = Number.MAX_SAFE_INTEGER;
