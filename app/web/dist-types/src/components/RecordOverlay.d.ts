import type { LedgerSnapshot } from '@adroit/shared';
interface TravelFn {
    (id: string): void;
}
/**
 * The full weight of a record, expanded in place over whatever view is behind it;
 * revealing it never navigates away (@DecisionRef ui:full-record-expands-in-place).
 */
export declare function RecordOverlay({ snapshot, id, onClose, onTravel, onChanged, }: {
    snapshot: LedgerSnapshot;
    id: string;
    onClose: () => void;
    onTravel: TravelFn;
    onChanged: (message: string) => void;
}): import("react").JSX.Element | null;
export {};
