/**
 * Sentinel recency for uncommitted working-tree changes: compares newer than any commit.
 * Reported outward as `0` (meaning "uncommitted, i.e. now").
 */
export const UNCOMMITTED = Number.MAX_SAFE_INTEGER;
