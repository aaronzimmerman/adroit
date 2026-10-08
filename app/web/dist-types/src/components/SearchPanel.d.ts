import type { LedgerSnapshot, SearchHit } from '@adroit/shared';
/**
 * @DecisionRef ui:search-any-text — full-text over the whole ledger directory, ids
 * included; every hit shows what matched and where it lives; selecting one is travel.
 */
export declare function SearchPanel({ snapshot, onTravel, }: {
    snapshot: LedgerSnapshot;
    onTravel: (id: string, hit: SearchHit) => void;
}): import("react").JSX.Element;
