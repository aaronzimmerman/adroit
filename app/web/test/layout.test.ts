import { describe, expect, it } from 'vitest';
import {
  CHILD_SPREAD_PX,
  childrenVisible,
  layoutTree,
  lodFor,
  nodeRadius,
  ringStep,
  visibleNodes,
  wrapText,
} from '../src/map/layout.js';
import { makeSnapshot } from './fixture.js';

const snap = makeSnapshot();

describe('star map layout', () => {
  // @DecisionRef ui:explore-as-star-map — one continuous space: every record of the tree
  // has a position in it.
  it('positions every record of the tree in one space', () => {
    const layout = layoutTree(snap.records, 'story:demo');
    for (const id of ['story:demo', 'app:parent-rule', 'app:child-rule', 'app:severed-zone', 'app:deep-leaf', 'app:consumer-rule']) {
      expect(layout.get(id), id).toBeDefined();
    }
    // engineering records are not part of this tree's space
    expect(layout.get('eng:sample-practice')).toBeUndefined();
  });

  // @DecisionRef ui:collapse-to-named-wholes — recursive sectors: a child's sector nests
  // inside its parent's, the same shape at every depth.
  it('children sit within their parent sector, recursively', () => {
    const layout = layoutTree(snap.records, 'story:demo');
    const check = (id: string): void => {
      const node = layout.get(id)!;
      for (const c of snap.records[id].children) {
        const child = layout.get(c)!;
        expect(child.sector[0]).toBeGreaterThanOrEqual(node.sector[0] - 1e-9);
        expect(child.sector[1]).toBeLessThanOrEqual(node.sector[1] + 1e-9);
        expect(child.depth).toBe(node.depth + 1);
        check(c);
      }
    };
    check('story:demo');
  });

  // @DecisionRef eng:prominence-follows-dependence — visual weight derives from subtree
  // mass and consumers, never per-screen taste.
  it('a heavier subtree and a consumed record render larger', () => {
    expect(nodeRadius(snap.records['app:parent-rule'])).toBeGreaterThan(
      nodeRadius(snap.records['app:deep-leaf']),
    );
  });

  it('rings shrink with depth so deep clusters stay compact', () => {
    expect(ringStep(3)).toBeLessThan(ringStep(1));
  });
});

describe('level of detail', () => {
  const layout = layoutTree(snap.records, 'story:demo');
  const parent = layout.get('app:parent-rule')!;

  // @DecisionRef ui:collapse-to-named-wholes — at low magnification a subtree presents
  // as a named whole; opening it is the same presentation one level down.
  it('collapsed at low zoom, expanded with room, detail at the deepest zoom', () => {
    expect(lodFor(parent, true, 0.01)).toBe('collapsed');
    const expandScale = (CHILD_SPREAD_PX / ringStep(parent.depth + 1)) * 1.1;
    expect(lodFor(parent, true, expandScale)).toBe('expanded');
    expect(lodFor(parent, true, 1000)).toBe('detail');
  });

  it('children are drawn only while the parent is open', () => {
    expect(childrenVisible(parent, 0.01)).toBe(false);
    expect(childrenVisible(parent, 10)).toBe(true);
  });

  // The renderer walks top-down, so the drawn set is bounded by what is open.
  it('visibleNodes is the root alone when everything is collapsed', () => {
    expect(visibleNodes(snap.records, layout, 'story:demo', 0.001)).toEqual(['story:demo']);
    const all = visibleNodes(snap.records, layout, 'story:demo', 1000);
    expect(all.length).toBe(6);
  });
});

describe('wrapText', () => {
  it('wraps to the line budget and marks elision', () => {
    const lines = wrapText('one two three four five six seven eight nine ten', 12, 3);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines[lines.length - 1].endsWith('…')).toBe(true);
    expect(wrapText('short rule', 40, 5)).toEqual(['short rule']);
  });
});
