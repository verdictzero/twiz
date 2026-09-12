/* The sprite library. Click a tile to drop it in the middle of the screen,
 * or drag it exactly where you want it. */

import { ICONS, spritePath, iconPath, styleInfo, spritesOf, imgSrc } from './assets.js';
import { state, commit, selected } from './store.js';
import { el, toast } from './ui.js';
import { addSpriteAt } from './stage.js';

const GROUPS = [
  { key: 'joystick_pad', title: 'Thumb sticks', note: 'pad + stick', open: true,
    hint: 'Drops a complete joystick: base pad, stick nub and a travel ring.' },
  { key: 'joystick_nub', title: 'Stick nubs', open: false,
    hint: 'Drop onto a joystick to swap just its stick.' },
  { key: 'dpad', title: 'D-pads', open: true },
  { key: 'dpad_element', title: 'D-pad arms', open: false,
    hint: 'Individual arms — or switch a d-pad to "composed" to space them yourself.' },
  { key: 'button', title: 'Buttons', open: true },
  { key: 'direction', title: 'Direction', open: false },
];

let searchTerm = '';

export function initPalette() {
  const search = document.getElementById('palette-search');
  search.addEventListener('input', e => {
    searchTerm = e.target.value.trim().toLowerCase();
    renderPalette();
  });

  document.querySelectorAll('.panel-left .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.panel-left .tab').forEach(t => t.classList.toggle('is-active', t === tab));
      state.ui.paletteTab = tab.dataset.lib;
      renderPalette();
    });
  });

  renderPalette();
}

function matches(name, label) {
  if (!searchTerm) return true;
  return name.toLowerCase().includes(searchTerm) || String(label).toLowerCase().includes(searchTerm);
}

export function renderPalette() {
  const host = document.getElementById('palette');
  if (!host) return;
  const scroll = host.scrollTop;
  host.innerHTML = '';

  if (state.ui.paletteTab === 'icons') {
    const list = ICONS.filter(i => matches(i.name, i.label));
    host.append(list.length
      ? group('Icons', list.map(i => tile(i.name, i.label, iconPath(i.name), 'icon')), true,
              'Drop an icon onto a button to use it as the face.')
      : empty('No icons match that search.'));
    host.scrollTop = scroll;
    return;
  }

  let any = false;
  for (const g of GROUPS) {
    const list = spritesOf(g.key).filter(s => matches(s.name, s.label));
    if (!list.length) continue;
    any = true;
    const tiles = list.map(s => tile(s.name, s.label, spritePath(s.name, state.doc.style), 'sprite'));
    host.append(group(g.title, tiles, g.open || !!searchTerm, g.hint, g.note));
  }
  if (!any) host.append(empty('Nothing matches that search.'));
  host.scrollTop = scroll;
}

function group(title, tiles, open, hint, note) {
  const details = el('details', { class: 'pal-group', open });
  details.append(
    el('summary', {}, [
      title,
      note ? el('span', { class: 'count', text: note }) : el('span', { class: 'count', text: tiles.length }),
    ]),
  );
  if (hint) details.append(el('p', { class: 'hint', style: 'padding:0 10px 6px;', text: hint }));
  details.append(el('div', { class: 'pal-grid' }, tiles));
  return details;
}

function empty(text) {
  return el('div', { class: 'pal-empty', text });
}

function tile(name, label, src, kind) {
  const dark = kind === 'sprite' ? styleInfo(state.doc.style).dark : false;
  const node = el('button', {
    class: 'pal-item' + (dark ? ' is-light-sprite' : ''),
    type: 'button',
    draggable: true,
    title: name,
    dataset: { sprite: name, kind },
  }, [
    el('img', { src: imgSrc(src), alt: '', loading: 'lazy', draggable: false }),
    el('span', { text: label }),
  ]);

  node.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/sprite', JSON.stringify({ name, kind }));
    e.dataTransfer.effectAllowed = 'copy';
    const img = node.querySelector('img');
    if (img && img.complete) e.dataTransfer.setDragImage(img, 19, 19);
  });

  node.addEventListener('click', () => addToCentre(name, kind));
  return node;
}

/** Click-to-add: drop at the middle of the screen, nudged so stacks stay visible. */
function addToCentre(name, kind) {
  const ref = state.doc.reference;
  if (kind === 'icon') {
    const target = selected()[0];
    if (!target) { toast('Select a control first, then click an icon to put it on the face.', 'err'); return; }
    commit(() => {
      target.icon = { name, scale: target.type === 'joystick' ? 0.4 : 0.5, tint: '#ffffff', opacity: 1, rotation: 0, offsetX: 0, offsetY: 0 };
    }, 'icon');
    return;
  }

  if (nubDrop(name)) return;

  const n = state.doc.controls.length;
  const jitter = (n % 5) * 18;
  addSpriteAt(name, kind, ref.width / 2 + jitter, ref.height / 2 + jitter);
}

/** Dropping a nub swaps the stick on the selected joystick instead of adding one. */
function nubDrop(name) {
  if (!name.includes('_nub_')) return false;
  const target = selected().find(c => c.type === 'joystick');
  if (!target) return false;
  commit(() => { target.stick.nub = name; }, 'nub');
  toast(`Stick nub set to ${name.replace(/_/g, ' ')}.`);
  return true;
}
