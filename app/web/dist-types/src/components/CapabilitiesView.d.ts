import type { LedgerSnapshot } from '@adroit/shared';
/**
 * A serviceable capability treatment: the contract as the interface it is, with the
 * adherents unfolding as a hierarchy rooted at the capability
 * (@DecisionRef ui:links-explored-by-relation; presentation deliberately unruled —
 * ui:roots-get-native-treatments keeps capabilities open).
 */
export declare function CapabilitiesView({ snapshot, onTravel, onOpen, }: {
    snapshot: LedgerSnapshot;
    onTravel: (id: string) => void;
    onOpen: (id: string) => void;
}): import("react").JSX.Element;
