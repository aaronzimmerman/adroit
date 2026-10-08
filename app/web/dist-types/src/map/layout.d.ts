import type { DerivedRecord } from '@adroit/shared';
export interface NodeLayout {
    id: string;
    x: number;
    y: number;
    /** Visual radius in world units — follows dependence, not taste. */
    r: number;
    depth: number;
    sector: [number, number];
}
export declare const CHILD_SPREAD_PX = 56;
export declare function ringStep(depth: number): number;
/**
 * Visual weight follows how much depends on the record: subtree mass plus consumers.
 * @DecisionRef eng:prominence-follows-dependence — prominence derives from the graph.
 */
export declare function nodeRadius(rec: DerivedRecord): number;
/**
 * Radial layout: each subtree owns an angular sector proportional to its mass, recursively
 * — the same shape at every depth, so opening a named whole yields the same presentation
 * one level down (@DecisionRef ui:collapse-to-named-wholes).
 */
export declare function layoutTree(records: Record<string, DerivedRecord>, rootId: string): Map<string, NodeLayout>;
export type Lod = 'collapsed' | 'expanded' | 'detail';
/**
 * At any camera scale a subtree presents as a named whole until there is room to open it;
 * the deepest zoom renders the rule itself (@DecisionRef ui:collapse-to-named-wholes,
 * @DecisionRef ui:full-record-expands-in-place — essentials on the map, the full weight
 * behind an in-place overlay).
 */
export declare function lodFor(node: NodeLayout, hasChildren: boolean, scale: number): Lod;
/** Children are drawn only while their parent is open at the current magnification. */
export declare function childrenVisible(node: NodeLayout, scale: number): boolean;
/** The set of nodes the renderer draws at one camera scale: bounded, top-down. */
export declare function visibleNodes(records: Record<string, DerivedRecord>, layout: Map<string, NodeLayout>, rootId: string, scale: number): string[];
/** Word-wrap decision text for canvas rendering at the deepest zoom. */
export declare function wrapText(text: string, maxChars: number, maxLines: number): string[];
