/* Test mode: real (multi-touch) input against the layout, so you can feel a
 * stick's travel and dead zone before shipping the JSON to a game. */

import { state } from './store.js';
import { hitTest, travelRadius } from './model.js';

/** pointerId -> { id, type, ... } */
const pointers = new Map();
/** controlId -> live input state */
const live = new Map();

export const playInput = () => live;

export function clearPlay() {
  pointers.clear();
  live.clear();
  renderReadout();
}

function topmostAt(x, y) {
  const list = state.doc.controls;
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    if (c.hidden) continue;
    if (hitTest(c, x, y)) return c;
  }
  return null;
}

/** Stick vector from a touch point, clamped to the travel ring. */
function stickVector(c, px, py, origin) {
  const r = travelRadius(c) || 1;
  let dx = (px - origin.x) / r;
  let dy = (py - origin.y) / r;
  const len = Math.hypot(dx, dy);
  if (len > 1) { dx /= len; dy /= len; }
  return { x: dx, y: dy };
}

/** Apply the dead zone and rescale so output still reaches 1.0 at the edge. */
function applyDeadZone(vec, dead) {
  const len = Math.hypot(vec.x, vec.y);
  if (len <= dead) return { x: 0, y: 0, magnitude: 0 };
  const scaled = (len - dead) / (1 - dead);
  const k = scaled / len;
  return { x: vec.x * k, y: vec.y * k, magnitude: scaled };
}

function dpadDirections(c, dx, dy) {
  const dirs = { north: false, south: false, east: false, west: false };
  const r = Math.min(c.w, c.h) / 2 || 1;
  const nx = dx / r;
  const ny = dy / r;
  const mag = Math.hypot(nx, ny);
  if (mag < (c.dpad.deadZone || 0)) return dirs;
  if (c.dpad.diagonals) {
    const t = 0.38;
    if (ny < -t * mag) dirs.north = true;
    if (ny > t * mag) dirs.south = true;
    if (nx > t * mag) dirs.east = true;
    if (nx < -t * mag) dirs.west = true;
  } else if (Math.abs(nx) > Math.abs(ny)) {
    if (nx > 0) dirs.east = true; else dirs.west = true;
  } else if (ny > 0) dirs.south = true; else dirs.north = true;
  return dirs;
}

export function playPointerDown(e, p) {
  const c = topmostAt(p.x, p.y);
  if (!c) return;
  e.target.setPointerCapture?.(e.pointerId);

  if (c.type === 'joystick') {
    const floating = c.stick.mode !== 'fixed';
    const origin = floating ? { x: p.x, y: p.y } : { x: c.x, y: c.y };
    pointers.set(e.pointerId, { id: c.id, type: 'joystick', origin });
    updateStick(c, p, origin);
  } else if (c.type === 'dpad') {
    pointers.set(e.pointerId, { id: c.id, type: 'dpad' });
    updateDpad(c, p);
  } else {
    pointers.set(e.pointerId, { id: c.id, type: 'button' });
    live.set(c.id, { pressed: true, value: 1 });
  }
  renderReadout();
}

export function playPointerMove(e, p) {
  const rec = pointers.get(e.pointerId);
  if (!rec) return;
  const c = state.doc.controls.find(x => x.id === rec.id);
  if (!c) return;
  if (rec.type === 'joystick') updateStick(c, p, rec.origin);
  else if (rec.type === 'dpad') updateDpad(c, p);
  renderReadout();
}

export function playPointerUp(e) {
  const rec = pointers.get(e.pointerId);
  if (!rec) return;
  pointers.delete(e.pointerId);

  // Another finger may still be holding this control.
  for (const other of pointers.values()) if (other.id === rec.id) { renderReadout(); return; }

  const c = state.doc.controls.find(x => x.id === rec.id);
  if (c && c.type === 'joystick' && c.stick.recenter === false) {
    const cur = live.get(c.id);
    if (cur) { cur.pressed = false; live.set(c.id, cur); }
  } else {
    live.delete(rec.id);
  }
  renderReadout();
}

function updateStick(c, p, origin) {
  const raw = stickVector(c, p.x, p.y, origin);
  const out = applyDeadZone(raw, c.stick.deadZone || 0);
  live.set(c.id, {
    pressed: true,
    vec: raw,                                   // where the nub is drawn
    value: { x: out.x, y: c.stick.invertY ? -out.y : out.y },   // what a game reads
    magnitude: out.magnitude,
    angle: out.magnitude ? (Math.atan2(out.y, out.x) * 180) / Math.PI : 0,
    padOffset: c.stick.mode === 'fixed' ? null : { x: origin.x - c.x, y: origin.y - c.y },
  });
}

function updateDpad(c, p) {
  const dirs = dpadDirections(c, p.x - c.x, p.y - c.y);
  const any = dirs.north || dirs.south || dirs.east || dirs.west;
  live.set(c.id, { pressed: any, dirs, vec: null });
}

/* ── readout ────────────────────────────────────────────────────────── */

let readoutEl = null;
const fmt = n => (n >= 0 ? ' ' : '') + n.toFixed(2);

export function renderReadout() {
  readoutEl = readoutEl || document.getElementById('readout');
  if (!readoutEl) return;
  readoutEl.innerHTML = '';

  const chips = [];
  for (const c of state.doc.controls) {
    const l = live.get(c.id);
    if (!l) continue;
    const name = c.action || c.id;
    if (c.type === 'joystick' && l.value) {
      chips.push(chip(`${name}  x${fmt(l.value.x)}  y${fmt(l.value.y)}`, 'axis on'));
    } else if (c.type === 'dpad' && l.dirs) {
      const on = Object.entries(l.dirs).filter(([, v]) => v).map(([k]) => k[0].toUpperCase());
      if (on.length) chips.push(chip(`${name}  ${on.join('+')}`, 'on'));
    } else if (l.pressed) {
      chips.push(chip(name, 'on'));
    }
  }

  if (!chips.length) {
    const idle = document.createElement('span');
    idle.className = 'idle';
    idle.textContent = 'Touch or click the controls — live input shows up here.';
    readoutEl.append(idle);
    return;
  }
  chips.forEach(n => readoutEl.append(n));
}

function chip(text, cls) {
  const n = document.createElement('span');
  n.className = 'chip ' + cls;
  n.textContent = text;
  return n;
}
