/* The layout document: what a control is, where it sits, and how it
 * survives a change of screen size. */

import { naturalSize, spriteInfo, spritesOf, styleInfo } from './assets.js';

export const SCHEMA = 'kenney-touch-layout';
export const SCHEMA_VERSION = 1;

export const ANCHORS = [
  'top-left',    'top-center',    'top-right',
  'center-left', 'center',        'center-right',
  'bottom-left', 'bottom-center', 'bottom-right',
];

/** Where an anchor sits inside a reference screen. */
export function anchorPoint(anchor, ref) {
  const [v, h] = String(anchor).split('-');
  const x = h === 'left' ? 0 : h === 'right' ? ref.width : ref.width / 2;
  const y = v === 'top' ? 0 : v === 'bottom' ? ref.height : ref.height / 2;
  return { x, y };
}

/** Offset from the control's anchor to its centre — the resolution-independent
 *  part of a position, and what a game should actually lay out from. */
export function anchorOffset(c, ref) {
  const a = anchorPoint(c.anchor, ref);
  return { x: round2(c.x - a.x), y: round2(c.y - a.y) };
}

/** Nearest anchor for a point — used when a control is dragged around. */
export function nearestAnchor(x, y, ref) {
  const h = x < ref.width / 3 ? 'left' : x > (ref.width * 2) / 3 ? 'right' : 'center';
  const v = y < ref.height / 3 ? 'top' : y > (ref.height * 2) / 3 ? 'bottom' : 'center';
  if (v === 'center' && h === 'center') return 'center';
  return v + '-' + h;
}

export const round2 = n => Math.round(n * 100) / 100;
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/* ── control creation ───────────────────────────────────────────────── */

/** Which control type a palette sprite becomes when dropped on the stage. */
export function typeForSprite(name) {
  const info = spriteInfo(name);
  if (!info) return 'button';
  if (info.group === 'joystick_pad') return 'joystick';
  if (info.group === 'dpad') return 'dpad';
  return 'button';
}

/** Pick the nub that matches a pad's shape (circle pad -> circle nub). */
export function matchingNub(padName) {
  const pad = spriteInfo(padName);
  const nubs = spritesOf('joystick_nub');
  if (!pad) return nubs[0].name;
  const sameShape = nubs.filter(n => n.shape === pad.shape);
  const pool = sameShape.length ? sameShape : nubs;
  return (pool.find(n => n.variant === pad.variant) || pool[0]).name;
}

export function uniqueId(controls, base) {
  const taken = new Set(controls.map(c => c.id));
  const slug = String(base).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'control';
  if (!taken.has(slug)) return slug;
  let n = 2;
  while (taken.has(slug + '_' + n)) n++;
  return slug + '_' + n;
}

const NICE_NAME = { joystick: 'Stick', dpad: 'D-Pad', button: 'Button' };

export function makeControl(spriteName, opts = {}) {
  const type = opts.type || typeForSprite(spriteName);
  const nat = naturalSize(spriteName);
  const scale = opts.scale ?? (type === 'joystick' ? 1.25 : 1);
  const c = {
    id: opts.id || 'control',
    label: opts.label || NICE_NAME[type],
    type,
    action: opts.action || '',
    sprite: spriteName,
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    w: round2(nat.w * scale),
    h: round2(nat.h * scale),
    rotation: 0,
    opacity: 1,
    anchor: opts.anchor || 'center',
    locked: false,
    hidden: false,
    icon: null,
    hit: { shape: 'auto', scale: 1 },
  };

  if (type === 'joystick') {
    const nub = opts.nub || matchingNub(spriteName);
    const nubNat = naturalSize(nub);
    c.stick = {
      nub,
      nubScale: round2(nubNat.w / nat.w),   // nub width as a fraction of the pad
      travel: 0.45,                          // fraction of the pad's half-width
      deadZone: 0.15,
      mode: 'fixed',                         // fixed | floating
      recenter: true,
      invertY: false,
      highlight: 'nub',                      // nub | both | none
      axisX: '', axisY: '',
    };
  } else if (type === 'dpad') {
    c.dpad = {
      layout: 'unified',                     // unified | composed
      gap: 0.06,                             // composed only: fraction of size
      elementScale: 0.5,                     // composed only: element size vs. whole
      diagonals: true,
      deadZone: 0.25,
      actions: { north: '', south: '', east: '', west: '' },
    };
  }
  return c;
}

/* ── geometry ───────────────────────────────────────────────────────── */

export const rectOf = c => ({ x: c.x - c.w / 2, y: c.y - c.h / 2, w: c.w, h: c.h });

/** Size of a joystick nub in reference pixels. */
export const nubSize = c => {
  const nat = naturalSize(c.stick.nub);
  const w = c.w * c.stick.nubScale;
  return { w, h: w * (nat.h / nat.w) };
};

/** How far the nub may travel from the centre, in reference pixels. */
export const travelRadius = c => (c.w / 2) * c.stick.travel;

/** Touch radius — what a game should test against, not the artwork bounds. */
export function hitRadius(c) {
  return (Math.max(c.w, c.h) / 2) * (c.hit.scale || 1);
}

export function hitShape(c) {
  if (c.hit.shape !== 'auto') return c.hit.shape;
  if (c.type === 'joystick') return 'circle';
  const info = spriteInfo(c.sprite);
  if (!info) return 'rect';
  if (info.group === 'dpad') return 'rect';
  return Math.abs(c.w - c.h) < 1 ? 'circle' : 'rect';
}

/** World point -> control-local point (origin at the control centre). */
export function toLocal(c, px, py) {
  const dx = px - c.x;
  const dy = py - c.y;
  if (!c.rotation) return { x: dx, y: dy };
  const a = (-c.rotation * Math.PI) / 180;
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
}

/** Point-in-control test, in reference space, honouring rotation. */
export function hitTest(c, px, py) {
  const local = toLocal(c, px, py);
  if (hitShape(c) === 'circle') {
    const r = hitRadius(c);
    return local.x * local.x + local.y * local.y <= r * r;
  }
  const hw = (c.w / 2) * (c.hit.scale || 1);
  const hh = (c.h / 2) * (c.hit.scale || 1);
  return Math.abs(local.x) <= hw && Math.abs(local.y) <= hh;
}

/** Axis-aligned bounds of a (possibly rotated) control. */
export function boundsOf(c) {
  const { w, h } = c;
  if (!c.rotation) return { x: c.x - w / 2, y: c.y - h / 2, w, h };
  const a = (c.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(a));
  const sin = Math.abs(Math.sin(a));
  const bw = w * cos + h * sin;
  const bh = w * sin + h * cos;
  return { x: c.x - bw / 2, y: c.y - bh / 2, w: bw, h: bh };
}

/* ── document ───────────────────────────────────────────────────────── */

/* Kenney's dark styles vanish on a dark backdrop and the light ones vanish on a
 * pale one, so the preview backdrop follows the style until you pick your own. */
export function backdropFor(styleId) {
  return styleInfo(styleId).dark
    ? { mode: 'gradient', color: '#6b7487', color2: '#39404f', auto: true }
    : { mode: 'gradient', color: '#1a1d24', color2: '#0c0e13', auto: true };
}

export function makeDoc(over = {}) {
  return {
    name: 'Untitled layout',
    style: 'a',
    highlightSet: 'a',
    reference: { width: 1280, height: 720, device: 'Generic 16:9', orientation: 'landscape' },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    background: backdropFor(over.style || 'a'),
    grid: { size: 16, snap: true },
    controls: [],
    ...over,
  };
}

/** Move every control so its anchor-relative offset survives a resize. */
export function reanchor(doc, oldRef, newRef) {
  for (const c of doc.controls) {
    const off = anchorOffset(c, oldRef);
    const a = anchorPoint(c.anchor, newRef);
    c.x = round2(a.x + off.x);
    c.y = round2(a.y + off.y);
  }
}

/**
 * Retarget a document at a different screen, keeping every control at the same
 * offset from its anchor. Pass `safe` to replace the safe-area insets too.
 */
export function setReference(doc, next) {
  reanchor(doc, doc.reference, next);
  doc.reference = {
    width: next.width,
    height: next.height,
    orientation: next.orientation || (next.width >= next.height ? 'landscape' : 'portrait'),
    device: next.device ?? doc.reference.device,
    deviceId: next.deviceId ?? doc.reference.deviceId,
  };
  if (next.safe) doc.safeArea = { ...next.safe };
}

const FLIP_H = { left: 'right', right: 'left', center: 'center' };

/** Horizontally mirrored copy of a control, with a sensible new id. */
export function mirrorControl(c, ref, controls) {
  const copy = structuredClone(c);
  copy.x = round2(ref.width - c.x);
  copy.rotation = c.rotation ? round2(-c.rotation) : 0;
  const [v, h] = c.anchor.split('-');
  copy.anchor = h ? v + '-' + FLIP_H[h] : c.anchor;
  const base = c.id.replace(/_(l|left|r|right)$/i, '');
  const side = /(_l|_left)$/i.test(c.id) ? '_right' : /(_r|_right)$/i.test(c.id) ? '_left' : '_mirror';
  copy.id = uniqueId(controls, base + side);
  return copy;
}

export const cloneDoc = doc => structuredClone(doc);
