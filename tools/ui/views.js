// adroit — the three WALKED views: HIERARCHY, CAPABILITIES, MODELS.
//
// The galaxy shows the whole corpus at once; these three are for walking it. They are a separate
// script from the shell on purpose: the galaxy's simulation, camera and hash routing are a world of
// their own, and folding three more views into it would have meant one file nobody can hold.
//
// The contract with the shell is two calls wide — `AdroitViews.activate(mode, host)` when a mode
// is chosen, and `AdroitViews.has(mode)` to ask which modes exist. Everything else in here is
// local. Every fact rendered is SERVED (`/api/tree`, `/api/capability`, `/api/erd`,
// `/api/decision`, `/api/search`): no rule about the store is re-derived in the browser, which is
// the defect eng:namespace-names-kind exists to prevent.
(() => {
  'use strict';

  const MODES = ['hierarchy', 'capabilities', 'models'];
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const get = async (url) => {
    const r = await fetch(url);
    return r.json();
  };

  const S = {
    mode: null,
    host: null,
    tree: null,            // /api/tree
    node: new Map(),       // key -> node (records by id, folders by their path key)
    parent: new Map(),     // key -> parent key
    open: new Set(),       // which folders/records are expanded
    sel: null,             // the record in the detail panel
    q: '',                 // the tree filter, kept across mode switches with its result
    match: null,           // ids matching the tree search, or null for "no search"
    cap: null,             // the capability overlay's pick
    caps: null,            // /api/capability (the list)
    capSel: null,
    capOne: new Map(),     // name -> /api/capability?name=
    erd: null,             // /api/erd
    pos: {},               // ERD box positions, persisted per browser
    view: { k: 1, x: 24, y: 24 },
  };

  const POS_KEY = 'adroit.erd.positions';
  const loadPos = () => {
    // A per-viewer convenience: where somebody dragged the boxes. Never load-bearing — a browser
    // that refuses storage simply gets the auto-layout, which is why every access is guarded.
    try {
      return JSON.parse(localStorage.getItem(POS_KEY) || '{}');
    } catch { return {}; }
  };
  const savePos = () => {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(S.pos));
    } catch { /* private window, blocked site data — the layout just does not persist */ }
  };

  // ---------------------------------------------------------------- the shell
  function frame(host) {
    host.innerHTML = `<div class="vwrap">
      <div class="vmain" id="v-main"></div>
      <aside class="vdetail" id="v-detail"><div class="empty">Select a record to read it.</div></aside>
    </div>`;
  }

  async function activate(mode, host) {
    S.mode = mode;
    if (!MODES.includes(mode)) return;
    if (S.host !== host) { S.host = host; frame(host); }
    if (mode === 'hierarchy') return hierarchy();
    if (mode === 'capabilities') return capabilities();
    if (mode === 'models') return models();
  }

  // ------------------------------------------------------- the detail panel
  // ONE panel for all three views: a record reads the same however you reached it.
  async function select(id) {
    S.sel = id;
    paintSelection();
    const box = $('#v-detail');
    if (!box) return;
    const d = await get(`/api/decision?id=${encodeURIComponent(id)}`);
    if (S.sel !== id) return;                       // a later click won the race
    if (d.error) { box.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
    const r = d.record, c = r.context || {}, l = r.links || {};
    const list = (xs) => (xs || []).map((x) => `<li>${esc(x)}</li>`).join('');
    const link = (e) => `<button class="lnk" data-vrec="${esc(e.id)}">
      <span class="ty">${esc(e.type)}</span><span class="id">${esc(e.id)}</span>
      <span class="st">${esc(e.decision ?? (e.missing ? 'missing' : ''))}</span></button>`;
    const kids = (S.node.get(id)?.children ?? []);
    const chips = (xs, lbl) => (xs && xs.length
      ? `<h3>${lbl}</h3><div class="strip" style="padding:0">${xs.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : '');

    box.innerHTML = `
      <div class="dtop">
        <span class="did">${esc(r.id)}</span>
        <span class="vcount">${esc(r.kind)}</span>
      </div>
      <h2>${esc(r.gist || r.id)}</h2>
      <div class="crumb">${esc(r._rel || r._tree || '')}</div>
      <div class="stmt">${esc(r.decision)}</div>
      ${(r.rejected || []).length ? `<h3>Rejected</h3><ul>${list(r.rejected)}</ul>` : ''}
      ${d.outbound.length ? `<h3>References</h3>${d.outbound.map(link).join('')}` : ''}
      ${d.inbound.length ? `<h3>Referenced by (${d.inbound.length})</h3>${d.inbound.map(link).join('')}` : ''}
      ${kids.length ? `<h3>Refined by, in the tree (${kids.length})</h3>${kids.map((k) =>
        `<button class="lnk" data-vrec="${esc(k.id)}"><span class="id">${esc(k.id)}</span>
         <span class="st">${esc(k.gist)}</span></button>`).join('')}` : ''}
      ${chips(c.tables, 'Tables')}
      ${chips(c.provenance, 'Provenance')}
      ${c.why ? `<h3>Why</h3><div class="why">${esc(c.why)}</div>` : ''}
      ${c.src ? `<h3>Source</h3><div class="why">${esc(c.src)}</div>` : ''}
      ${(d.interactions || []).length ? `<h3>Interactions</h3><ul>${
        list(d.interactions.map((e) => `${e.kind}: ${e.note}`))}</ul>` : ''}`;
    box.scrollTop = 0;
  }

  function paintSelection() {
    document.querySelectorAll('.trow.sel, .ebox.sel').forEach((n) => n.classList.remove('sel'));
    document.querySelectorAll(`[data-vrec="${CSS.escape(S.sel ?? '')}"]`).forEach((n) => {
      if (n.classList.contains('trow') || n.classList.contains('ebox')) n.classList.add('sel');
    });
  }

  // ------------------------------------------------------------- HIERARCHY
  async function hierarchy() {
    const main = $('#v-main');
    if (!S.tree) {
      S.tree = await get('/api/tree');
      indexTree();
      for (const r of S.tree.roots) S.open.add(r.key);       // the roots open; the groups wait
    }
    main.innerHTML = `<div class="vpane">
      <div class="vbar">
        <input id="h-q" type="search" autocomplete="off" placeholder="Filter the tree — words, ids…"
               aria-label="Filter the tree" value="${esc(S.q)}">
        <button class="vbtn" id="h-expand">Expand all</button>
        <button class="vbtn" id="h-collapse">Collapse</button>
        <span class="vcount" id="h-count"></span>
      </div>
      <div class="vchips" id="h-caps"></div>
      <div class="vscroll" id="h-tree"></div>
    </div>`;
    $('#h-q').addEventListener('input', () => {
      clearTimeout(hierarchy.deb);
      hierarchy.deb = setTimeout(runSearch, 160);
    });
    paintChips();
    paintTree();
  }

  function indexTree() {
    S.node.clear();
    S.parent.clear();
    const walk = (n, parentKey) => {
      const key = n.kind === 'record' ? n.id : n.key;
      n._key = key;
      S.node.set(key, n);
      if (parentKey) S.parent.set(key, parentKey);
      for (const c of n.children || []) walk(c, key);
    };
    for (const r of S.tree.roots) walk(r, null);
  }

  /** Every capability leveraged anywhere, with how many records leverage it — counted from the
   *  nodes the server already decorated, so the chip row cannot disagree with the badges. */
  function capCounts() {
    const tally = new Map(S.tree.capabilities.map((c) => [c, 0]));
    for (const n of S.node.values()) {
      for (const c of n.capabilities || []) tally.set(c, (tally.get(c) ?? 0) + 1);
    }
    return tally;
  }

  function paintChips() {
    if (!$('#h-caps')) return;
    const tally = capCounts();
    $('#h-caps').innerHTML = `<span class="lbl">Leverages</span>` + [...tally]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, n]) => `<button class="chip${S.cap === name ? ' on' : ''}" data-vcap="${esc(name)}">
        ${esc(name)}<span class="n">${n}</span></button>`).join('');
  }

  async function runSearch() {
    const q = ($('#h-q')?.value ?? '').trim();
    S.q = q;
    if (!q) { S.match = null; return paintTree(); }
    // The filter is the STORE's search, asked over HTTP — a second matching rule in the browser
    // would be a second definition of what "matches" means.
    const res = await get(`/api/search?q=${encodeURIComponent(q)}`);
    S.match = new Set((res.decisions || []).map((d) => d.id));
    revealAll(S.match);
    paintTree();
  }

  /** Open every folder between the roots and these records, so a filter or an overlay shows what
   *  it found rather than a closed tree with a count on it. */
  function revealAll(ids) {
    for (const id of ids) {
      for (let k = S.parent.get(id); k; k = S.parent.get(k)) S.open.add(k);
    }
  }

  function paintTree() {
    if (!$('#h-tree')) return;               // the tree is not on screen — nothing to repaint
    const filtering = Boolean(S.match);
    // Under a SEARCH the tree is filtered: a node survives if it matched or something beneath it
    // did. Under the CAPABILITY OVERLAY nothing is hidden — the product trees dim around what
    // leverages it, which is the question "where is this used?" asked of the whole shape at once.
    const keep = new Set();
    if (filtering) {
      const mark = (n) => {
        const hit = n.kind === 'record' && S.match.has(n.id);
        const under = (n.children || []).map(mark).some(Boolean);
        if (hit || under) keep.add(n._key);
        return hit || under;
      };
      for (const r of S.tree.roots) mark(r);
    }

    const rows = [];
    const walk = (n, depth) => {
      if (filtering && !keep.has(n._key)) return;
      rows.push(row(n, depth));
      if (S.open.has(n._key)) for (const c of n.children || []) walk(c, depth + 1);
    };
    for (const r of S.tree.roots) walk(r, 0);
    $('#h-tree').innerHTML = `<div class="tree">${rows.join('')}</div>`;
    $('#h-count').textContent = filtering
      ? `${S.match.size} of ${S.tree.records} match`
      : `${S.tree.records} records`;
    paintSelection();
  }

  function row(n, depth) {
    const kids = (n.children || []).length;
    const open = S.open.has(n._key);
    const caret = kids ? (open ? '▾' : '▸') : '·';
    const dim = S.cap && n.kind === 'record' && !(n.capabilities || []).includes(S.cap);
    const cls = [
      'trow', n.kind === 'root' ? 'root' : '', n.kind === 'group' ? 'group' : '',
      dim ? 'dim' : '', S.match && n.kind === 'record' && S.match.has(n.id) ? 'hit' : '',
    ].filter(Boolean).join(' ');
    const badges = (n.capabilities || [])
      .map((c) => `<span class="capb${S.cap === c ? ' on' : ''}">${esc(c)}</span>`).join('');
    const label = n.kind === 'record' ? n.id : n.label;
    return `<button class="${cls}" data-vnode="${esc(n._key)}"${n.kind === 'record' ? ` data-vrec="${esc(n.id)}"` : ''}
      style="padding-left:${8 + depth * 15}px">
      <span class="tcaret">${caret}</span>
      ${n.accent ? `<span class="dot" style="background:${esc(n.accent)}"></span>` : ''}
      <span class="tid">${esc(label)}</span>
      <span class="tgist">${esc(n.kind === 'record' ? n.gist : (n.purpose || ''))}</span>
      ${badges}
      <span class="tn">${kids || n.kind !== 'record' ? n.count : ''}</span>
    </button>`;
  }

  function toggle(key) {
    if (S.open.has(key)) S.open.delete(key);
    else S.open.add(key);
  }

  function expandAll(on) {
    S.open.clear();
    if (on) {
      for (const [key, n] of S.node) if ((n.children || []).length) S.open.add(key);
    } else {
      for (const r of S.tree.roots) S.open.add(r.key);
    }
  }

  /** Both views draw tree rows, so a toggle repaints whichever one is on screen. */
  function repaintTree() {
    if (S.mode === 'capabilities') return void showCapability(S.capSel);
    paintTree();
  }

  // ---- keyboard walking: the visible rows in order, and one step through them
  function walkKeys(dir) {
    const rows = [...document.querySelectorAll('#h-tree .trow')];
    if (!rows.length) return;
    const at = Math.max(0, rows.findIndex((r) => r.dataset.vnode === (walkKeys.cur ?? S.sel)));
    const cur = rows[at];
    const key = cur?.dataset.vnode;
    const n = S.node.get(key);
    if (dir === 'down' || dir === 'up') {
      const next = rows[Math.min(rows.length - 1, Math.max(0, at + (dir === 'down' ? 1 : -1)))];
      walkKeys.cur = next.dataset.vnode;
      next.scrollIntoView({ block: 'nearest' });
      if (next.dataset.vrec) select(next.dataset.vrec);
      else { document.querySelectorAll('.trow.sel').forEach((x) => x.classList.remove('sel')); next.classList.add('sel'); }
      return;
    }
    if (dir === 'right' && n && (n.children || []).length && !S.open.has(key)) { S.open.add(key); return paintTree(); }
    if (dir === 'left') {
      if (S.open.has(key)) { S.open.delete(key); return paintTree(); }
      const p = S.parent.get(key);
      if (p) { walkKeys.cur = p; paintTree(); document.querySelector(`[data-vnode="${CSS.escape(p)}"]`)?.scrollIntoView({ block: 'nearest' }); }
    }
  }

  // ---------------------------------------------------------- CAPABILITIES
  async function capabilities() {
    const main = $('#v-main');
    if (!S.caps) S.caps = (await get('/api/capability')).capabilities;
    if (!S.tree) { S.tree = await get('/api/tree'); indexTree(); }
    main.innerHTML = `<div class="vpane vsplit">
      <div class="vlist" id="c-list"></div>
      <div class="vscroll" id="c-body"></div>
    </div>`;
    paintCapList();
    await showCapability(S.capSel ?? S.caps[0]?.name);
  }

  function paintCapList() {
    $('#c-list').innerHTML = S.caps.map((c) => `<button class="clrow${c.name === S.capSel ? ' sel' : ''}"
      data-vcapsel="${esc(c.name)}">
      <span class="nm">${esc(c.name)}</span>
      <span class="sub">${c.records} record${c.records === 1 ? '' : 's'} · ${c.consumerCount} consumer${c.consumerCount === 1 ? '' : 's'}</span>
    </button>`).join('');
  }

  async function showCapability(name) {
    if (!name) return;
    S.capSel = name;
    paintCapList();
    if (!S.capOne.has(name)) S.capOne.set(name, await get(`/api/capability?name=${encodeURIComponent(name)}`));
    const c = S.capOne.get(name);
    const k = c.contract || {};
    const items = (xs, none) => ((xs || []).length
      ? `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
      : `<div class="none">${none}</div>`);
    const models = (k.models || []).length
      ? `<ul>${k.models.map((m) => `<li><button class="lnk" data-vrec="${esc(m)}" style="padding:0"><span class="id">${esc(m)}</span></button></li>`).join('')}</ul>`
      : '<div class="none">no model of its own</div>';

    // The capability's own tree, walked with the same rows the hierarchy uses.
    const treeNode = S.node.get(c.tree);
    const rows = [];
    if (treeNode) {
      const walk = (n, depth) => {
        rows.push(row(n, depth));
        if (S.open.has(n._key)) for (const ch of n.children || []) walk(ch, depth + 1);
      };
      for (const n of treeNode.children || []) walk(n, 0);
    }

    const strip = (label, xs) => `<div class="strip"><span class="lbl">${label}</span>${
      (xs || []).length
        ? xs.map((u) => `<button class="chip" data-vcapsel="${esc(u.name)}" title="${esc((u.why || []).join('; '))}">${esc(u.name)}</button>`).join('')
        : '<span class="none">none</span>'}</div>`;

    $('#c-body').innerHTML = `
      <div class="contract">
        <div class="ctop">
          <h2>${esc(c.name)}</h2>
          <div class="purpose">${esc(k.purpose || 'This capability publishes no contract.')}</div>
        </div>
        <div class="cgrid">
          <section><h3>Inputs</h3>${items(k.inputs, 'nothing declared')}</section>
          <section><h3>Outputs</h3>${items(k.outputs, 'nothing declared')}</section>
          <section><h3>Models</h3>${models}</section>
          <section><h3>Uses</h3>${items((k.uses || []), 'no other capability')}</section>
        </div>
        ${strip('Depends on', c.uses)}
        ${strip('Depended on by', c.usedBy)}
      </div>
      <div class="vsec">
        <h3>Its decisions (${c.records})</h3>
        <div class="tree">${rows.join('') || '<div class="none">no record yet</div>'}</div>
        <h3>Consumers — who leverages it (${c.consumerCount})</h3>
        ${c.consumersByTree.length ? c.consumersByTree.map((g) => `
          <div class="ctree">${esc(g.cloud)} <span class="vcount">${esc(g.tree)}</span></div>
          ${g.records.map((r) => `<button class="consumer" data-vrec="${esc(r.id)}">
            <span class="ty">${esc(r.type)}</span> <span class="via">${esc(r.id)}</span>
            <span class="vcount">→ ${esc(r.target)}</span>
            <span class="st">${esc(r.statement)}</span></button>`).join('')}
        `).join('') : '<div class="none">nothing outside this capability reaches into it</div>'}
      </div>`;
    $('#c-body').scrollTop = 0;
    paintSelection();
  }

  // ----------------------------------------------------------------- MODELS
  async function models() {
    const main = $('#v-main');
    if (!S.erd) {
      S.erd = await get('/api/erd');
      S.pos = loadPos();
    }
    const s = S.erd.schema;
    main.innerHTML = `<div class="vpane">
      <div class="vbar">
        <span class="vcount">${S.erd.entities.length} models &amp; views · ${S.erd.edges.length} references</span>
        <button class="vbtn" id="e-fit">Fit</button>
        <button class="vbtn" id="e-relayout">Re-lay out</button>
        <span class="vcount">${s.present
          ? `schema: ${s.tables} tables, ${s.columns} columns from ${s.migrations} migrations (V${s.highWater})`
          : 'no schema.json — run node tools/adroit/schema-dump.mjs'}</span>
        ${s.unclaimed?.length ? `<span class="vcount" title="${esc(s.unclaimed.join(', '))}">${s.unclaimed.length} table(s) no model claims</span>` : ''}
      </div>
      <div class="erd" id="e-stage"><div class="plane" id="e-plane"><svg id="e-lines"></svg></div></div>
    </div>`;
    paintBoxes();
    layout({ keepDragged: true });
    wireStage();
  }

  function boxHtml(e) {
    const p = S.pos[e.id] || { x: 0, y: 0 };
    const cols = (t) => t.columns.map((c) => `<div class="ef">
      <span class="fn${c.pk ? ' pk' : ''}">${esc(c.name)}</span>
      ${c.nullable ? '' : '<span class="fq">·</span>'}
      <span class="ft">${esc(c.type.replace('CHARACTER VARYING', 'VARCHAR').replace(' PRECISION', ''))}</span>
    </div>`).join('');
    const body = e.kind === 'view'
      ? (e.derivations.length
        ? `<div class="et">derived fields</div>${e.derivations.map((d) => `<div class="ef"><span class="fn">${esc(d.toLowerCase())}</span></div>`).join('')}`
        : '<div class="ee">a read contract — its fields are its own derivations</div>')
      : (e.tables.length
        ? e.tables.map((t) => `${e.tables.length > 1 || !t.found
          ? `<div class="et${t.found ? '' : ' gone'}">${esc(t.table)}${t.found ? '' : ' — not in the schema'}</div>` : ''}${cols(t)}`).join('')
        : '<div class="ee">no schema mapping yet</div>');
    return `<div class="ebox ${e.kind}" data-vrec="${esc(e.id)}" data-ebox="${esc(e.id)}"
      style="left:${p.x}px;top:${p.y}px">
      <div class="eh"><span class="en">${esc(e.name)}</span><span class="ek">${esc(e.kind)}</span></div>
      <div class="eb">${body}</div>
      ${e.consumers.length ? `<div class="efoot">read by: ${e.consumers.map((c) => esc(c)).join(' · ')}</div>` : ''}
    </div>`;
  }

  function paintBoxes() {
    const plane = $('#e-plane');
    plane.querySelectorAll('.ebox').forEach((n) => n.remove());
    plane.insertAdjacentHTML('beforeend', S.erd.entities.map(boxHtml).join(''));
  }

  /** Auto-layout: masonry columns, in an order that keeps a reference's two ends near each other.
   *  Deliberately not a force simulation — 43 boxes with 7 edges between them is a LIST with a few
   *  joins, and a spring layout would make that look like a web it is not. Drag anything. */
  function layout({ keepDragged = false } = {}) {
    const stage = $('#e-stage');
    const W = 232, GAP = 22;
    const cols = Math.max(2, Math.floor((stage.clientWidth - GAP) / (W + GAP)));
    const heights = new Array(cols).fill(GAP);

    // Connected first, so a component lands in one neighbourhood rather than scattered.
    const adj = new Map();
    for (const e of S.erd.edges) {
      adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
      adj.set(e.target, [...(adj.get(e.target) ?? []), e.source]);
    }
    const order = [], seen = new Set();
    for (const e of S.erd.entities) {
      if (seen.has(e.id) || !adj.has(e.id)) continue;
      const q = [e.id];
      while (q.length) {
        const cur = q.shift();
        if (seen.has(cur)) continue;
        seen.add(cur);
        order.push(cur);
        for (const n of adj.get(cur) ?? []) if (!seen.has(n)) q.push(n);
      }
    }
    for (const e of S.erd.entities) if (!seen.has(e.id)) order.push(e.id);

    for (const id of order) {
      const el = document.querySelector(`[data-ebox="${CSS.escape(id)}"]`);
      if (!el) continue;
      if (keepDragged && S.pos[id]) continue;               // a dragged box keeps where it was put
      const c = heights.indexOf(Math.min(...heights));
      S.pos[id] = { x: GAP + c * (W + GAP), y: heights[c] };
      heights[c] += el.offsetHeight + GAP;
      el.style.left = `${S.pos[id].x}px`;
      el.style.top = `${S.pos[id].y}px`;
    }
    drawLines();
  }

  /** The reference lines. Straight, from box edge to box edge, with an arrow at the end that
   *  depends — legibility over fashion, and orthogonal routing would need a router nobody asked
   *  for at seven edges. */
  function drawLines() {
    const rect = (id) => {
      const el = document.querySelector(`[data-ebox="${CSS.escape(id)}"]`);
      const p = S.pos[id];
      return el && p ? { x: p.x, y: p.y, w: el.offsetWidth, h: el.offsetHeight } : null;
    };
    // Where a line leaves a box: the point on its border towards the other box's centre.
    const exit = (r, tx, ty) => {
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const dx = tx - cx, dy = ty - cy;
      if (!dx && !dy) return { x: cx, y: cy };
      const sx = Math.abs(dx) > 1e-6 ? (r.w / 2) / Math.abs(dx) : Infinity;
      const sy = Math.abs(dy) > 1e-6 ? (r.h / 2) / Math.abs(dy) : Infinity;
      const t = Math.min(sx, sy);
      return { x: cx + dx * t, y: cy + dy * t };
    };
    let maxX = 0, maxY = 0;
    for (const id of Object.keys(S.pos)) {
      const r = rect(id);
      if (r) { maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h); }
    }
    const lines = [];
    for (const e of S.erd.edges) {
      const a = rect(e.source), b = rect(e.target);
      if (!a || !b) continue;
      const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      const p1 = exit(a, bc.x, bc.y), p2 = exit(b, ac.x, ac.y);
      lines.push(`<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}"
        stroke="var(--violet)" stroke-width="1.5" marker-end="url(#varrow)" opacity=".75"/>`);
    }
    const svg = $('#e-lines');
    svg.setAttribute('width', maxX + 60);
    svg.setAttribute('height', maxY + 60);
    svg.innerHTML = `<defs><marker id="varrow" viewBox="0 0 10 10" refX="9" refY="5"
        markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--violet)"/></marker></defs>${lines.join('')}`;
    applyView();
  }

  const applyView = () => {
    const p = $('#e-plane');
    if (p) p.style.transform = `translate(${S.view.x}px,${S.view.y}px) scale(${S.view.k})`;
  };

  function fit() {
    const stage = $('#e-stage');
    let maxX = 0, maxY = 0;
    for (const id of Object.keys(S.pos)) {
      const el = document.querySelector(`[data-ebox="${CSS.escape(id)}"]`);
      if (!el) continue;
      maxX = Math.max(maxX, S.pos[id].x + el.offsetWidth);
      maxY = Math.max(maxY, S.pos[id].y + el.offsetHeight);
    }
    if (!maxX || !maxY) return;
    S.view.k = Math.min(1, (stage.clientWidth - 40) / maxX, (stage.clientHeight - 40) / maxY);
    S.view.x = 20;
    S.view.y = 20;
    applyView();
  }

  // Drag and pan state lives here, not in the wiring call: the stage element is rebuilt every time
  // the view is entered, and window-level listeners registered per entry would pile up.
  let pan = null, drag = null;
  window.addEventListener('mousemove', (ev) => {
    if (drag) {
      const dx = (ev.clientX - drag.x) / S.view.k, dy = (ev.clientY - drag.y) / S.view.k;
      S.pos[drag.id] = { x: drag.x0 + dx, y: drag.y0 + dy };
      const el = document.querySelector(`[data-ebox="${CSS.escape(drag.id)}"]`);
      if (!el) return;
      el.style.left = `${S.pos[drag.id].x}px`;
      el.style.top = `${S.pos[drag.id].y}px`;
      drawLines();
      return;
    }
    if (pan) {
      S.view.x = pan.vx + (ev.clientX - pan.x);
      S.view.y = pan.vy + (ev.clientY - pan.y);
      applyView();
    }
  });
  window.addEventListener('mouseup', () => {
    if (drag) savePos();
    drag = null;
    pan = null;
    $('#e-stage')?.classList.remove('panning');
  });

  function wireStage() {
    const stage = $('#e-stage');
    stage.addEventListener('mousedown', (ev) => {
      const head = ev.target.closest('.eh');
      const box = ev.target.closest('.ebox');
      if (head && box) {
        const id = box.dataset.ebox;
        const p = S.pos[id] ?? { x: 0, y: 0 };
        drag = { id, x: ev.clientX, y: ev.clientY, x0: p.x, y0: p.y };
      } else {
        pan = { x: ev.clientX, y: ev.clientY, vx: S.view.x, vy: S.view.y };
        stage.classList.add('panning');
      }
    });
    stage.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const r = stage.getBoundingClientRect();
      const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      const k = Math.max(0.25, Math.min(2.5, S.view.k * (ev.deltaY < 0 ? 1.1 : 1 / 1.1)));
      S.view.x = mx - (mx - S.view.x) * (k / S.view.k);
      S.view.y = my - (my - S.view.y) * (k / S.view.k);
      S.view.k = k;
      applyView();
    }, { passive: false });
  }

  // ------------------------------------------------------------------ events
  // One delegated listener for all three views, so a re-render never has to re-bind anything.
  document.addEventListener('click', (e) => {
    if (!MODES.includes(S.mode)) return;
    const cap = e.target.closest('[data-vcap]');
    if (cap) {
      S.cap = S.cap === cap.dataset.vcap ? null : cap.dataset.vcap;
      if (S.cap) {
        revealAll([...S.node.values()].filter((n) => (n.capabilities || []).includes(S.cap)).map((n) => n._key));
      }
      paintChips();
      return paintTree();
    }
    const pick = e.target.closest('[data-vcapsel]');
    if (pick) return void showCapability(pick.dataset.vcapsel);
    if (e.target.closest('#h-expand')) { expandAll(true); return paintTree(); }
    if (e.target.closest('#h-collapse')) { expandAll(false); return paintTree(); }
    if (e.target.closest('#e-fit')) return fit();
    if (e.target.closest('#e-relayout')) { S.pos = {}; savePos(); layout(); return; }
    const node = e.target.closest('[data-vnode]');
    const rec = e.target.closest('[data-vrec]');
    if (node) {
      // A folder toggles; a record both selects and toggles, because in this tree a record IS the
      // folder its refinements live in.
      const key = node.dataset.vnode;
      if ((S.node.get(key)?.children || []).length) toggle(key);
      walkKeys.cur = key;
      if (node.dataset.vrec) select(node.dataset.vrec);
      return repaintTree();
    }
    if (rec) return void select(rec.dataset.vrec);
  });

  document.addEventListener('keydown', (e) => {
    if (S.mode !== 'hierarchy') return;
    if (document.activeElement === $('#h-q')) {
      if (e.key === 'Escape') { $('#h-q').value = ''; runSearch(); }
      return;
    }
    const dir = { ArrowDown: 'down', ArrowUp: 'up', ArrowLeft: 'left', ArrowRight: 'right' }[e.key];
    if (dir) { e.preventDefault(); walkKeys(dir); }
    if (e.key === '/') { e.preventDefault(); $('#h-q')?.focus(); }
  });

  window.AdroitViews = { activate, has: (m) => MODES.includes(m), modes: MODES };
})();
