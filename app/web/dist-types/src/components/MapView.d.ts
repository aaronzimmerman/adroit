import type { LedgerSnapshot } from '@adroit/shared';
import { StarMap } from '../map/StarMap.js';
/**
 * Hosts the framework-agnostic canvas renderer. React owns only the prose around it
 * (@DecisionRef eng:react-with-vite); the map itself is canvas, never DOM nodes
 * (@DecisionRef eng:map-on-gpu-canvas).
 */
export declare function MapView({ snapshot, rootId, focus, onOpen, onSelect, mapRef, }: {
    snapshot: LedgerSnapshot;
    rootId: string;
    focus: {
        id: string;
        n: number;
    } | null;
    onOpen: (id: string) => void;
    onSelect: (id: string | null) => void;
    mapRef: React.MutableRefObject<StarMap | null>;
}): import("react").JSX.Element;
