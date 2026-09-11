/* Wiring: toolbar, keyboard, persistence, exports. */

import { STYLES, HIGHLIGHT_SETS, preloadStyle } from './assets.js';
import {
  state, subscribe, commit, loadDoc, undo, redo, canUndo, canRedo,
  select, selected, setUI,
} from './store.js';
import { makeDoc, uniqueId, round2, backdropFor, setReference } from './model.js';
import { DEVICES, referenceFor } from './devices.js';
import { initStage, fitView, zoomBy, setZoom, requestDraw, isTyping } from './stage.js';
import { initPalette, renderPalette } from './palette.js';
import {
  initInspector, renderInspector, duplicateSelection, mirrorSelection,
  deleteSelection, reorderSelection, alignTo,
} from './inspector.js';
import { serialize, deserialize, toJSON, toPNG, toSVG, toBundle, slugify } from './export.js';
import { renderReadout, clearPlay } from './play.js';
import { EXAMPLES, buildExample } from './examples.js';
import { $, $$, el, toast, download, copyText } from './ui.js';

const STORAGE_KEY = 'touch-layout-studio:doc';

/* ═══════════════════════ boot ═══════════════════════ */

function boot() {
  populateSelects();
  initStage();
  initPalette();
  initInspector();
  bindToolbar();
  bindMenus();
  bindKeyboard();
  bindClipboard();

  loadDoc(restore() || buildExample('platformer'));
  preloadStyle(state.doc.style);
  fitView();

  subscribe(onStateChange);
  renderReadout();
  syncChrome();
  $('#stage-empty').hidden = state.doc.controls.length > 0;
}

function populateSelects() {
  const style = $('#sel-style');
  STYLES.forEach(s => style.append(el('option', { value: s.id, text: `${s.name}` })));

  const hl = $('#sel-highlight');
  HIGHLIGHT_SETS.forEach(h => hl.append(el('option', { value: h.id, text: h.name })));

  const dev = $('#sel-device');
  DEVICES.forEach(d => dev.append(el('option', { value: d.id, text: `${d.name} · ${d.w}x${d.h}` })));
}

/* ═══════════════════════ reactions ═══════════════════════ */

let lastStyle = null;
let lastCount = -1;

function onStateChange(reason) {
  if (reason === 'edit' || reason === 'drag' || reason === 'view') {
    if (reason === 'view') syncZoomLabel();
    return;
  }

  renderInspector();
  if (state.doc.style !== lastStyle) {
    lastStyle = state.doc.style;
    renderPalette();
    preloadStyle(state.doc.style);
  }
  syncChrome();
  save();

  const count = state.doc.controls.length;
  if (count !== lastCount) {
    lastCount = count;
    $('#stage-empty').hidden = count > 0;
  }
}

/** Push document state back into the chrome that lives outside the panels. */
function syncChrome() {
  $('#sel-style').value = state.doc.style;
  $('#sel-highlight').value = state.doc.highlightSet;
  $('#sel-device').value = state.doc.reference.deviceId || 'generic-16-9';
  $('#btn-undo').disabled = !canUndo();
  $('#btn-redo').disabled = !canRedo();
  $('#btn-grid').setAttribute('aria-pressed', String(state.ui.showGrid));
  $('#btn-snap').setAttribute('aria-pressed', String(state.ui.snap));
  $('#btn-safe').setAttribute('aria-pressed', String(state.ui.showSafe));
  $('#btn-mirror-guide').setAttribute('aria-pressed', String(state.ui.showCenterLine));
  document.title = `${state.doc.name} — Touch Layout Studio`;
  syncZoomLabel();
}

const syncZoomLabel = () => { $('#btn-zoom-fit').textContent = Math.round(state.view.zoom * 100) + '%'; };

/* ═══════════════════════ toolbar ═══════════════════════ */

function bindToolbar() {
  $('#btn-new').onclick = () => {
    if (state.doc.controls.length && !confirm('Start a new, empty layout? The current one will be replaced.')) return;
    loadDoc(makeDoc());
    fitView();
    toast('New layout.');
  };

  $('#btn-import').onclick = () => $('#file-import').click();
  $('#file-import').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const doc = deserialize(await file.text());
      loadDoc(doc);
      fitView();
      toast(`Loaded "${doc.name}" — ${doc.controls.length} controls.`, 'ok');
    } catch (err) {
      toast(`Could not read that file: ${err.message}`, 'err');
    }
    e.target.value = '';
  };

  $('#sel-style').onchange = e => commit(doc => {
    doc.style = e.target.value;
    // Keep the preview readable unless the user chose their own backdrop.
    if (doc.background.auto !== false) doc.background = backdropFor(doc.style);
  }, 'style');
  $('#sel-highlight').onchange = e => commit(doc => { doc.highlightSet = e.target.value; }, 'style');
  $('#sel-device').onchange = e => applyDevice(e.target.value, state.doc.reference.orientation);
  $('#btn-orient').onclick = () => applyDevice(
    state.doc.reference.deviceId || 'generic-16-9',
    state.doc.reference.orientation === 'portrait' ? 'landscape' : 'portrait',
  );

  $('#btn-undo').onclick = () => undo();
  $('#btn-redo').onclick = () => redo();

  $('#btn-zoom-in').onclick = () => zoomBy(1.2, viewportCentre().x, viewportCentre().y);
  $('#btn-zoom-out').onclick = () => zoomBy(1 / 1.2, viewportCentre().x, viewportCentre().y);
  $('#btn-zoom-fit').onclick = () => fitView();

  $('#btn-grid').onclick = () => setUI({ showGrid: !state.ui.showGrid });
  $('#btn-snap').onclick = () => setUI({ snap: !state.ui.snap });
  $('#btn-safe').onclick = () => setUI({ showSafe: !state.ui.showSafe });
  $('#btn-mirror-guide').onclick = () => setUI({ showCenterLine: !state.ui.showCenterLine });

  $('#seg-arrange').addEventListener('click', e => {
    const btn = e.target instanceof Element ? e.target.closest('[data-arrange]') : null;
    if (!btn) return;
    const sel = selected();
    switch (btn.dataset.arrange) {
      case 'mirror': mirrorSelection(); break;
      case 'align-h': alignTo(sel, 'centerX'); break;
      case 'align-v': alignTo(sel, 'centerY'); break;
      case 'front': reorderSelection('front'); break;
      case 'back': reorderSelection('back'); break;
    }
  });

  $('#btn-play').onclick = () => togglePlay();
  $('#btn-play-exit').onclick = () => togglePlay(false);

  bindDrawers();
}

/* On narrow screens the two panels slide in over the stage. */
function bindDrawers() {
  const pairs = [['#btn-panel-left', '#panel-left'], ['#btn-panel-right', '#panel-right']];
  for (const [btnSel, panelSel] of pairs) {
    $(btnSel).onclick = e => {
      e.stopPropagation();
      const panel = $(panelSel);
      const open = !panel.classList.contains('is-open');
      $$('.panel').forEach(p => p.classList.remove('is-open'));
      panel.classList.toggle('is-open', open);
      $(btnSel).setAttribute('aria-expanded', String(open));
    };
  }
  // Touching the stage puts the drawers away again.
  $('#viewport').addEventListener('pointerdown', () => {
    if (!$$('.panel.is-open').length) return;
    $$('.panel').forEach(p => p.classList.remove('is-open'));
    $$('.panel-toggle').forEach(b => b.setAttribute('aria-expanded', 'false'));
  }, true);
}

const viewportCentre = () => {
  const vp = $('#viewport');
  return { x: vp.clientWidth / 2, y: vp.clientHeight / 2 };
};

function applyDevice(deviceId, orientation) {
  // Controls keep their offset from their anchor, so the layout survives the swap.
  commit(doc => setReference(doc, referenceFor(deviceId, orientation)), 'device');
  fitView();
}

function togglePlay(force) {
  const on = force == null ? !state.ui.play : force;
  setUI({ play: on });
  clearPlay();
  $('#playbar').hidden = !on;
  $('#stage').classList.toggle('is-play', on);
  $('#btn-play').classList.toggle('primary', !on);
  $('#btn-play').classList.toggle('accent', on);
  $('#btn-play').querySelector('span').textContent = on ? 'Back to editing' : 'Test';
  if (on) select([]);
  renderReadout();
  requestDraw();
}

/* ═══════════════════════ menus ═══════════════════════ */

function bindMenus() {
  const exampleMenu = $('#menu-examples');
  EXAMPLES.forEach(ex => {
    exampleMenu.append(el('button', {
      type: 'button',
      onclick: () => {
        loadDoc(buildExample(ex.id));
        fitView();
        closeMenus();
        toast(`Loaded the "${ex.name}" example.`);
      },
    }, [el('b', { text: ex.name }), el('small', { text: ex.note })]));
  });

  setupMenu($('#btn-examples'), exampleMenu);
  setupMenu($('#btn-export'), $('#menu-export'));

  $('#menu-export').addEventListener('click', e => {
    const btn = e.target instanceof Element ? e.target.closest('[data-export]') : null;
    if (!btn) return;
    closeMenus();
    runExport(btn.dataset.export);
  });

  document.addEventListener('click', e => {
    // `target` is not always an Element (synthetic events, text nodes).
    const node = e.target instanceof Element ? e.target : null;
    if (!node || !node.closest('.menu-wrap')) closeMenus();
  });

  $('#dlg-json-copy').onclick = async () => {
    const ok = await copyText($('#dlg-json-text').value);
    toast(ok ? 'JSON copied to the clipboard.' : 'Could not reach the clipboard — select the text instead.', ok ? 'ok' : 'err');
  };
  $('#dlg-json-download').onclick = () => {
    download(new Blob([$('#dlg-json-text').value], { type: 'application/json' }), `${slugify(state.doc.name)}.json`);
  };
}

function setupMenu(button, menu) {
  button.addEventListener('click', e => {
    e.stopPropagation();
    const open = menu.hidden;
    closeMenus();
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  });
}

function closeMenus() {
  $$('.menu').forEach(m => { m.hidden = true; });
  $$('[aria-haspopup]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}

/* ═══════════════════════ exports ═══════════════════════ */

async function runExport(kind) {
  const doc = state.doc;
  const slug = slugify(doc.name);
  try {
    switch (kind) {
      case 'json': {
        const text = toJSON(doc);
        download(new Blob([text], { type: 'application/json' }), `${slug}.json`);
        showJSON(text, `${doc.name} — layout.json`);
        break;
      }
      case 'clipboard': {
        const ok = await copyText(toJSON(doc));
        toast(ok ? 'Layout JSON copied.' : 'Clipboard blocked — opening the JSON instead.', ok ? 'ok' : 'err');
        if (!ok) showJSON(toJSON(doc), `${doc.name} — layout.json`);
        break;
      }
      case 'png1': await savePNG(doc, 1, true, `${slug}.png`); break;
      case 'png2': await savePNG(doc, 2, true, `${slug}@2x.png`); break;
      case 'png-transparent': await savePNG(doc, 2, false, `${slug}-transparent@2x.png`); break;
      case 'svg': {
        const svg = await toSVG(doc);
        download(new Blob([svg], { type: 'image/svg+xml' }), `${slug}.svg`);
        toast('SVG exported.', 'ok');
        break;
      }
      case 'bundle': {
        toast('Packing the bundle…');
        const { blob, filename, fileCount } = await toBundle(doc);
        download(blob, filename);
        toast(`Bundle exported — ${fileCount} files.`, 'ok');
        break;
      }
    }
  } catch (err) {
    console.error(err);
    toast(`Export failed: ${err.message}`, 'err');
  }
}

async function savePNG(doc, scale, background, filename) {
  const blob = await toPNG(doc, { scale, background });
  download(blob, filename);
  toast(`PNG exported at ${doc.reference.width * scale}x${doc.reference.height * scale}.`, 'ok');
}

function showJSON(text, title) {
  $('#dlg-json-title').textContent = title;
  $('#dlg-json-text').value = text;
  $('#dlg-json').showModal();
}

/* ═══════════════════════ keyboard ═══════════════════════ */

function bindKeyboard() {
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $$('.menu').some(m => !m.hidden)) { closeMenus(); return; }
    if (isTyping(e)) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); return; }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      select(state.doc.controls.filter(c => !c.locked).map(c => c.id));
      return;
    }
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      runExport('json');
      return;
    }

    switch (e.key) {
      case 'Delete': case 'Backspace':
        e.preventDefault(); deleteSelection(); return;
      case 'Escape':
        if ($$('.menu').some(m => !m.hidden)) closeMenus();
        else if (state.ui.play) togglePlay(false);
        else select([]);
        return;
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
        const sel = selected().filter(c => !c.locked);
        if (!sel.length) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        commit(() => sel.forEach(c => { c.x = round2(c.x + dx); c.y = round2(c.y + dy); }), 'nudge');
        return;
      }
      case '[': reorderSelection('back'); return;
      case ']': reorderSelection('front'); return;
      case '0': fitView(); return;
      case '1': setZoom(1); return;
    }

    switch (e.key.toLowerCase()) {
      case 'g': setUI({ showGrid: !state.ui.showGrid }); break;
      case 's': setUI({ snap: !state.ui.snap }); break;
      case 'a': setUI({ showSafe: !state.ui.showSafe }); break;
      case 'c': setUI({ showCenterLine: !state.ui.showCenterLine }); break;
      case 'm': mirrorSelection(); break;
      case 'p': togglePlay(); break;
    }
  });
}

/* ═══════════════════════ clipboard ═══════════════════════ */

let clipboard = null;

function bindClipboard() {
  window.addEventListener('copy', e => {
    if (isTyping(e) || !state.selection.length) return;
    clipboard = selected().map(c => structuredClone(c));
    e.preventDefault();
    e.clipboardData.setData('text/plain', JSON.stringify(clipboard, null, 2));
    toast(`Copied ${clipboard.length} control${clipboard.length > 1 ? 's' : ''}.`);
  });

  window.addEventListener('paste', e => {
    if (isTyping(e)) return;
    let items = clipboard;
    const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    if (text) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed) && parsed.every(c => c && c.sprite)) items = parsed;
      } catch { /* not ours — fall back to the internal clipboard */ }
    }
    if (!items || !items.length) return;
    e.preventDefault();
    const made = [];
    commit(doc => {
      for (const src of items) {
        const copy = structuredClone(src);
        copy.id = uniqueId(doc.controls.concat(made), src.id);
        copy.x = round2(src.x + 28);
        copy.y = round2(src.y + 28);
        doc.controls.push(copy);
        made.push(copy);
      }
    }, 'paste');
    select(made.map(c => c.id));
  });
}

/* ═══════════════════════ persistence ═══════════════════════ */

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize(state.doc)));
    } catch { /* private mode, quota — the editor still works */ }
  }, 400);
}

function restore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const doc = deserialize(raw);
    return doc.controls.length ? doc : null;
  } catch {
    return null;
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
