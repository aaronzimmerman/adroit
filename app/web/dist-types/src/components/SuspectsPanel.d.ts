import type { LedgerSnapshot } from '@adroit/shared';
/**
 * @DecisionRef ui:edits-cast-suspicion — the marked records stay visible until each is read
 * through and confirmed or edited; the debt stays visible, never a gate.
 */
export declare function SuspectsPanel({ snapshot, onOpen, onTravel, onChanged, onClose, }: {
    snapshot: LedgerSnapshot;
    onOpen: (id: string) => void;
    onTravel: (id: string) => void;
    onChanged: (m: string) => void;
    onClose: () => void;
}): import("react").JSX.Element;
