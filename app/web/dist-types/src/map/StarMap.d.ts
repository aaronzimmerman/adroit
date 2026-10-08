import type { LedgerSnapshot } from '@adroit/shared';
export interface StarMapCallbacks {
    /** A record chosen at depth — the DOM overlay expands it in place. */
    onOpen: (id: string) => void;
    onSelect: (id: string | null) => void;
}
export declare class StarMap {
    private canvas;
    private callbacks;
    private ctx;
    private records;
    private layout;
    private rootId;
    private skewByNode;
    private camera;
    private flight;
    private dragging;
    private dragMoved;
    private last;
    private selected;
    private raf;
    private stars;
    private disposed;
    constructor(canvas: HTMLCanvasElement, callbacks: StarMapCallbacks);
    dispose(): void;
    setData(snapshot: LedgerSnapshot, rootId: string): void;
    setSelected(id: string | null): void;
    /** Continuous motion to a record: travel within the tree is flight, never a jump. */
    flyTo(id: string, detail?: boolean): void;
    private fitScale;
    private toScreen;
    private toWorld;
    private onPointerDown;
    private onPointerMove;
    private onPointerUp;
    private onWheel;
    private hitTest;
    private loop;
    private draw;
    private drawNode;
    private dubiousTag;
}
