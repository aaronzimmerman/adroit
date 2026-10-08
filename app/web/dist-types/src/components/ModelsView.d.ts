import type { LedgerSnapshot } from '@adroit/shared';
/**
 * @DecisionRef ui:roots-get-native-treatments — models read as contracts with actual
 * fields, not decision trees.
 * @DecisionRef ui:current-and-proposed-visible — wherever a model appears, a pending
 * change shows both states — deployed reality and ruled intent — as the normal view.
 */
export declare function ModelsView({ snapshot, onTravel, onChanged, highlight, }: {
    snapshot: LedgerSnapshot;
    onTravel: (id: string) => void;
    onChanged: (m: string) => void;
    highlight?: string | null;
}): import("react").JSX.Element;
