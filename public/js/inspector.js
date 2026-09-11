/* The right-hand panel: properties of the selection, the layer list and
 * screen-wide settings. */

import {
  ICONS, spritePath, iconPath, spritesOf, spriteInfo, styleInfo, naturalSize,
} from './assets.js';
import {
  state, commit, beginChange, abandonChange, emit, select, selected,
} from './store.js';
import {
  ANCHORS, anchorOffset, boundsOf, hitRadius, hitShape, nubSize,
  travelRadius, round2, clamp, uniqueId, mirrorControl, matchingNub, backdropFor,
  setReference,
} from './model.js';
import { kindLabel } from './render.js';
import { DEVICES, referenceFor } from './devices.js';
import { el, row, sliderRow, checkRow, numberInput, section, toast } from './ui.js';

let host;

export function initInspector() {
  host = document.getElementById('inspector');
  document.querySelectorAll('.panel-right .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.panel-right .tab').forEach(t => t.classList.toggle('is-active', t === tab));
      state.ui.inspectorTab = tab.dataset.insp;
      renderInspector();
    });
  });
  renderInspector();
}

/* Keep the caret where the user left it when a commit re-renders the panel. */
function focusKey() {
  const a = document.activeElement;
  if (!a || !host.contains(a) || !a.dataset || !a.dataset.k) return null;
  return { k: a.dataset.k, start: a.selectionStart, end: a.selectionEnd };
}
function restoreFocus(mark) {
  if (!mark) return;
  const node = host.querySelector(`[data-k="${CSS.escape(mark.k)}"]`);
  if (!node) return;
  node.focus();
  if (mark.start != null && node.setSelectionRange) {
    try { node.setSelectionRange(mark.start, mark.end); } catch { /* number inputs */ }
  }
}

export function renderInspector() {
  if (!host) return;
  const mark = focusKey();
  const scroll = host.scrollTop;
  host.innerHTML = '';

  if (state.ui.inspectorTab === 'layers') renderLayers();
  else if (state.ui.inspectorTab === 'screen') renderScreen();
  else renderProps();

  host.scrollTop = scroll;
  restoreFocus(mark);
}

/** Edit helper: one history entry, then re-render. */
const edit = (fn, reason = 'change') => commit(fn, reason);

/** Slider that writes continuously but records a single undo step. */
function liveSlider(label, opts) {
  let open = false;
  let touched = false;
  const node = sliderRow(label, {
    ...opts,
    oninput: v => {
      if (!open) { beginChange(); open = true; touched = false; }
      touched = true;
      opts.apply(v);
      emit('edit');
    },
  });
  const input = node.querySelector('input');
  const close = () => {
    if (open && !touched) abandonChange();
    if (open) emit('change');
    open = false;
  };
  input.addEventListener('change', close);
  input.addEventListener('pointerup', close);
  input.addEventListener('blur', close);
  return node;
}

/* ═══════════════════════ properties ═══════════════════════ */

function renderProps() {
  const sel = selected();
  if (!sel.length) return renderNoSelection();
  if (sel.length > 1) return renderMultiSelection(sel);

  const c = sel[0];
  host.append(identitySection(c));
  host.append(transformSection(c));
  host.append(appearanceSection(c));
  if (c.type === 'joystick') host.append(stickSection(c));
  if (c.type === 'dpad') host.append(dpadSection(c));
  host.append(hitSection(c));
  host.append(actionsSection(c));
}

function renderNoSelection() {
  host.append(el('div', { class: 'insp-empty' }, [
    el('p', { html: '<b>Nothing selected.</b>' }),
    el('p', { html: 'Pick a sprite on the left to add a control, then select it here to set its id, action, anchor and hit area.' }),
    el('p', { html: 'Marquee-drag on empty space to select several, <kbd>Shift</kbd>-click to add.' }),
  ]));
}

function renderMultiSelection(sel) {
  host.append(section(`${sel.length} controls selected`, [
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn sm', text: 'Align L', onclick: () => alignTo(sel, 'left') }),
      el('button', { class: 'btn sm', text: 'Centre X', onclick: () => alignTo(sel, 'centerX') }),
      el('button', { class: 'btn sm', text: 'Align R', onclick: () => alignTo(sel, 'right') }),
    ]),
    el('div', { class: 'btn-row', style: 'margin-top:6px' }, [
      el('button', { class: 'btn sm', text: 'Align T', onclick: () => alignTo(sel, 'top') }),
      el('button', { class: 'btn sm', text: 'Centre Y', onclick: () => alignTo(sel, 'centerY') }),
      el('button', { class: 'btn sm', text: 'Align B', onclick: () => alignTo(sel, 'bottom') }),
    ]),
    el('div', { class: 'btn-row', style: 'margin-top:6px' }, [
      el('button', { class: 'btn sm', text: 'Space across', onclick: () => distribute(sel, 'x') }),
      el('button', { class: 'btn sm', text: 'Space down', onclick: () => distribute(sel, 'y') }),
    ]),
  ]));

  // Sizes as they stand at this render; the panel re-renders after every drag,
  // so the scale slider always multiplies from a fresh baseline.
  const bases = sel.map(c => ({ c, w: c.w, h: c.h }));

  host.append(section('Apply to all', [
    liveSlider('Scale', {
      min: 0.25, max: 3, step: 0.05, value: 1, format: v => v.toFixed(2) + 'x',
      apply: v => {
        for (const b of bases) {
          b.c.w = round2(b.w * v);
          b.c.h = round2(b.h * v);
        }
      },
    }),
    liveSlider('Opacity', {
      min: 0, max: 1, step: 0.01, value: sel[0].opacity ?? 1, format: v => Math.round(v * 100) + '%',
      apply: v => sel.forEach(c => { c.opacity = v; }),
    }),
    el('div', { class: 'btn-row', style: 'margin-top:8px' }, [
      el('button', { class: 'btn sm', text: 'Duplicate', onclick: () => duplicateSelection() }),
      el('button', { class: 'btn sm danger', text: 'Delete', onclick: () => deleteSelection() }),
    ]),
  ]));
}

function identitySection(c) {
  const badgeClass = c.type === 'joystick' ? 'joystick' : c.type === 'dpad' ? 'dpad' : 'button';
  return section('Control', [
    row('ID', el('input', {
      type: 'text', value: c.id, dataset: { k: 'id' }, spellcheck: false,
      onchange: e => {
        const next = uniqueId(state.doc.controls.filter(o => o !== c), e.target.value || c.id);
        edit(() => { c.id = next; });
        state.selection = [next];
      },
    })),
    row('Action', el('input', {
      type: 'text', value: c.action, dataset: { k: 'action' }, placeholder: 'jump, fire, move…', spellcheck: false,
      onchange: e => edit(() => { c.action = e.target.value.trim(); }),
    })),
    row('Label', el('input', {
      type: 'text', value: c.label || '', dataset: { k: 'label' }, placeholder: 'shown in the layer list',
      onchange: e => edit(() => { c.label = e.target.value; }),
    })),
  ], el('span', { class: `badge ${badgeClass} sp`, text: kindLabel(c) }));
}

function transformSection(c) {
  const ref = state.doc.reference;
  const off = anchorOffset(c, ref);

  const anchorGrid = el('div', { class: 'anchor-grid' }, ANCHORS.map(a =>
    el('button', {
      type: 'button',
      class: c.anchor === a ? 'is-on' : '',
      title: a,
      onclick: () => edit(() => { c.anchor = a; c.anchorLocked = true; }),
    })));

  return section('Transform', [
    row('Position', [
      numberInput(c.x, v => edit(() => { c.x = round2(v); }), { step: 1 }),
      numberInput(c.y, v => edit(() => { c.y = round2(v); }), { step: 1 }),
    ], { two: true }),
    row('Size', [
      numberInput(c.w, v => edit(() => {
        const k = v / c.w;
        c.w = round2(Math.max(8, v));
        c.h = round2(Math.max(8, c.h * k));
      }), { step: 1, min: 8 }),
      numberInput(c.h, v => edit(() => { c.h = round2(Math.max(8, v)); }), { step: 1, min: 8 }),
    ], { two: true }),
    liveSlider('Rotation', {
      min: -180, max: 180, step: 1, value: c.rotation, format: v => v + '°',
      apply: v => { c.rotation = v; },
    }),
    liveSlider('Opacity', {
      min: 0, max: 1, step: 0.01, value: c.opacity ?? 1, format: v => Math.round(v * 100) + '%',
      apply: v => { c.opacity = v; },
    }),
    row('Anchor', anchorGrid),
    el('p', { class: 'hint', style: 'margin-top:4px',
      text: `Offset from anchor: ${off.x}, ${off.y} px — that is what the JSON exports.` }),
    el('div', { class: 'btn-row', style: 'margin-top:8px' }, [
      el('button', { class: 'btn sm', text: 'Reset size', title: 'Back to the sprite’s natural size',
        onclick: () => edit(() => {
          const nat = naturalSize(c.sprite);
          c.w = nat.w; c.h = nat.h;
        }) }),
      el('button', { class: 'btn sm', text: 'Reset angle', onclick: () => edit(() => { c.rotation = 0; }) }),
    ]),
  ]);
}

function appearanceSection(c) {
  const info = spriteInfo(c.sprite);
  const family = info ? spritesOf(info.group) : [];
  const dark = styleInfo(state.doc.style).dark;

  const spriteChooser = el('div', { class: 'chooser' }, family.map(s =>
    el('button', {
      type: 'button',
      class: s.name === c.sprite ? 'is-on' : '',
      title: s.name,
      style: dark ? 'background:#454d5f' : '',
      onclick: () => edit(() => {
        const nat = naturalSize(c.sprite);
        const next = naturalSize(s.name);
        // Keep the on-screen size, adjusting for a different artwork ratio.
        c.h = round2(c.w * (next.h / next.w));
        c.sprite = s.name;
        if (c.type === 'joystick' && spriteInfo(s.name).shape !== (info && info.shape)) {
          c.stick.nub = matchingNub(s.name);
        }
      }),
    }, [
      el('img', { src: spritePath(s.name, state.doc.style), alt: '', loading: 'lazy' }),
      el('span', { text: s.label }),
    ])));

  const body = [
    el('p', { class: 'hint', style: 'margin-bottom:7px', text: 'Sprite' }),
    spriteChooser,
  ];

  body.push(el('p', { class: 'hint', style: 'margin:12px 0 7px', text: 'Face icon' }));
  const iconGrid = el('div', { class: 'chooser icons' }, [
    el('button', {
      type: 'button', class: !c.icon ? 'is-on' : '', title: 'No icon',
      onclick: () => edit(() => { c.icon = null; }),
    }, [el('span', { text: 'none', style: 'font-size:9px;padding:9px 0' })]),
    ...ICONS.map(i => el('button', {
      type: 'button',
      class: c.icon && c.icon.name === i.name ? 'is-on' : '',
      title: i.label,
      onclick: () => edit(() => {
        c.icon = c.icon
          ? { ...c.icon, name: i.name }
          : { name: i.name, scale: c.type === 'joystick' ? 0.4 : 0.5, tint: '#ffffff', opacity: 1, rotation: 0, offsetX: 0, offsetY: 0 };
      }),
    }, [el('img', { src: iconPath(i.name), alt: '', loading: 'lazy' })])),
  ]);
  body.push(iconGrid);

  if (c.icon) {
    body.push(liveSlider('Icon size', {
      min: 0.1, max: 1.2, step: 0.01, value: c.icon.scale ?? 0.5, format: v => Math.round(v * 100) + '%',
      apply: v => { c.icon.scale = v; },
    }));
    body.push(liveSlider('Icon turn', {
      min: -180, max: 180, step: 15, value: c.icon.rotation ?? 0, format: v => v + '°',
      apply: v => { c.icon.rotation = v; },
    }));
    body.push(row('Icon colour', [
      el('input', { type: 'color', value: c.icon.tint || '#ffffff',
        oninput: e => { c.icon.tint = e.target.value; emit('edit'); },
        onchange: e => edit(() => { c.icon.tint = e.target.value; }) }),
      el('button', { class: 'btn sm', text: 'White', onclick: () => edit(() => { c.icon.tint = '#ffffff'; }) }),
    ]));
  }

  return section('Appearance', body);
}

function stickSection(c) {
  const nubs = spritesOf('joystick_nub');
  const dark = styleInfo(state.doc.style).dark;
  const ns = nubSize(c);
  const tr = travelRadius(c);

  const nubChooser = el('div', { class: 'chooser' }, nubs.map(s =>
    el('button', {
      type: 'button',
      class: s.name === c.stick.nub ? 'is-on' : '',
      title: s.name,
      style: dark ? 'background:#454d5f' : '',
      onclick: () => edit(() => { c.stick.nub = s.name; }),
    }, [
      el('img', { src: spritePath(s.name, state.doc.style), alt: '', loading: 'lazy' }),
      el('span', { text: s.label }),
    ])));

  return section('Thumb stick', [
    el('p', { class: 'hint', style: 'margin-bottom:7px', text: 'Stick nub' }),
    nubChooser,
    liveSlider('Nub size', {
      min: 0.2, max: 0.9, step: 0.01, value: c.stick.nubScale, format: v => Math.round(v * 100) + '%',
      apply: v => { c.stick.nubScale = v; },
    }),
    liveSlider('Travel', {
      min: 0.05, max: 1.2, step: 0.01, value: c.stick.travel, format: v => Math.round(v * (c.w / 2)) + 'px',
      apply: v => { c.stick.travel = v; },
    }),
    liveSlider('Dead zone', {
      min: 0, max: 0.6, step: 0.01, value: c.stick.deadZone, format: v => Math.round(v * 100) + '%',
      apply: v => { c.stick.deadZone = v; },
    }),
    row('Mode', el('select', {
      dataset: { k: 'stick-mode' },
      onchange: e => edit(() => { c.stick.mode = e.target.value; }),
    }, [
      option('fixed', 'Fixed — pad stays put', c.stick.mode),
      option('floating', 'Floating — pad follows the first touch', c.stick.mode),
    ])),
    row('Lights up', el('select', {
      onchange: e => edit(() => { c.stick.highlight = e.target.value; }),
    }, [
      option('nub', 'Stick only', c.stick.highlight || 'nub'),
      option('both', 'Pad and stick', c.stick.highlight || 'nub'),
      option('none', 'Nothing', c.stick.highlight || 'nub'),
    ])),
    checkRow('Snap back to centre on release', c.stick.recenter !== false,
      v => edit(() => { c.stick.recenter = v; })),
    checkRow('Invert Y axis', !!c.stick.invertY, v => edit(() => { c.stick.invertY = v; })),
    row('Axis names', [
      el('input', { type: 'text', value: c.stick.axisX || '', dataset: { k: 'axisX' }, placeholder: 'move_x',
        onchange: e => edit(() => { c.stick.axisX = e.target.value.trim(); }) }),
      el('input', { type: 'text', value: c.stick.axisY || '', dataset: { k: 'axisY' }, placeholder: 'move_y',
        onchange: e => edit(() => { c.stick.axisY = e.target.value.trim(); }) }),
    ], { two: true }),
    el('p', { class: 'hint', style: 'margin-top:6px',
      text: `Nub ${Math.round(ns.w)}x${Math.round(ns.h)} px · travel radius ${Math.round(tr)} px · dead zone ${Math.round(tr * c.stick.deadZone)} px.` }),
  ]);
}

function dpadSection(c) {
  const body = [
    row('Layout', el('select', {
      onchange: e => edit(() => { c.dpad.layout = e.target.value; }),
    }, [
      option('unified', 'Unified — one sprite', c.dpad.layout),
      option('composed', 'Composed — four arms', c.dpad.layout),
    ])),
  ];

  if (c.dpad.layout === 'composed') {
    body.push(liveSlider('Arm size', {
      min: 0.2, max: 0.8, step: 0.01, value: c.dpad.elementScale, format: v => Math.round(v * 100) + '%',
      apply: v => { c.dpad.elementScale = v; },
    }));
    body.push(liveSlider('Arm gap', {
      min: 0, max: 0.3, step: 0.005, value: c.dpad.gap, format: v => Math.round(v * Math.min(c.w, c.h)) + 'px',
      apply: v => { c.dpad.gap = v; },
    }));
  }

  body.push(checkRow('Allow diagonals', c.dpad.diagonals !== false, v => edit(() => { c.dpad.diagonals = v; })));
  body.push(liveSlider('Dead zone', {
    min: 0, max: 0.7, step: 0.01, value: c.dpad.deadZone, format: v => Math.round(v * 100) + '%',
    apply: v => { c.dpad.deadZone = v; },
  }));

  body.push(el('p', { class: 'hint', style: 'margin:10px 0 7px', text: 'Action per direction' }));
  for (const dir of ['north', 'south', 'west', 'east']) {
    body.push(row(dir[0].toUpperCase() + dir.slice(1), el('input', {
      type: 'text', value: c.dpad.actions[dir] || '', dataset: { k: 'dpad-' + dir },
      placeholder: dir === 'north' ? 'up' : dir === 'south' ? 'down' : dir === 'west' ? 'left' : 'right',
      onchange: e => edit(() => { c.dpad.actions[dir] = e.target.value.trim(); }),
    })));
  }
  return section('D-pad', body);
}

function hitSection(c) {
  const shape = hitShape(c);
  const r = hitRadius(c);
  const detail = shape === 'circle'
    ? `Circle, radius ${Math.round(r)} px`
    : `Rectangle ${Math.round(c.w * c.hit.scale)}x${Math.round(c.h * c.hit.scale)} px`;

  return section('Touch area', [
    row('Shape', el('select', {
      onchange: e => edit(() => { c.hit.shape = e.target.value; }),
    }, [
      option('auto', 'Auto (from the sprite)', c.hit.shape),
      option('circle', 'Circle', c.hit.shape),
      option('rect', 'Rectangle', c.hit.shape),
    ])),
    liveSlider('Size', {
      min: 0.5, max: 2.5, step: 0.01, value: c.hit.scale ?? 1, format: v => Math.round(v * 100) + '%',
      apply: v => { c.hit.scale = v; },
    }),
    el('p', { class: 'hint', text: `${detail} — drawn as the blue dashed outline.` }),
    el('p', { class: 'hint', style: 'margin-top:5px',
      text: 'Thumbs are imprecise: a touch area larger than the artwork usually feels better.' }),
  ]);
}

function actionsSection(c) {
  return section('Arrange', [
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn sm', text: 'Duplicate', onclick: () => duplicateSelection() }),
      el('button', { class: 'btn sm', text: 'Mirror', title: 'Mirrored copy on the other side',
        onclick: () => mirrorSelection() }),
    ]),
    el('div', { class: 'btn-row', style: 'margin-top:6px' }, [
      el('button', { class: 'btn sm', text: c.locked ? 'Unlock' : 'Lock',
        onclick: () => edit(() => { c.locked = !c.locked; }) }),
      el('button', { class: 'btn sm', text: c.hidden ? 'Show' : 'Hide',
        onclick: () => edit(() => { c.hidden = !c.hidden; }) }),
    ]),
    el('div', { class: 'btn-row', style: 'margin-top:6px' }, [
      el('button', { class: 'btn sm', text: 'To front', onclick: () => reorder(c, 'front') }),
      el('button', { class: 'btn sm', text: 'To back', onclick: () => reorder(c, 'back') }),
    ]),
    el('button', { class: 'btn sm danger wide', style: 'margin-top:8px', text: 'Delete control',
      onclick: () => deleteSelection() }),
  ]);
}

const option = (value, label, current) =>
  el('option', { value, text: label, selected: value === current });

/* ═══════════════════════ layers ═══════════════════════ */

function renderLayers() {
  const list = state.doc.controls;
  if (!list.length) {
    host.append(el('div', { class: 'insp-empty', html: '<p>No controls yet.</p>' }));
    return;
  }
  const wrap = el('div', { class: 'layer-list' });
  // Topmost first, matching what you see on the stage.
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    wrap.append(layerRow(c, i));
  }
  host.append(wrap);
}

function layerRow(c, index) {
  const node = el('div', {
    class: 'layer' + (state.selection.includes(c.id) ? ' is-sel' : ''),
    draggable: true,
    onclick: e => select(c.id, { additive: e.shiftKey }),
  }, [
    el('img', { src: spritePath(c.sprite, state.doc.style), alt: '', loading: 'lazy' }),
    el('span', { class: 'nm', text: c.action || c.id }),
    el('button', {
      class: 'act' + (c.hidden ? ' is-on' : ''), title: c.hidden ? 'Show' : 'Hide',
      onclick: e => { e.stopPropagation(); edit(() => { c.hidden = !c.hidden; }); },
      html: c.hidden
        ? '<svg viewBox="0 0 24 24"><path d="M2 5l17 15 1.3-1.5-3-2.6A11 11 0 0022 12S18.5 5 12 5a10 10 0 00-4 .8L3.3 3.5zM12 7c4.2 0 6.9 3.6 7.7 5a10 10 0 01-2.6 2.9l-2-1.8A3 3 0 0011 9.2L9.5 7.8A8 8 0 0112 7z"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M12 5C5.5 5 2 12 2 12s3.5 7 10 7 10-7 10-7-3.5-7-10-7zm0 2c4.2 0 6.9 3.6 7.7 5-.8 1.4-3.5 5-7.7 5s-6.9-3.6-7.7-5C5.1 10.6 7.8 7 12 7zm0 1.8a3.2 3.2 0 100 6.4 3.2 3.2 0 000-6.4z"/></svg>',
    }),
    el('button', {
      class: 'act' + (c.locked ? ' is-on' : ''), title: c.locked ? 'Unlock' : 'Lock',
      onclick: e => { e.stopPropagation(); edit(() => { c.locked = !c.locked; }); },
      html: c.locked
        ? '<svg viewBox="0 0 24 24"><path d="M12 2a5 5 0 00-5 5v2H6a2 2 0 00-2 2v9a2 2 0 002 2h12a2 2 0 002-2v-9a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm0 2a3 3 0 013 3v2H9V7a3 3 0 013-3z"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M12 2a5 5 0 00-5 5h2a3 3 0 016 0v2H6a2 2 0 00-2 2v9a2 2 0 002 2h12a2 2 0 002-2v-9a2 2 0 00-2-2h-1V7a5 5 0 00-5-5z" opacity=".75"/></svg>',
    }),
  ]);

  node.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/layer', String(index));
    e.dataTransfer.effectAllowed = 'move';
  });
  node.addEventListener('dragover', e => {
    if (e.dataTransfer.types.includes('text/layer')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
  });
  node.addEventListener('drop', e => {
    const from = parseInt(e.dataTransfer.getData('text/layer'), 10);
    if (Number.isNaN(from) || from === index) return;
    e.preventDefault();
    edit(doc => {
      const [moved] = doc.controls.splice(from, 1);
      doc.controls.splice(index, 0, moved);
    }, 'reorder');
  });
  return node;
}

/* ═══════════════════════ screen ═══════════════════════ */

function renderScreen() {
  const doc = state.doc;
  const ref = doc.reference;

  host.append(section('Layout', [
    row('Name', el('input', {
      type: 'text', value: doc.name, dataset: { k: 'docname' },
      onchange: e => edit(() => { doc.name = e.target.value || 'Untitled layout'; }),
    })),
  ]));

  host.append(section('Screen', [
    row('Device', el('select', {
      onchange: e => applyDevice(e.target.value, ref.orientation),
    }, DEVICES.map(d => option(d.id, `${d.name} · ${d.w}x${d.h}`, ref.deviceId || 'generic-16-9')))),
    row('Orientation', el('select', {
      onchange: e => applyDevice(ref.deviceId || 'generic-16-9', e.target.value),
    }, [
      option('landscape', 'Landscape', ref.orientation),
      option('portrait', 'Portrait', ref.orientation),
    ])),
    row('Size', [
      numberInput(ref.width, v => resizeScreen(Math.max(120, v), ref.height), { step: 1, min: 120 }),
      numberInput(ref.height, v => resizeScreen(ref.width, Math.max(120, v)), { step: 1, min: 120 }),
    ], { two: true }),
    el('p', { class: 'hint', text: 'Changing the screen keeps every control at the same offset from its anchor.' }),
  ]));

  host.append(section('Safe area', [
    row('Top / Bottom', [
      numberInput(doc.safeArea.top, v => edit(() => { doc.safeArea.top = Math.max(0, v); }), { step: 1, min: 0 }),
      numberInput(doc.safeArea.bottom, v => edit(() => { doc.safeArea.bottom = Math.max(0, v); }), { step: 1, min: 0 }),
    ], { two: true }),
    row('Left / Right', [
      numberInput(doc.safeArea.left, v => edit(() => { doc.safeArea.left = Math.max(0, v); }), { step: 1, min: 0 }),
      numberInput(doc.safeArea.right, v => edit(() => { doc.safeArea.right = Math.max(0, v); }), { step: 1, min: 0 }),
    ], { two: true }),
    el('p', { class: 'hint', text: 'Notches and home indicators. Keep controls inside the amber outline.' }),
  ]));

  host.append(section('Backdrop', [
    row('Mode', el('select', {
      onchange: e => edit(() => { doc.background.mode = e.target.value; }),
    }, [
      option('gradient', 'Gradient', doc.background.mode),
      option('solid', 'Solid colour', doc.background.mode),
      option('none', 'None (transparent)', doc.background.mode),
    ])),
    doc.background.mode !== 'none' ? row('Colours', [
      el('input', { type: 'color', value: doc.background.color,
        oninput: e => { doc.background.color = e.target.value; emit('edit'); },
        onchange: e => edit(() => { doc.background.color = e.target.value; doc.background.auto = false; }) }),
      doc.background.mode === 'gradient'
        ? el('input', { type: 'color', value: doc.background.color2,
            oninput: e => { doc.background.color2 = e.target.value; emit('edit'); },
            onchange: e => edit(() => { doc.background.color2 = e.target.value; doc.background.auto = false; }) })
        : null,
    ]) : null,
    el('button', { class: 'btn sm wide', style: 'margin-top:4px',
      text: 'Match the sprite style',
      title: 'Pick a backdrop that keeps this style readable',
      onclick: () => edit(() => { doc.background = backdropFor(doc.style); }) }),
    el('p', { class: 'hint', style: 'margin-top:6px', text: 'Only a preview backdrop — PNG export can leave it out.' }),
  ]));

  host.append(section('Grid', [
    row('Cell size', numberInput(doc.grid.size, v => edit(() => { doc.grid.size = clamp(Math.round(v), 2, 200); }), { step: 1, min: 2 })),
    el('p', { class: 'hint', text: 'Snapping also latches onto other controls, the centre line and the safe area.' }),
  ]));
}

function applyDevice(deviceId, orientation) {
  edit(doc => setReference(doc, referenceFor(deviceId, orientation)), 'device');
}

function resizeScreen(w, h) {
  edit(doc => setReference(doc, { width: w, height: h, device: 'Custom' }), 'resize');
}

/* ═══════════════════════ operations ═══════════════════════ */

export function duplicateSelection() {
  const sel = selected();
  if (!sel.length) return;
  const made = [];
  commit(doc => {
    for (const c of sel) {
      const copy = structuredClone(c);
      copy.id = uniqueId(doc.controls.concat(made), c.id);
      copy.x = round2(c.x + 24);
      copy.y = round2(c.y + 24);
      doc.controls.push(copy);
      made.push(copy);
    }
  }, 'duplicate');
  select(made.map(c => c.id));
}

export function mirrorSelection() {
  const sel = selected();
  if (!sel.length) return;
  const made = [];
  commit(doc => {
    for (const c of sel) {
      const copy = mirrorControl(c, doc.reference, doc.controls.concat(made));
      doc.controls.push(copy);
      made.push(copy);
    }
  }, 'mirror');
  select(made.map(c => c.id));
  toast(`Mirrored ${made.length} control${made.length > 1 ? 's' : ''} to the other side.`);
}

export function deleteSelection() {
  const ids = new Set(state.selection);
  if (!ids.size) return;
  commit(doc => { doc.controls = doc.controls.filter(c => !ids.has(c.id)); }, 'delete');
  select([]);
}

export function reorder(c, where) {
  commit(doc => {
    const i = doc.controls.indexOf(c);
    if (i < 0) return;
    doc.controls.splice(i, 1);
    if (where === 'front') doc.controls.push(c);
    else if (where === 'back') doc.controls.unshift(c);
    else if (where === 'forward') doc.controls.splice(Math.min(i + 1, doc.controls.length), 0, c);
    else doc.controls.splice(Math.max(i - 1, 0), 0, c);
  }, 'reorder');
}

export function reorderSelection(where) {
  const sel = selected();
  if (!sel.length) return;
  commit(doc => {
    for (const c of sel) {
      const i = doc.controls.indexOf(c);
      if (i < 0) continue;
      doc.controls.splice(i, 1);
      if (where === 'front') doc.controls.push(c);
      else doc.controls.unshift(c);
    }
  }, 'reorder');
}

export function alignTo(sel, mode) {
  if (sel.length < 2) return;
  const boxes = sel.map(c => ({ c, b: boundsOf(c) }));
  commit(() => {
    if (mode === 'left') {
      const x = Math.min(...boxes.map(o => o.b.x));
      boxes.forEach(o => { o.c.x = round2(x + o.b.w / 2); });
    } else if (mode === 'right') {
      const x = Math.max(...boxes.map(o => o.b.x + o.b.w));
      boxes.forEach(o => { o.c.x = round2(x - o.b.w / 2); });
    } else if (mode === 'centerX') {
      const x = boxes.reduce((s, o) => s + o.c.x, 0) / boxes.length;
      boxes.forEach(o => { o.c.x = round2(x); });
    } else if (mode === 'top') {
      const y = Math.min(...boxes.map(o => o.b.y));
      boxes.forEach(o => { o.c.y = round2(y + o.b.h / 2); });
    } else if (mode === 'bottom') {
      const y = Math.max(...boxes.map(o => o.b.y + o.b.h));
      boxes.forEach(o => { o.c.y = round2(y - o.b.h / 2); });
    } else if (mode === 'centerY') {
      const y = boxes.reduce((s, o) => s + o.c.y, 0) / boxes.length;
      boxes.forEach(o => { o.c.y = round2(y); });
    }
  }, 'align');
}

export function distribute(sel, axis) {
  if (sel.length < 3) { toast('Select at least three controls to space them out.', 'err'); return; }
  const key = axis === 'x' ? 'x' : 'y';
  const sorted = sel.slice().sort((a, b) => a[key] - b[key]);
  const first = sorted[0][key];
  const last = sorted[sorted.length - 1][key];
  const step = (last - first) / (sorted.length - 1);
  commit(() => {
    sorted.forEach((c, i) => { c[key] = round2(first + step * i); });
  }, 'distribute');
}
