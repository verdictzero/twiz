/* Application state: the document, the selection, view transform and undo
 * history. Everything mutating the document goes through `commit()` so undo
 * and re-render stay in lockstep. */

import { makeDoc, cloneDoc } from './model.js';

const LIMIT = 120;

export const state = {
  doc: makeDoc(),
  selection: [],           // control ids
  view: { zoom: 1, panX: 0, panY: 0, fitted: false },
  ui: {
    tool: 'select',
    showGrid: true,
    snap: true,
    showSafe: true,
    showCenterLine: false,
    play: false,
    paletteTab: 'controls',
    inspectorTab: 'props',
    itemSearch: '',
    itemIssuesOnly: false,
    search: '',
  },
  drag: null,              // live interaction bookkeeping (never in history)
};

const past = [];
const future = [];
const subs = new Set();

export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }

let frame = 0;
export function emit(reason = 'change') {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    subs.forEach(fn => fn(reason));
  });
}
/* ── history ────────────────────────────────────────────────────────── */

/** Snapshot the document before a mutation. Call once per user action. */
export function beginChange() {
  past.push(cloneDoc(state.doc));
  if (past.length > LIMIT) past.shift();
  future.length = 0;
}

/** Mutate through a callback: snapshot, apply, notify. */
export function commit(mutate, reason = 'change') {
  beginChange();
  mutate(state.doc);
  emit(reason);
}

/** Drop the snapshot taken by `beginChange()` when nothing actually moved. */
export function abandonChange() {
  past.pop();
}

export function undo() {
  if (!past.length) return false;
  future.push(cloneDoc(state.doc));
  state.doc = past.pop();
  pruneSelection();
  emit('history');
  return true;
}

export function redo() {
  if (!future.length) return false;
  past.push(cloneDoc(state.doc));
  state.doc = future.pop();
  pruneSelection();
  emit('history');
  return true;
}

export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;

export function resetHistory() { past.length = 0; future.length = 0; }

/** Replace the whole document (new / import / example). */
export function loadDoc(doc, { keepHistory = false } = {}) {
  if (keepHistory) beginChange(); else resetHistory();
  state.doc = doc;
  state.selection = [];
  state.view.fitted = false;
  emit('load');
}

/* ── selection ──────────────────────────────────────────────────────── */

export const controls = () => state.doc.controls;
export const byId = id => state.doc.controls.find(c => c.id === id) || null;
export const selected = () => state.selection.map(byId).filter(Boolean);
export const primary = () => (state.selection.length ? byId(state.selection[state.selection.length - 1]) : null);
export const isSelected = id => state.selection.includes(id);

export function select(ids, { additive = false } = {}) {
  const list = Array.isArray(ids) ? ids : ids == null ? [] : [ids];
  if (additive) {
    const next = state.selection.slice();
    for (const id of list) {
      const at = next.indexOf(id);
      if (at >= 0) next.splice(at, 1); else next.push(id);
    }
    state.selection = next;
  } else {
    state.selection = list;
  }
  emit('selection');
}

function pruneSelection() {
  const live = new Set(state.doc.controls.map(c => c.id));
  state.selection = state.selection.filter(id => live.has(id));
}

export function setUI(patch) {
  Object.assign(state.ui, patch);
  emit('ui');
}
