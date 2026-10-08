// Pure layout and level-of-detail rules for the star map. Pure so the product rules it
// realizes are testable headlessly; the canvas renderer only draws what this computes.
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

// Named once (eng:window-named-once): the geometry and LOD thresholds of the map.
const RING_BASE = 320;
const RING_DECAY = 0.74;
export const CHILD_SPREAD_PX = 56;
const DETAIL_PX = 170;

export function ringStep(depth: number): number {
  return RING_BASE * Math.pow(RING_DECAY, Math.max(0, depth - 1));
}

/**
 * Visual weight follows how much depends on the record: subtree mass plus consumers.
 * @DecisionRef eng:prominence-follows-dependence — prominence derives from the graph.
 */
export function nodeRadius(rec: DerivedRecord): number {
  return 7 + 5 * Math.sqrt(rec.subtreeSize - 1) + 2.5 * Math.sqrt(rec.consumers.length);
}

/**
 * Radial layout: each subtree owns an angular sector proportional to its mass, recursively
 * — the same shape at every depth, so opening a named whole yields the same presentation
 * one level down (@DecisionRef ui:collapse-to-named-wholes).
 */
export function layoutTree(
  records: Record<string, DerivedRecord>,
  rootId: string,
): Map<string, NodeLayout> {
  const out = new Map<string, NodeLayout>();
  const root = records[rootId];
  if (!root) return out;

  const place = (
    id: string,
    x: number,
    y: number,
    depth: number,
    sector: [number, number],
  ): void => {
    const rec = records[id];
    if (!rec) return;
    out.set(id, { id, x, y, r: nodeRadius(rec), depth, sector });
    const children = rec.children.filter((c) => records[c]);
    if (children.length === 0) return;
    const total = children.reduce((s, c) => s + records[c].subtreeSize, 0);
    const span = sector[1] - sector[0];
    const dist = ringStep(depth + 1);
    let angle = sector[0];
    for (const child of children) {
      const share = records[child].subtreeSize / total;
      const childSpan = span * share;
      const mid = angle + childSpan / 2;
      place(
        child,
        x + Math.cos(mid) * dist,
        y + Math.sin(mid) * dist,
        depth + 1,
        [angle + childSpan * 0.06, angle + childSpan * 0.94],
      );
      angle += childSpan;
    }
  };

  place(rootId, 0, 0, 0, [-Math.PI * 0.92, Math.PI * 0.92]);
  return out;
}

export type Lod = 'collapsed' | 'expanded' | 'detail';

/**
 * At any camera scale a subtree presents as a named whole until there is room to open it;
 * the deepest zoom renders the rule itself (@DecisionRef ui:collapse-to-named-wholes,
 * @DecisionRef ui:full-record-expands-in-place — essentials on the map, the full weight
 * behind an in-place overlay).
 */
export function lodFor(node: NodeLayout, hasChildren: boolean, scale: number): Lod {
  if (node.r * scale >= DETAIL_PX) return 'detail';
  if (hasChildren && ringStep(node.depth + 1) * scale >= CHILD_SPREAD_PX) return 'expanded';
  if (!hasChildren && node.r * scale >= DETAIL_PX * 0.45) return 'detail';
  return 'collapsed';
}

/** Children are drawn only while their parent is open at the current magnification. */
export function childrenVisible(node: NodeLayout, scale: number): boolean {
  return ringStep(node.depth + 1) * scale >= CHILD_SPREAD_PX;
}

/** The set of nodes the renderer draws at one camera scale: bounded, top-down. */
export function visibleNodes(
  records: Record<string, DerivedRecord>,
  layout: Map<string, NodeLayout>,
  rootId: string,
  scale: number,
): string[] {
  const out: string[] = [];
  const walk = (id: string): void => {
    const node = layout.get(id);
    if (!node) return;
    out.push(id);
    if (childrenVisible(node, scale)) {
      for (const c of records[id]?.children ?? []) walk(c);
    }
  };
  walk(rootId);
  return out;
}

/** Word-wrap decision text for canvas rendering at the deepest zoom. */
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > maxChars) {
      lines.push(line.trim());
      line = word;
      if (lines.length === maxLines - 1) break;
    } else {
      line = (line + ' ' + word).trim();
    }
  }
  if (line && lines.length < maxLines) lines.push(line.trim());
  const used = lines.join(' ').length;
  if (used < text.trim().length && lines.length > 0) {
    lines[lines.length - 1] = lines[lines.length - 1] + ' …';
  }
  return lines;
}
