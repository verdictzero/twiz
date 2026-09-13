/* Align and distribute, measured against the selection, the whole screen, or
 * the safe area — the way a slide editor's arrange tools work.
 *
 * Every function here is pure geometry over an array of controls: it reads
 * `boundsOf` and writes `c.x` / `c.y`, nothing else. Undo, selection and
 * redrawing belong to the caller.
 */

import { boundsOf, round2 } from './model.js';

/** What positions are measured against. */
export const FRAMES = [
  { id: 'selection', name: 'Selection', note: 'the outermost controls stay put' },
  { id: 'screen', name: 'Screen', note: 'the full reference screen' },
  { id: 'safe', name: 'Safe area', note: 'inside the safe-area insets' },
];

export const ALIGNMENTS = ['left', 'centerX', 'right', 'top', 'centerY', 'bottom'];

/** Smallest rectangle containing every control, rotation included. */
export function unionBounds(controls) {
  if (!controls.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of controls) {
    const b = boundsOf(c);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function safeRect(doc) {
  const s = doc.safeArea || { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    x: s.left,
    y: s.top,
    w: doc.reference.width - s.left - s.right,
    h: doc.reference.height - s.top - s.bottom,
  };
}

export const screenRect = doc => ({ x: 0, y: 0, w: doc.reference.width, h: doc.reference.height });

/** The rectangle a given frame choice resolves to. */
export function frameRect(kind, doc, controls) {
  if (kind === 'screen') return screenRect(doc);
  if (kind === 'safe') return safeRect(doc);
  return unionBounds(controls);
}

/* ── align ──────────────────────────────────────────────────────────── */

/**
 * Move each control to one edge (or the middle) of `frame`.
 * @returns {boolean} whether anything could move
 */
export function align(controls, mode, frame) {
  if (!controls.length) return false;
  for (const c of controls) {
    const b = boundsOf(c);
    switch (mode) {
      case 'left':    c.x = round2(frame.x + b.w / 2); break;
      case 'right':   c.x = round2(frame.x + frame.w - b.w / 2); break;
      case 'centerX': c.x = round2(frame.x + frame.w / 2); break;
      case 'top':     c.y = round2(frame.y + b.h / 2); break;
      case 'bottom':  c.y = round2(frame.y + frame.h - b.h / 2); break;
      case 'centerY': c.y = round2(frame.y + frame.h / 2); break;
      default: return false;
    }
  }
  return true;
}

/* ── distribute ─────────────────────────────────────────────────────── */

const along = (axis, b) => (axis === 'x' ? b.x : b.y);
const sizeAlong = (axis, b) => (axis === 'x' ? b.w : b.h);

/** Controls sorted along an axis, each paired with its bounds. */
function ordered(controls, axis) {
  return controls
    .map(c => ({ c, b: boundsOf(c) }))
    .sort((p, q) => along(axis, p.b) - along(axis, q.b));
}

/** How many controls a distribute needs before it can do anything. */
export const minimumFor = edges => (edges ? 1 : 3);

/**
 * Even out the space between controls along one axis.
 *
 * With `edges` false the outermost controls stay where they are and only the
 * ones between them move — distributing within the selection. With `edges`
 * true the gap before the first and after the last counts too, so the run is
 * spread across the whole frame: that is what "space relative to the edges"
 * means, and with a single control it simply centres it.
 *
 * Gaps are measured between bounding boxes, not centres, so differently sized
 * controls end up with equal visual spacing.
 */
export function distribute(controls, axis, frame, edges) {
  if (controls.length < minimumFor(edges)) return false;
  const items = ordered(controls, axis);
  const used = items.reduce((sum, o) => sum + sizeAlong(axis, o.b), 0);
  const span = axis === 'x' ? frame.w : frame.h;
  const slots = edges ? items.length + 1 : items.length - 1;
  const gap = (span - used) / slots;

  let at = (axis === 'x' ? frame.x : frame.y) + (edges ? gap : 0);
  for (const o of items) {
    const size = sizeAlong(axis, o.b);
    place(o, axis, at + size / 2);
    at += size + gap;
  }
  return true;
}

/** Lay controls out with an exact gap, keeping the run where it already sits. */
export function setGap(controls, axis, gap, frame, edges) {
  if (controls.length < 2) return false;
  const items = ordered(controls, axis);
  const used = items.reduce((sum, o) => sum + sizeAlong(axis, o.b), 0);
  const runLength = used + gap * (items.length - 1);

  // Anchor on the frame when spacing against the screen, otherwise keep the
  // group's own centre so nothing jumps across the canvas.
  const frameStart = axis === 'x' ? frame.x : frame.y;
  const frameSpan = axis === 'x' ? frame.w : frame.h;
  const current = unionBounds(controls);
  const centre = edges
    ? frameStart + frameSpan / 2
    : along(axis, current) + sizeAlong(axis, current) / 2;

  let at = centre - runLength / 2;
  for (const o of items) {
    const size = sizeAlong(axis, o.b);
    place(o, axis, at + size / 2);
    at += size + gap;
  }
  return true;
}

function place(item, axis, centre) {
  const b = item.b;
  // `boundsOf` is centred on the control, so shifting the box shifts the control.
  const delta = centre - (along(axis, b) + sizeAlong(axis, b) / 2);
  if (axis === 'x') item.c.x = round2(item.c.x + delta);
  else item.c.y = round2(item.c.y + delta);
}

/* ── measurement ────────────────────────────────────────────────────── */

/**
 * The gaps between successive controls along an axis, plus the two edge gaps
 * when a frame is given. Used for the live readout, so you can see at a glance
 * whether spacing is even.
 */
export function gapsOf(controls, axis, frame = null) {
  const items = ordered(controls, axis);
  const gaps = [];
  if (frame) {
    gaps.push(along(axis, items[0].b) - (axis === 'x' ? frame.x : frame.y));
  }
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1].b;
    gaps.push(along(axis, items[i].b) - (along(axis, prev) + sizeAlong(axis, prev)));
  }
  if (frame) {
    const last = items[items.length - 1].b;
    const frameEnd = (axis === 'x' ? frame.x + frame.w : frame.y + frame.h);
    gaps.push(frameEnd - (along(axis, last) + sizeAlong(axis, last)));
  }
  return gaps.map(round2);
}

/**
 * A short summary of a set of gaps: "even, 24 px", a range, or a note that the
 * controls overlap along that axis — which is normal for, say, the vertical
 * gaps of a horizontal row, and should read as a fact rather than a negative
 * measurement.
 */
export function describeGaps(gaps) {
  if (!gaps.length) return null;
  const rounded = gaps.map(g => Math.round(g));
  const lo = Math.min(...rounded);
  const hi = Math.max(...rounded);
  if (hi <= 0) return 'overlapping';
  if (lo < 0) return `overlapping to ${hi} px`;
  if (hi - lo <= 1) return `even, ${lo} px`;
  return `${lo}–${hi} px`;
}

/** Which axis a set of controls is laid out along, for sensible defaults. */
export function dominantAxis(controls) {
  const u = unionBounds(controls);
  return u.w >= u.h ? 'x' : 'y';
}
