/**
 * Render an instant (epoch seconds; 0 means "uncommitted, now") for display.
 * The viewer's local zone is used and NAMED, never guessed silently.
 */
export declare function renderInstant(epochSeconds: number): string;
/**
 * @DecisionRef eng:instant-to-local-day — a stored instant becomes a calendar day in the
 * viewer's local zone through this one helper, never by slicing a UTC ISO string.
 */
export declare function localDay(epochSeconds: number): string;
