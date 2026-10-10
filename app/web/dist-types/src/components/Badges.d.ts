import type { DerivedRecord, LedgerSnapshot } from '@adroit/shared';
export declare function DubiousBadge({ record }: {
    record: Pick<DerivedRecord, 'doc'>;
}): import("react").JSX.Element | null;
/**
 * The mark's one line of reason, with every record it names reachable — the reason names
 * the record whose change made this one suspect (ui:dubious-is-recorded).
 */
export declare function DubiousReason({ record, snapshot, onTravel, }: {
    record: Pick<DerivedRecord, 'id' | 'doc'>;
    snapshot: LedgerSnapshot;
    onTravel: (id: string) => void;
}): import("react").JSX.Element | null;
export declare function Hierarchy({ ids }: {
    ids: string[];
}): import("react").JSX.Element | null;
