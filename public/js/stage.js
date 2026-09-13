/* The stage: view transform, editor chrome and every pointer interaction.
 * Artwork itself comes from render.js so the canvas matches the exports. */

import { state, emit, commit, beginChange, abandonChange, select, byId, selected, isSelected, subscribe } from './store.js';
import { drawLayout } from './render.js';
import { onAssetLoad } from './assets.js';
import {
  boundsOf, hitTest, hitRadius, hitShape, toLocal, travelRadius,
  nearestAnchor, anchorPoint, round2, clamp, uniqueId, makeControl,
} from './model.js';
import { setStatus, toast } from './ui.js';
import { playPointerDown, playPointerMove, playPointerUp, playInput, clearPlay } from './play.js';

const HANDLE = 7;           // handle half-size, screen px
const SNAP_PX = 7;          // snap threshold, screen px
const MIN_SIZE = 16;        // smallest control, reference px

let canvas, ctx, viewport, dpr = 1;
let cursorRef = { x: 0, y: 0 };
let guides = { v: [], h: [] };
let marquee = null;
let spaceHeld = false;

/* ── view transform ─────────────────────────────────────────────────── */

export const toScreen = (x, y) => ({
  x: x * state.view.zoom + state.view.panX,
  y: y * state.view.zoom + state.view.panY,
});
export const toRef = (x, y) => ({
  x: (x - state.view.panX) / state.view.zoom,
  y: (y - state.view.panY) / state.view.zoom,
});

function pointerRef(e) {
  const r = canvas.getBoundingClientRect();
  return toRef(e.clientX - r.left, e.clientY - r.top);
}

export function fitView(padding = 56) {
  const ref = state.doc.reference;
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  if (!w || !h) return;
  const zoom = Math.min((w - padding) / ref.width, (h - padding) / ref.height);
  state.view.zoom = clamp(zoom, 0.05, 8);
  state.view.panX = (w - ref.width * state.view.zoom) / 2;
  state.view.panY = (h - ref.height * state.view.zoom) / 2;
  state.view.fitted = true;
  emit('view');
}

export function zoomBy(factor, cx, cy) {
  const v = state.view;
  const before = toRef(cx, cy);
  v.zoom = clamp(v.zoom * factor, 0.05, 8);
  const after = toRef(cx, cy);
  v.panX += (after.x - before.x) * v.zoom;
  v.panY += (after.y - before.y) * v.zoom;
  emit('view');
}

export function setZoom(z) {
  const v = state.view;
  zoomBy(clamp(z, 0.05, 8) / v.zoom, viewport.clientWidth / 2, viewport.clientHeight / 2);
}

/* ── canvas sizing ──────────────────────────────────────────────────── */

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  if (!state.view.fitted) fitView(); else draw();
}

/* ── drawing ────────────────────────────────────────────────────────── */

let raf = 0;
export function requestDraw() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; draw(); });
}

export function draw() {
  if (!ctx) return;
  const { doc, view, ui } = state;
  const ref = doc.reference;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Backdrop outside the screen rect.
  ctx.fillStyle = '#0a0b0e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(view.panX, view.panY);
  ctx.scale(view.zoom, view.zoom);

  // Screen plate + shadow.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)';
  ctx.shadowBlur = 24 / view.zoom;
  ctx.shadowOffsetY = 6 / view.zoom;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, ref.width, ref.height);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, ref.width, ref.height);
  ctx.clip();

  drawLayout(ctx, doc, { input: ui.play ? playInput() : null, skipHidden: false });

  if (ui.showGrid && !ui.play) drawGrid(ctx, doc, ref);
  ctx.restore();

  if (!ui.play) {
    if (ui.showSafe) drawSafeArea(ctx, doc, ref);
    if (ui.showCenterLine) drawCenterLine(ctx, ref);
    drawHiddenMarks(ctx, doc);
    drawGuides(ctx, ref);
    drawSelection(ctx);
    if (marquee) drawMarquee(ctx);
  } else {
    drawPlayHints(ctx, doc);
  }

  // Screen border on top of everything.
  ctx.strokeStyle = 'rgba(255,255,255,.14)';
  ctx.lineWidth = 1 / view.zoom;
  ctx.strokeRect(0, 0, ref.width, ref.height);

  ctx.restore();
  updateStatus();
}

function drawGrid(ctx, doc, ref) {
  const size = doc.grid.size || 16;
  const z = state.view.zoom;
  if (size * z < 5) return;
  ctx.save();
  ctx.lineWidth = 1 / z;
  ctx.strokeStyle = 'rgba(255,255,255,.055)';
  ctx.beginPath();
  for (let x = size; x < ref.width; x += size) { ctx.moveTo(x, 0); ctx.lineTo(x, ref.height); }
  for (let y = size; y < ref.height; y += size) { ctx.moveTo(0, y); ctx.lineTo(ref.width, y); }
  ctx.stroke();
  ctx.restore();
}

function drawSafeArea(ctx, doc, ref) {
  const s = doc.safeArea;
  if (!s || (!s.top && !s.right && !s.bottom && !s.left)) return;
  ctx.save();
  ctx.lineWidth = 1 / state.view.zoom;
  ctx.setLineDash([6 / state.view.zoom, 5 / state.view.zoom]);
  ctx.strokeStyle = 'rgba(255,187,51,.5)';
  ctx.strokeRect(s.left, s.top, ref.width - s.left - s.right, ref.height - s.top - s.bottom);
  ctx.restore();
}

function drawCenterLine(ctx, ref) {
  ctx.save();
  ctx.lineWidth = 1 / state.view.zoom;
  ctx.setLineDash([4 / state.view.zoom, 4 / state.view.zoom]);
  ctx.strokeStyle = 'rgba(109,140,255,.6)';
  ctx.beginPath();
  ctx.moveTo(ref.width / 2, 0); ctx.lineTo(ref.width / 2, ref.height);
  ctx.stroke();
  ctx.restore();
}

function drawHiddenMarks(ctx, doc) {
  const z = state.view.zoom;
  for (const c of doc.controls) {
    if (!c.hidden) continue;
    const b = boundsOf(c);
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = 'rgba(255,107,107,.7)';
    ctx.lineWidth = 1 / z;
    ctx.setLineDash([3 / z, 3 / z]);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.restore();
  }
}

function drawGuides(ctx, ref) {
  if (!guides.v.length && !guides.h.length) return;
  const z = state.view.zoom;
  ctx.save();
  ctx.strokeStyle = '#59d9c0';
  ctx.lineWidth = 1 / z;
  ctx.beginPath();
  for (const x of guides.v) { ctx.moveTo(x, 0); ctx.lineTo(x, ref.height); }
  for (const y of guides.h) { ctx.moveTo(0, y); ctx.lineTo(ref.width, y); }
  ctx.stroke();
  ctx.restore();
}

function drawMarquee(ctx) {
  const z = state.view.zoom;
  const x = Math.min(marquee.x0, marquee.x1);
  const y = Math.min(marquee.y0, marquee.y1);
  const w = Math.abs(marquee.x1 - marquee.x0);
  const h = Math.abs(marquee.y1 - marquee.y0);
  ctx.save();
  ctx.fillStyle = 'rgba(89,217,192,.1)';
  ctx.strokeStyle = '#59d9c0';
  ctx.lineWidth = 1 / z;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

/** Handle positions for the primary selection, in reference space. */
export function handlesFor(c) {
  const hw = c.w / 2;
  const hh = c.h / 2;
  const pts = [
    { id: 'nw', x: -hw, y: -hh }, { id: 'ne', x: hw, y: -hh },
    { id: 'se', x: hw, y: hh }, { id: 'sw', x: -hw, y: hh },
  ];
  const rot = (c.rotation * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const place = p => ({ id: p.id, x: c.x + p.x * cos - p.y * sin, y: c.y + p.x * sin + p.y * cos });
  const out = pts.map(place);
  const armLen = 26 / state.view.zoom;
  out.push(place({ id: 'rotate', x: 0, y: -hh - armLen }));
  if (c.type === 'joystick') {
    const r = travelRadius(c);
    out.push(place({ id: 'travel', x: r, y: 0 }));
  }
  return out;
}

function drawSelection(ctx) {
  const sel = selected();
  if (!sel.length) return;
  const z = state.view.zoom;

  for (const c of sel) {
    ctx.save();
    ctx.translate(c.x, c.y);
    if (c.rotation) ctx.rotate((c.rotation * Math.PI) / 180);

    // Hit area (what a game actually tests against).
    ctx.save();
    ctx.strokeStyle = 'rgba(109,140,255,.55)';
    ctx.lineWidth = 1 / z;
    ctx.setLineDash([5 / z, 4 / z]);
    if (hitShape(c) === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, hitRadius(c), 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const hw = (c.w / 2) * (c.hit.scale || 1);
      const hh = (c.h / 2) * (c.hit.scale || 1);
      ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
    }
    ctx.restore();

    // Joystick travel ring and dead zone.
    if (c.type === 'joystick') {
      const r = travelRadius(c);
      ctx.save();
      ctx.strokeStyle = 'rgba(89,217,192,.85)';
      ctx.lineWidth = 1.4 / z;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      if (c.stick.deadZone > 0) {
        ctx.strokeStyle = 'rgba(255,187,51,.7)';
        ctx.setLineDash([3 / z, 3 / z]);
        ctx.beginPath();
        ctx.arc(0, 0, r * c.stick.deadZone, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Bounding box.
    ctx.strokeStyle = '#59d9c0';
    ctx.lineWidth = 1.4 / z;
    ctx.strokeRect(-c.w / 2, -c.h / 2, c.w, c.h);
    ctx.restore();
  }

  // Handles only for a single selection, to keep multi-select readable.
  if (sel.length === 1) {
    const c = sel[0];
    if (c.locked) return;
    const hs = HANDLE / z;
    // Rotation arm.
    const hs2 = handlesFor(c);
    const rotHandle = hs2.find(h => h.id === 'rotate');
    if (rotHandle) {
      const rot = (c.rotation * Math.PI) / 180;
      const top = { x: c.x + (c.h / 2) * Math.sin(rot),
                    y: c.y - (c.h / 2) * Math.cos(rot) };
      ctx.save();
      ctx.strokeStyle = 'rgba(89,217,192,.6)';
      ctx.lineWidth = 1 / z;
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(rotHandle.x, rotHandle.y);
      ctx.stroke();
      ctx.restore();
    }
    for (const h of hs2) {
      ctx.save();
      ctx.fillStyle = h.id === 'travel' ? '#59d9c0' : h.id === 'rotate' ? '#6d8cff' : '#0e0f13';
      ctx.strokeStyle = h.id === 'travel' ? '#0e0f13' : '#59d9c0';
      ctx.lineWidth = 1.4 / z;
      ctx.beginPath();
      if (h.id === 'rotate' || h.id === 'travel') {
        ctx.arc(h.x, h.y, hs * 0.85, 0, Math.PI * 2);
      } else {
        ctx.rect(h.x - hs, h.y - hs, hs * 2, hs * 2);
      }
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Anchor tether: shows what the control's position is measured from.
    const ap = anchorPoint(c.anchor, state.doc.reference);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,187,51,.5)';
    ctx.fillStyle = 'rgba(255,187,51,.9)';
    ctx.lineWidth = 1 / z;
    ctx.setLineDash([3 / z, 3 / z]);
    ctx.beginPath();
    ctx.moveTo(ap.x, ap.y);
    ctx.lineTo(c.x, c.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(ap.x, ap.y, 3.5 / z, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawPlayHints(ctx, doc) {
  const z = state.view.zoom;
  const input = playInput();
  for (const c of doc.controls) {
    if (c.hidden) continue;
    const live = input.get(c.id);
    if (!live || !live.pressed) continue;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.strokeStyle = 'rgba(89,217,192,.9)';
    ctx.lineWidth = 2 / z;
    if (hitShape(c) === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, hitRadius(c), 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const hw = (c.w / 2) * (c.hit.scale || 1);
      const hh = (c.h / 2) * (c.hit.scale || 1);
      ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
    }
    ctx.restore();
  }
}

function updateStatus() {
  const sel = selected();
  const parts = [
    ['Screen', `${state.doc.reference.width}x${state.doc.reference.height}`],
    ['Zoom', Math.round(state.view.zoom * 100) + '%'],
    ['Cursor', `${Math.round(cursorRef.x)}, ${Math.round(cursorRef.y)}`],
  ];
  if (sel.length === 1) {
    const c = sel[0];
    parts.push(['Sel', `${c.id}  ${Math.round(c.x)}, ${Math.round(c.y)}  ${Math.round(c.w)}x${Math.round(c.h)}`]);
  } else if (sel.length > 1) {
    parts.push(['Sel', `${sel.length} controls`]);
  } else {
    parts.push(['Controls', state.doc.controls.length]);
  }
  setStatus(parts);
}

/* ── snapping ───────────────────────────────────────────────────────── */

function snapTargets(exclude) {
  const ref = state.doc.reference;
  const s = state.doc.safeArea;
  const v = [0, ref.width / 2, ref.width];
  const h = [0, ref.height / 2, ref.height];
  if (s) {
    if (s.left) v.push(s.left);
    if (s.right) v.push(ref.width - s.right);
    if (s.top) h.push(s.top);
    if (s.bottom) h.push(ref.height - s.bottom);
  }
  for (const c of state.doc.controls) {
    if (exclude.has(c.id) || c.hidden) continue;
    const b = boundsOf(c);
    v.push(c.x, b.x, b.x + b.w);
    h.push(c.y, b.y, b.y + b.h);
  }
  return { v, h };
}

/** Snap a moving control's centre, returning the snapped point + guides. */
function snapPoint(x, y, c, exclude) {
  if (!state.ui.snap) return { x, y, gv: [], gh: [] };
  const tol = SNAP_PX / state.view.zoom;
  const targets = snapTargets(exclude);
  const b = { hw: boundsOf(c).w / 2, hh: boundsOf(c).h / 2 };
  const gv = [];
  const gh = [];

  let bestX = null;
  for (const t of targets.v) {
    for (const [probe, shift] of [[x, 0], [x - b.hw, b.hw], [x + b.hw, -b.hw]]) {
      const d = Math.abs(probe - t);
      if (d <= tol && (!bestX || d < bestX.d)) bestX = { d, value: t + shift, guide: t };
    }
  }
  let bestY = null;
  for (const t of targets.h) {
    for (const [probe, shift] of [[y, 0], [y - b.hh, b.hh], [y + b.hh, -b.hh]]) {
      const d = Math.abs(probe - t);
      if (d <= tol && (!bestY || d < bestY.d)) bestY = { d, value: t + shift, guide: t };
    }
  }

  let outX = x;
  let outY = y;
  if (bestX) { outX = bestX.value; gv.push(bestX.guide); }
  else if (state.doc.grid.size) outX = Math.round(x / state.doc.grid.size) * state.doc.grid.size;
  if (bestY) { outY = bestY.value; gh.push(bestY.guide); }
  else if (state.doc.grid.size) outY = Math.round(y / state.doc.grid.size) * state.doc.grid.size;

  return { x: outX, y: outY, gv, gh };
}

/* ── hit testing ────────────────────────────────────────────────────── */

function controlAt(x, y) {
  const list = state.doc.controls;
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    if (c.hidden || c.locked) continue;
    if (hitTest(c, x, y)) return c;
  }
  return null;
}

function handleAt(x, y) {
  const sel = selected();
  if (sel.length !== 1 || sel[0].locked) return null;
  const tol = (HANDLE + 3) / state.view.zoom;
  for (const h of handlesFor(sel[0])) {
    if (Math.abs(x - h.x) <= tol && Math.abs(y - h.y) <= tol) return { ...h, control: sel[0] };
  }
  return null;
}

/* ── interaction ────────────────────────────────────────────────────── */

function onPointerDown(e) {
  if (state.ui.play) { playPointerDown(e, pointerRef(e)); requestDraw(); return; }
  canvas.setPointerCapture(e.pointerId);
  const p = pointerRef(e);

  if (e.button === 1 || spaceHeld || e.button === 2) {
    state.drag = { kind: 'pan', startX: e.clientX, startY: e.clientY, panX: state.view.panX, panY: state.view.panY };
    canvas.classList.add('is-panning');
    return;
  }
  if (e.button !== 0) return;

  const handle = handleAt(p.x, p.y);
  if (handle) {
    beginChange();
    state.drag = {
      kind: handle.id === 'rotate' ? 'rotate' : handle.id === 'travel' ? 'travel' : 'resize',
      handle: handle.id,
      id: handle.control.id,
      start: p,
      snapshot: structuredClone(handle.control),
      dirty: false,
    };
    return;
  }

  const hitControl = controlAt(p.x, p.y);
  if (hitControl) {
    if (e.shiftKey) {
      select(hitControl.id, { additive: true });
    } else if (!isSelected(hitControl.id)) {
      select(hitControl.id);
    }
    const moving = selected().filter(c => !c.locked);
    if (!moving.length) return;
    beginChange();
    state.drag = {
      kind: 'move',
      start: p,
      alt: e.altKey,
      dirty: false,
      items: moving.map(c => ({ id: c.id, x: c.x, y: c.y })),
      lead: hitControl.id,
    };
    return;
  }

  if (!e.shiftKey) select([]);
  marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, additive: e.shiftKey, base: state.selection.slice() };
  state.drag = { kind: 'marquee' };
}

function onPointerMove(e) {
  const p = pointerRef(e);
  cursorRef = p;

  if (state.ui.play) { playPointerMove(e, p); requestDraw(); return; }

  const d = state.drag;
  if (!d) { updateHoverCursor(p); requestDraw(); return; }

  if (d.kind === 'pan') {
    state.view.panX = d.panX + (e.clientX - d.startX);
    state.view.panY = d.panY + (e.clientY - d.startY);
    requestDraw();
    return;
  }

  if (d.kind === 'marquee') {
    marquee.x1 = p.x;
    marquee.y1 = p.y;
    const x0 = Math.min(marquee.x0, marquee.x1);
    const x1 = Math.max(marquee.x0, marquee.x1);
    const y0 = Math.min(marquee.y0, marquee.y1);
    const y1 = Math.max(marquee.y0, marquee.y1);
    const inside = state.doc.controls
      .filter(c => !c.hidden && !c.locked)
      .filter(c => {
        const b = boundsOf(c);
        return b.x + b.w >= x0 && b.x <= x1 && b.y + b.h >= y0 && b.y <= y1;
      })
      .map(c => c.id);
    state.selection = marquee.additive ? [...new Set([...marquee.base, ...inside])] : inside;
    emit('selection');
    return;
  }

  if (d.kind === 'move') {
    const lead = byId(d.lead);
    const item = d.items.find(i => i.id === d.lead) || d.items[0];
    let dx = p.x - d.start.x;
    let dy = p.y - d.start.y;
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }

    const exclude = new Set(d.items.map(i => i.id));
    const snapped = snapPoint(item.x + dx, item.y + dy, lead, exclude);
    dx = snapped.x - item.x;
    dy = snapped.y - item.y;
    guides = { v: snapped.gv, h: snapped.gh };

    for (const it of d.items) {
      const c = byId(it.id);
      if (!c) continue;
      c.x = round2(it.x + dx);
      c.y = round2(it.y + dy);
    }
    d.dirty = Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001;
    emit('drag');
    return;
  }

  const c = byId(d.id);
  if (!c) return;

  if (d.kind === 'resize') {
    const local = toLocal(c, p.x, p.y);
    const snap = d.snapshot;
    const aspect = snap.w / snap.h;
    let w = Math.abs(local.x) * 2;
    let h = Math.abs(local.y) * 2;
    if (!e.shiftKey) {
      // Keep the artwork's aspect ratio unless shift is held.
      if (w / aspect > h) h = w / aspect; else w = h * aspect;
    }
    if (state.ui.snap && state.doc.grid.size) {
      const g = state.doc.grid.size;
      w = Math.round(w / g) * g;
      if (!e.shiftKey) h = w / aspect; else h = Math.round(h / g) * g;
    }
    c.w = round2(Math.max(MIN_SIZE, w));
    c.h = round2(Math.max(MIN_SIZE, h));
    d.dirty = true;
    emit('drag');
    return;
  }

  if (d.kind === 'rotate') {
    const ang = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90;
    let deg = ang;
    if (!e.altKey) deg = Math.round(deg / 15) * 15;
    c.rotation = round2(((deg % 360) + 360) % 360 > 180 ? (deg % 360) - 360 : deg % 360);
    d.dirty = true;
    emit('drag');
    return;
  }

  if (d.kind === 'travel') {
    const local = toLocal(c, p.x, p.y);
    const dist = Math.hypot(local.x, local.y);
    c.stick.travel = round2(clamp(dist / (c.w / 2), 0.05, 1.2));
    d.dirty = true;
    emit('drag');
  }
}

function onPointerUp(e) {
  if (state.ui.play) { playPointerUp(e); requestDraw(); return; }
  const d = state.drag;
  state.drag = null;
  guides = { v: [], h: [] };
  canvas.classList.remove('is-panning');
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);

  if (d && d.kind === 'marquee') { marquee = null; emit('selection'); return; }
  if (!d || d.kind === 'pan') { requestDraw(); return; }

  if (!d.dirty) {
    abandonChange();
  } else if (d.kind === 'move') {
    // Re-anchor to whichever corner the control now sits nearest.
    for (const it of d.items) {
      const c = byId(it.id);
      if (c && !c.anchorLocked) c.anchor = nearestAnchor(c.x, c.y, state.doc.reference);
    }
  }
  emit('change');
}

function updateHoverCursor(p) {
  const handle = handleAt(p.x, p.y);
  if (handle) {
    canvas.style.cursor = handle.id === 'rotate' ? 'grab'
      : handle.id === 'travel' ? 'ew-resize'
      : handle.id === 'nw' || handle.id === 'se' ? 'nwse-resize' : 'nesw-resize';
    return;
  }
  canvas.style.cursor = spaceHeld ? 'grab' : controlAt(p.x, p.y) ? 'move' : 'default';
}

function onWheel(e) {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  const cx = e.clientX - r.left;
  const cy = e.clientY - r.top;
  if (e.ctrlKey || e.metaKey) {
    zoomBy(Math.exp(-e.deltaY * 0.01), cx, cy);
  } else if (e.shiftKey) {
    state.view.panX -= e.deltaY;
    requestDraw();
  } else {
    state.view.panX -= e.deltaX;
    state.view.panY -= e.deltaY;
    requestDraw();
  }
}

/* ── drops from the palette ─────────────────────────────────────────── */

function onDragOver(e) {
  if (e.dataTransfer.types.includes('text/sprite')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
}

function onDrop(e) {
  const payload = e.dataTransfer.getData('text/sprite');
  if (!payload) return;
  e.preventDefault();
  const p = pointerRef(e);
  const { name, kind } = JSON.parse(payload);
  const result = addSpriteAt(name, kind, p.x, p.y);
  if (result && result.error) toast(result.error, 'err');
  else if (result && result.swappedNub) toast('Stick nub swapped.');
}

/** Add a palette sprite at a point, as a control or as an icon on a control. */
export function addSpriteAt(name, kind, x, y) {
  const ref = state.doc.reference;
  if (kind === 'icon') {
    const target = controlAt(x, y) || selected()[0];
    if (!target) { return { error: 'Drop an icon onto a control to use it as its face.' }; }
    commit(() => {
      target.icon = { name, scale: target.type === 'joystick' ? 0.4 : 0.5, tint: '#ffffff', opacity: 1, rotation: 0, offsetX: 0, offsetY: 0 };
    }, 'icon');
    select(target.id);
    return { control: target };
  }

  // A nub dropped on a joystick swaps that joystick's stick.
  if (name.includes('_nub_')) {
    const under = controlAt(x, y);
    if (under && under.type === 'joystick') {
      commit(() => { under.stick.nub = name; }, 'nub');
      select(under.id);
      return { control: under, swappedNub: true };
    }
  }

  let created;
  commit(doc => {
    const c = makeControl(name, { x, y });
    c.anchor = nearestAnchor(x, y, ref);
    c.id = uniqueId(doc.controls, defaultIdFor(c, doc.controls));
    c.label = c.label || c.id;
    doc.controls.push(c);
    created = c;
  }, 'add');
  select(created.id);
  return { control: created };
}

function defaultIdFor(c, controls) {
  if (c.type === 'joystick') {
    const n = controls.filter(o => o.type === 'joystick').length;
    return n === 0 ? 'move' : n === 1 ? 'look' : 'stick';
  }
  if (c.type === 'dpad') return 'dpad';
  return 'button';
}

/* ── setup ──────────────────────────────────────────────────────────── */

export function initStage() {
  canvas = document.getElementById('stage');
  viewport = document.getElementById('viewport');
  ctx = canvas.getContext('2d');

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('dragover', onDragOver);
  canvas.addEventListener('drop', onDrop);

  window.addEventListener('keydown', e => {
    if (e.code === 'Space' && !isTyping(e)) { spaceHeld = true; canvas.style.cursor = 'grab'; }
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'Space') { spaceHeld = false; canvas.style.cursor = 'default'; }
  });
  window.addEventListener('blur', () => { spaceHeld = false; clearPlay(); });

  new ResizeObserver(resize).observe(viewport);
  onAssetLoad(requestDraw);
  // A freshly loaded document has not been framed yet; fit it rather than
  // leaving part of the screen outside the viewport.
  subscribe(reason => {
    if (reason === 'load' && !state.view.fitted) fitView();
    else requestDraw();
  });
  resize();
}

export const isTyping = e => {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

export const stageCanvas = () => canvas;
