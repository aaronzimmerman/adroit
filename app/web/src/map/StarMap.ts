// @DecisionRef ui:explore-as-star-map — a hierarchical tree explored as one continuous
// space: fly around, click and drag, zoom in and out; motion, never a page jump.
// @DecisionRef eng:map-on-gpu-canvas — the continuous-space view renders through a
// GPU-backed canvas, never DOM nodes; DOM is for the prose overlay around it.
// @DecisionRef eng:react-with-vite — this renderer is framework-agnostic; React owns
// only the prose surfaces around the canvas.
import type { DerivedRecord, LedgerSnapshot, SkewSignal } from '@adroit/shared';
import {
  childrenVisible,
  layoutTree,
  lodFor,
  visibleNodes,
  wrapText,
  type NodeLayout,
} from './layout.js';

interface Camera {
  x: number;
  y: number;
  scale: number;
}

export interface StarMapCallbacks {
  /** A record chosen at depth — the DOM overlay expands it in place. */
  onOpen: (id: string) => void;
  onSelect: (id: string | null) => void;
}

const FLY_MS = 650;

export class StarMap {
  private ctx: CanvasRenderingContext2D;
  private records: Record<string, DerivedRecord> = {};
  private layout = new Map<string, NodeLayout>();
  private rootId = '';
  private skewByNode = new Map<string, SkewSignal>();
  private camera: Camera = { x: 0, y: 0, scale: 0.5 };
  private flight: { from: Camera; to: Camera; start: number } | null = null;
  private dragging = false;
  private dragMoved = false;
  private last = { x: 0, y: 0 };
  private selected: string | null = null;
  private raf = 0;
  private stars: { x: number; y: number; a: number }[] = [];
  private disposed = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private callbacks: StarMapCallbacks,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    // deterministic backdrop starfield
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 300; i++) {
      this.stars.push({ x: rand() * 4000 - 2000, y: rand() * 4000 - 2000, a: 0.2 + rand() * 0.5 });
    }
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.loop();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }

  setData(snapshot: LedgerSnapshot, rootId: string): void {
    const sameTree = rootId === this.rootId;
    this.records = snapshot.records;
    this.rootId = rootId;
    this.layout = layoutTree(snapshot.records, rootId);
    this.skewByNode = new Map(snapshot.skew.map((s) => [s.id, s]));
    if (!sameTree) {
      // A new tree is a clean cut: land on the whole (ui:cross-root-is-a-cut).
      this.camera = { x: 0, y: 0, scale: this.fitScale() };
      this.flight = null;
      this.selected = null;
    }
  }

  setSelected(id: string | null): void {
    this.selected = id;
  }

  /** Continuous motion to a record: travel within the tree is flight, never a jump. */
  flyTo(id: string, detail = true): void {
    const node = this.layout.get(id);
    if (!node) return;
    const rec = this.records[id];
    const targetScale = detail
      ? Math.max(200 / Math.max(node.r, 1), 1.2)
      : Math.max(this.fitScale() * 3, 0.8);
    this.flight = {
      from: { ...this.camera },
      to: { x: node.x, y: node.y, scale: targetScale },
      start: performance.now(),
    };
    this.selected = id;
    this.callbacks.onSelect(id);
    void rec;
  }

  private fitScale(): number {
    let maxR = 100;
    for (const n of this.layout.values()) {
      maxR = Math.max(maxR, Math.hypot(n.x, n.y) + n.r);
    }
    return Math.min(this.canvas.width, this.canvas.height) / (2.3 * maxR);
  }

  private toScreen(x: number, y: number): [number, number] {
    const { width, height } = this.canvas;
    return [
      width / 2 + (x - this.camera.x) * this.camera.scale,
      height / 2 + (y - this.camera.y) * this.camera.scale,
    ];
  }

  private toWorld(sx: number, sy: number): [number, number] {
    const { width, height } = this.canvas;
    return [
      this.camera.x + (sx - width / 2) / this.camera.scale,
      this.camera.y + (sy - height / 2) / this.camera.scale,
    ];
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.dragging = true;
    this.dragMoved = false;
    this.last = { x: e.offsetX, y: e.offsetY };
    this.canvas.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = e.offsetX - this.last.x;
    const dy = e.offsetY - this.last.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) this.dragMoved = true;
    this.camera.x -= dx / this.camera.scale;
    this.camera.y -= dy / this.camera.scale;
    this.last = { x: e.offsetX, y: e.offsetY };
    this.flight = null;
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.dragging = false;
    if (this.dragMoved) return;
    const hit = this.hitTest(e.offsetX, e.offsetY);
    if (!hit) {
      this.callbacks.onSelect(null);
      this.selected = null;
      return;
    }
    const node = this.layout.get(hit)!;
    const lod = lodFor(node, (this.records[hit]?.children.length ?? 0) > 0, this.camera.scale);
    if (lod === 'detail' || this.selected === hit) {
      // The full record expands in place, over the map — never a navigation
      // (ui:full-record-expands-in-place).
      this.callbacks.onOpen(hit);
    } else {
      this.flyTo(hit, lod === 'collapsed' ? false : true);
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0016);
    const [wx, wy] = this.toWorld(e.offsetX, e.offsetY);
    const next = Math.min(80, Math.max(0.02, this.camera.scale * factor));
    const applied = next / this.camera.scale;
    // zoom toward the cursor: keep the world point under it fixed
    this.camera.x = wx - (wx - this.camera.x) / applied;
    this.camera.y = wy - (wy - this.camera.y) / applied;
    this.camera.scale = next;
    this.flight = null;
  };

  private hitTest(sx: number, sy: number): string | null {
    const ids = visibleNodes(this.records, this.layout, this.rootId, this.camera.scale);
    let best: string | null = null;
    let bestDist = Infinity;
    for (const id of ids) {
      const n = this.layout.get(id)!;
      const [nx, ny] = this.toScreen(n.x, n.y);
      const dist = Math.hypot(nx - sx, ny - sy);
      const reach = Math.max(n.r * this.camera.scale, 14);
      if (dist < reach && dist < bestDist) {
        best = id;
        bestDist = dist;
      }
    }
    return best;
  }

  private loop = (): void => {
    if (this.disposed) return;
    if (this.flight) {
      const t = Math.min(1, (performance.now() - this.flight.start) / FLY_MS);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const { from, to } = this.flight;
      this.camera = {
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
        scale: from.scale * Math.pow(to.scale / from.scale, e),
      };
      if (t >= 1) this.flight = null;
    }
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  private draw(): void {
    const { ctx, canvas, camera } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, w, h);
    for (const s of this.stars) {
      const sx = (s.x - camera.x * 0.08) % w;
      const sy = (s.y - camera.y * 0.08) % h;
      ctx.fillStyle = `rgba(200,210,255,${s.a * 0.35})`;
      ctx.fillRect(((sx % w) + w) % w, ((sy % h) + h) % h, 1.4, 1.4);
    }
    if (!this.rootId || this.layout.size === 0) return;

    const ids = visibleNodes(this.records, this.layout, this.rootId, camera.scale);

    // edges first
    ctx.strokeStyle = 'rgba(110,130,200,0.22)';
    ctx.lineWidth = 1;
    for (const id of ids) {
      const node = this.layout.get(id)!;
      if (!childrenVisible(node, camera.scale)) continue;
      const [px, py] = this.toScreen(node.x, node.y);
      for (const c of this.records[id]?.children ?? []) {
        const cn = this.layout.get(c);
        if (!cn) continue;
        const [cx, cy] = this.toScreen(cn.x, cn.y);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(cx, cy);
        ctx.stroke();
      }
    }

    for (const id of ids) {
      this.drawNode(id);
    }
  }

  private drawNode(id: string): void {
    const { ctx, camera } = this;
    const node = this.layout.get(id)!;
    const rec = this.records[id];
    if (!rec) return;
    const [sx, sy] = this.toScreen(node.x, node.y);
    const sr = Math.max(node.r * camera.scale, 2.5);
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (sx < -w * 0.3 || sx > w * 1.3 || sy < -h * 0.3 || sy > h * 1.3) return;

    const lod = lodFor(node, rec.children.length > 0, camera.scale);
    const dubious = rec.dubious.length > 0;
    const skew = this.skewByNode.get(id);

    if (lod !== 'detail') {
      // glow — amber wherever the record is dubious (ui:edits-cast-suspicion: the label
      // reads visibly wherever the record appears)
      const glowR = Math.min(sr * 2.6, 190);
      const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR);
      const core = dubious ? 'rgba(255,180,70,0.95)' : 'rgba(170,200,255,0.95)';
      const halo = dubious ? 'rgba(255,150,40,0.10)' : 'rgba(120,160,255,0.10)';
      glow.addColorStop(0, core);
      glow.addColorStop(0.35, halo);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(sx, sy, glowR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = dubious ? '#ffd9a0' : '#e8efff';
      ctx.beginPath();
      ctx.arc(sx, sy, Math.min(sr * 0.45, 26), 0, Math.PI * 2);
      ctx.fill();
    }

    if (this.selected === id) {
      ctx.strokeStyle = 'rgba(120,255,210,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, sr * 0.7 + 8, 0, Math.PI * 2);
      ctx.stroke();
    }

    // structural skew accent: the macro view surfaces concentration unasked
    // (ui:surface-structural-skew)
    if (skew && lod !== 'detail') {
      ctx.strokeStyle = 'rgba(255,120,200,0.75)';
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(sx, sy, sr * 0.9 + 13, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const slug = id.split(':')[1] ?? id;
    ctx.textAlign = 'center';

    if (lod === 'collapsed') {
      // A subtree presents as a named whole with its mass legible
      // (ui:collapse-to-named-wholes).
      if (sr >= 4) {
        ctx.fillStyle = dubious ? '#ffcf90' : '#aebcdf';
        ctx.font = `${Math.max(11, Math.min(15, sr * 0.5))}px system-ui, sans-serif`;
        ctx.fillText(slug, sx, sy + sr * 0.5 + 16);
        if (rec.subtreeSize > 1) {
          ctx.fillStyle = 'rgba(150,170,220,0.75)';
          ctx.font = '10px system-ui, sans-serif';
          ctx.fillText(`${rec.subtreeSize} decisions`, sx, sy + sr * 0.5 + 30);
        }
      }
      if (dubious && sr >= 7) this.dubiousTag(sx, sy - sr * 0.5 - 12);
    } else if (lod === 'expanded') {
      ctx.fillStyle = dubious ? '#ffcf90' : '#dde6ff';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.fillText(rec.id, sx, sy - sr * 0.45 - 10);
      if (dubious) this.dubiousTag(sx, sy - sr * 0.45 - 28);
      if (skew && skew.note) {
        ctx.fillStyle = 'rgba(255,140,210,0.8)';
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillText(skew.note, sx, sy - sr * 0.45 - 42);
      }
    } else {
      // Deepest zoom: the rule itself plus effective commitments, readable in the space
      // (ui:full-record-expands-in-place, ui:commitments-always-visible).
      const panelH = 130 + wrapText(rec.doc.decision, 64, 7).length * 17 + rec.effectiveCommitments.length * 15;
      ctx.fillStyle = 'rgba(10, 15, 30, 0.88)';
      ctx.strokeStyle = dubious ? 'rgba(255,179,71,0.65)' : 'rgba(90,115,180,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(sx - 290, sy - 100, 580, panelH, 14);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#9fb2dd';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.fillText(rec.id, sx, sy - 64);
      if (dubious) this.dubiousTag(sx, sy - 84);
      ctx.fillStyle = '#eef3ff';
      ctx.font = '13px Georgia, serif';
      const lines = wrapText(rec.doc.decision, 64, 7);
      lines.forEach((line, i) => ctx.fillText(line, sx, sy - 40 + i * 17));
      let y = sy - 40 + lines.length * 17 + 14;
      for (const c of rec.effectiveCommitments) {
        ctx.fillStyle = 'rgba(140,230,190,0.9)';
        ctx.font = '11px system-ui, sans-serif';
        const own = c.declaredBy === rec.id ? ' (declared here)' : ` (from ${c.declaredBy})`;
        ctx.fillText(`◆ ${c.id}${own}${c.adherence ? ' — ' + c.adherence : ''}`, sx, y);
        y += 15;
      }
      ctx.fillStyle = 'rgba(150,170,220,0.6)';
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillText('click to expand the full record', sx, y + 10);
    }
  }

  private dubiousTag(sx: number, sy: number): void {
    const { ctx } = this;
    ctx.fillStyle = '#2b1a05';
    ctx.strokeStyle = '#ffb347';
    const label = 'DUBIOUS';
    ctx.font = 'bold 10px system-ui, sans-serif';
    const tw = ctx.measureText(label).width + 12;
    ctx.beginPath();
    ctx.roundRect(sx - tw / 2, sy - 9, tw, 15, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffb347';
    ctx.fillText(label, sx, sy + 2.5);
  }
}
