/* What is on the screen, and what looks wrong with it.
 *
 * The items list is the one place that sees the whole layout at once, so it is
 * also where the checks worth running live: a control under a notch, two touch
 * areas a thumb could hit at once, an action name a game will never receive.
 *
 * Pure functions over a document — no DOM, no state. */

import { boundsOf, hitRadius, hitShape } from './model.js';
import { safeRect, screenRect } from './arrange.js';

/** The touch area as geometry, with rotation folded into a rectangle's extent. */
export function hitGeometry(c) {
  if (hitShape(c) === 'circle') {
    return { shape: 'circle', x: c.x, y: c.y, r: hitRadius(c) };
  }
  const scale = c.hit.scale || 1;
  const w = c.w * scale;
  const h = c.h * scale;
  const a = ((c.rotation || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(a));
  const sin = Math.abs(Math.sin(a));
  return { shape: 'rect', x: c.x, y: c.y, w: w * cos + h * sin, h: w * sin + h * cos };
}

const boxOf = g => (g.shape === 'circle'
  ? { x: g.x - g.r, y: g.y - g.r, w: g.r * 2, h: g.r * 2 }
  : { x: g.x - g.w / 2, y: g.y - g.h / 2, w: g.w, h: g.h });

/**
 * Do two controls' touch areas overlap? Circles are tested exactly; anything
 * else falls back to bounding boxes, which over-reports rather than under —
 * the safe direction for a warning.
 */
export function hitOverlap(a, b) {
  const ga = hitGeometry(a);
  const gb = hitGeometry(b);
  if (ga.shape === 'circle' && gb.shape === 'circle') {
    return Math.hypot(ga.x - gb.x, ga.y - gb.y) < ga.r + gb.r;
  }
  const A = boxOf(ga);
  const B = boxOf(gb);
  return A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h;
}

const EPS = 0.5;
const contains = (frame, b) =>
  b.x >= frame.x - EPS && b.y >= frame.y - EPS &&
  b.x + b.w <= frame.x + frame.w + EPS && b.y + b.h <= frame.y + frame.h + EPS;

/** Which sides of a frame a control pokes out of, for a readable message. */
function escapedSides(frame, b) {
  const sides = [];
  if (b.x < frame.x - EPS) sides.push('left');
  if (b.y < frame.y - EPS) sides.push('top');
  if (b.x + b.w > frame.x + frame.w + EPS) sides.push('right');
  if (b.y + b.h > frame.y + frame.h + EPS) sides.push('bottom');
  return sides;
}

/**
 * One entry per control, in document order, each with whatever is wrong.
 * @returns {Array<{control: object, index: number, issues: Array}>}
 */
export function analyse(doc) {
  const controls = doc.controls;
  const screen = screenRect(doc);
  const safe = safeRect(doc);
  const hasSafe = safe.w < screen.w - EPS || safe.h < screen.h - EPS;

  const actionUse = new Map();
  for (const c of controls) {
    if (c.action) actionUse.set(c.action, (actionUse.get(c.action) || 0) + 1);
  }

  return controls.map((control, index) => {
    const issues = [];
    const b = boundsOf(control);

    const off = escapedSides(screen, b);
    if (off.length) {
      issues.push({ code: 'offscreen', level: 'warn', text: `Off the ${off.join(' and ')} of the screen` });
    } else if (hasSafe && !contains(safe, b)) {
      const out = escapedSides(safe, b);
      issues.push({ code: 'unsafe', level: 'warn', text: `Outside the safe area (${out.join(', ')})` });
    }

    if (!control.hidden) {
      const clash = controls
        .filter(o => o !== control && !o.hidden && hitOverlap(control, o))
        .map(o => o.id);
      if (clash.length) {
        issues.push({ code: 'overlap', level: 'warn', text: `Touch area overlaps ${clash.join(', ')}` });
      }
    }

    if (!control.action) {
      issues.push({ code: 'noaction', level: 'info', text: 'No action name — exports as null' });
    } else if (actionUse.get(control.action) > 1) {
      issues.push({ code: 'dupaction', level: 'warn', text: `Action "${control.action}" is used more than once` });
    }

    return { control, index, issues };
  });
}

export const TYPE_NAMES = { joystick: 'stick', dpad: 'd-pad', button: 'button' };

/** Counts for the list header. */
export function summarize(items) {
  const byType = new Map();
  for (const it of items) {
    byType.set(it.control.type, (byType.get(it.control.type) || 0) + 1);
  }
  const warn = items.filter(i => i.issues.some(s => s.level === 'warn')).length;
  const parts = [...byType.entries()].map(([type, n]) => {
    const name = TYPE_NAMES[type] || type;
    return `${n} ${name}${n === 1 ? '' : 's'}`;
  });
  return { total: items.length, byType, warn, breakdown: parts.join(', ') };
}
