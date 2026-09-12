/* Draws a layout in reference space. The stage and every export path share
 * this one function, so what you see really is what you get. */

import { image, spritePath, pressedPath, iconPath, naturalSize, spriteInfo } from './assets.js';
import { nubSize, travelRadius } from './model.js';

/** Placement of the four arms of a composed D-pad, in control-local space. */
export function dpadElements(c) {
  const { elementScale, gap } = c.dpad;
  const size = Math.min(c.w, c.h) * elementScale;
  const dist = size / 2 + Math.min(c.w, c.h) * gap;
  return [
    { dir: 'north', sprite: 'dpad_element_north', x: 0, y: -dist, w: size, h: size },
    { dir: 'south', sprite: 'dpad_element_south', x: 0, y: dist, w: size, h: size },
    { dir: 'west', sprite: 'dpad_element_west', x: -dist, y: 0, w: size, h: size },
    { dir: 'east', sprite: 'dpad_element_east', x: dist, y: 0, w: size, h: size },
  ];
}

/** Nub centre offset for a joystick given its live input vector. */
export function nubOffset(c, vec) {
  if (!vec) return { x: 0, y: 0 };
  const r = travelRadius(c);
  return { x: vec.x * r, y: vec.y * r };
}

function drawSprite(ctx, path, cx, cy, w, h, tint) {
  const img = image(path, tint);
  if (!img) return false;
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  return true;
}

/** Placeholder while a sprite is still decoding, so nothing pops in blind. */
function drawPending(ctx, w, h) {
  ctx.save();
  ctx.strokeStyle = 'rgba(148,155,173,.35)';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.restore();
}

function drawIcon(ctx, c) {
  if (!c.icon || !c.icon.name) return;
  const nat = naturalSize(c.icon.name);
  const span = Math.min(c.w, c.h) * (c.icon.scale ?? 0.5);
  const w = span;
  const h = span * (nat.h / nat.w);
  const ox = (c.icon.offsetX || 0) * c.w;
  const oy = (c.icon.offsetY || 0) * c.h;
  ctx.save();
  ctx.globalAlpha *= c.icon.opacity ?? 1;
  if (c.icon.rotation) {
    ctx.translate(ox, oy);
    ctx.rotate((c.icon.rotation * Math.PI) / 180);
    ctx.translate(-ox, -oy);
  }
  drawSprite(ctx, iconPath(c.icon.name), ox, oy, w, h, c.icon.tint || null);
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx  already translated/scaled to reference space
 * @param {object} doc
 * @param {object} [opts]
 * @param {Map<string,object>} [opts.input] live input per control id
 * @param {boolean} [opts.background] paint the document background
 * @param {boolean} [opts.skipHidden] leave hidden controls out (export)
 */
export function drawLayout(ctx, doc, opts = {}) {
  const { input = null, background = true, skipHidden = true } = opts;
  const ref = doc.reference;

  if (background) drawBackground(ctx, doc, ref);

  for (const c of doc.controls) {
    if (c.hidden && skipHidden) continue;
    drawControl(ctx, c, doc, input ? input.get(c.id) : null);
  }
}

export function drawBackground(ctx, doc, ref) {
  const bg = doc.background || { mode: 'solid', color: '#14161c' };
  if (bg.mode === 'none') return;
  ctx.save();
  if (bg.mode === 'gradient') {
    const g = ctx.createLinearGradient(0, 0, 0, ref.height);
    g.addColorStop(0, bg.color || '#1a1d24');
    g.addColorStop(1, bg.color2 || '#0c0e13');
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = bg.color || '#14161c';
  }
  ctx.fillRect(0, 0, ref.width, ref.height);
  ctx.restore();
}

export function drawControl(ctx, c, doc, live) {
  const style = doc.style;
  const hlSet = doc.highlightSet;
  const pressed = !!(live && live.pressed);

  ctx.save();
  ctx.translate(c.x, c.y);
  if (c.rotation) ctx.rotate((c.rotation * Math.PI) / 180);
  ctx.globalAlpha = c.opacity ?? 1;

  if (c.type === 'joystick') {
    drawJoystick(ctx, c, style, hlSet, live, pressed);
  } else if (c.type === 'dpad' && c.dpad.layout === 'composed') {
    drawComposedDpad(ctx, c, style, hlSet, live);
  } else {
    const path = pressed ? (pressedPath(c.sprite, hlSet) || spritePath(c.sprite, style))
                         : spritePath(c.sprite, style);
    if (!drawSprite(ctx, path, 0, 0, c.w, c.h)) drawPending(ctx, c.w, c.h);
    drawIcon(ctx, c);
  }

  ctx.restore();
}

function drawJoystick(ctx, c, style, hlSet, live, pressed) {
  // A floating stick re-centres itself under the finger while it is held.
  const pad = (live && live.padOffset) || { x: 0, y: 0 };
  if (pad.x || pad.y) ctx.translate(pad.x, pad.y);

  // Which halves of the stick light up while it is held.
  const mode = c.stick.highlight || 'nub';
  const padLit = pressed && mode === 'both';
  const nubLit = pressed && mode !== 'none';

  const padPath = padLit ? (pressedPath(c.sprite, hlSet) || spritePath(c.sprite, style))
                         : spritePath(c.sprite, style);
  if (!drawSprite(ctx, padPath, 0, 0, c.w, c.h)) drawPending(ctx, c.w, c.h);

  const { w: nw, h: nh } = nubSize(c);
  const off = nubOffset(c, live ? live.vec : null);
  const nubPath = nubLit ? (pressedPath(c.stick.nub, hlSet) || spritePath(c.stick.nub, style))
                         : spritePath(c.stick.nub, style);
  if (!drawSprite(ctx, nubPath, off.x, off.y, nw, nh)) drawPending(ctx, nw, nh);

  if (c.icon && c.icon.name) {
    ctx.save();
    ctx.translate(off.x, off.y);
    drawIcon(ctx, c);
    ctx.restore();
  }
}

function drawComposedDpad(ctx, c, style, hlSet, live) {
  const active = live && live.dirs ? live.dirs : null;
  for (const el of dpadElements(c)) {
    const on = active && active[el.dir];
    const path = on ? (pressedPath(el.sprite, hlSet) || spritePath(el.sprite, style))
                    : spritePath(el.sprite, style);
    if (!drawSprite(ctx, path, el.x, el.y, el.w, el.h)) {
      ctx.save(); ctx.translate(el.x, el.y); drawPending(ctx, el.w, el.h); ctx.restore();
    }
  }
}

/** Every sprite file a document references — used by exports and preloading. */
export function usedSprites(doc) {
  const out = new Set();
  for (const c of doc.controls) {
    if (c.type === 'dpad' && c.dpad.layout === 'composed') {
      dpadElements(c).forEach(el => out.add(el.sprite));
    } else {
      out.add(c.sprite);
    }
    if (c.type === 'joystick') out.add(c.stick.nub);
  }
  return [...out];
}

export function usedIcons(doc) {
  const out = new Set();
  for (const c of doc.controls) if (c.icon && c.icon.name) out.add(c.icon.name);
  return [...out];
}

/** Human-readable kind label, used in the layers list and inspector. */
export function kindLabel(c) {
  if (c.type === 'joystick') return 'Joystick';
  if (c.type === 'dpad') return 'D-Pad';
  const info = spriteInfo(c.sprite);
  return info && info.group === 'direction' ? 'Direction' : 'Button';
}
