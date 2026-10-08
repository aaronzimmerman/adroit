// @DecisionRef eng:one-time-renderer — the ONE shared helper that renders clock and date
// values for humans; no surface formats a time any other way.
// @DecisionRef eng:one-display-time-format — one app-wide display format on every surface.

/**
 * Render an instant (epoch seconds; 0 means "uncommitted, now") for display.
 * The viewer's local zone is used and NAMED, never guessed silently.
 */
export function renderInstant(epochSeconds: number): string {
  if (epochSeconds === 0) return 'uncommitted (now)';
  const d = new Date(epochSeconds * 1000);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  return `${localDay(epochSeconds)} ${pad(d.getHours())}:${pad(d.getMinutes())} (${zone})`;
}

/**
 * @DecisionRef eng:instant-to-local-day — a stored instant becomes a calendar day in the
 * viewer's local zone through this one helper, never by slicing a UTC ISO string.
 */
export function localDay(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
