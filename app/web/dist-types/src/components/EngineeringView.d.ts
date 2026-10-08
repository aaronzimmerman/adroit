import type { LedgerSnapshot } from '@adroit/shared';
/**
 * @DecisionRef ui:roots-get-native-treatments — engineering gets its own treatment, not
 * the deep-zoom star map.
 * @DecisionRef ui:engineering-reads-at-a-glance — the whole commons of small peer trees
 * surveyable, each rule and what refines it legible without excavation.
 */
export declare function EngineeringView({ snapshot, onOpen, highlight, }: {
    snapshot: LedgerSnapshot;
    onOpen: (id: string) => void;
    highlight?: string | null;
}): import("react").JSX.Element;
