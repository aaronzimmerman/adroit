import type { LedgerSnapshot } from '@adroit/shared';
export declare function EditPanel({ snapshot, id, onDone, }: {
    snapshot: LedgerSnapshot;
    id: string;
    onDone: (message: string) => void;
}): import("react").JSX.Element;
