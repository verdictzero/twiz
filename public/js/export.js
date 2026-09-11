/* Turning a layout into something a game can read: JSON, PNG, SVG, or a zip
 * with the sprite files it actually uses. */

import {
  SPRITES, spritePath, iconPath, pressedName, pressedPath, styleInfo, highlightInfo,
  image, loadImage, settle, PACK, naturalSize,
} from './assets.js';
import { drawLayout, usedSprites, usedIcons, dpadElements, kindLabel } from './render.js';
import {
  SCHEMA, SCHEMA_VERSION, anchorOffset, anchorPoint, hitRadius, hitShape,
  nubSize, travelRadius, makeDoc, makeControl, round2, clamp,
} from './model.js';
import { makeZip } from './zip.js';

const r2 = round2;
const r4 = n => Math.round(n * 10000) / 10000;

/* ═══════════════════════ JSON ═══════════════════════ */

/** The exported document — the contract a game integrates against. */
export function serialize(doc) {
  const ref = doc.reference;
  const style = styleInfo(doc.style);
  const hl = highlightInfo(doc.highlightSet);

  return {
    format: SCHEMA,
    version: SCHEMA_VERSION,
    generator: 'Touch Layout Studio',
    name: doc.name,
    exported: new Date().toISOString(),
    pack: { name: PACK.name, license: PACK.license, source: PACK.source },
    style: { id: style.id, name: style.name, dir: style.dir },
    highlightSet: { id: hl.id, name: hl.name, dir: hl.dir },
    reference: {
      width: ref.width,
      height: ref.height,
      orientation: ref.orientation,
      device: ref.device || null,
      deviceId: ref.deviceId || null,
    },
    safeArea: { ...doc.safeArea },
    background: { ...doc.background },
    controls: doc.controls.map(c => serializeControl(c, doc)),
    assets: assetList(doc),
  };
}

function serializeControl(c, doc) {
  const ref = doc.reference;
  const off = anchorOffset(c, ref);
  const out = {
    id: c.id,
    label: c.label || c.id,
    type: c.type,
    kind: kindLabel(c),
    action: c.action || null,
    anchor: c.anchor,
    /* Position is given three ways so any engine can use it directly. */
    anchorOffset: { x: off.x, y: off.y },
    center: { x: r2(c.x), y: r2(c.y) },
    rect: { x: r2(c.x - c.w / 2), y: r2(c.y - c.h / 2), width: r2(c.w), height: r2(c.h) },
    normalized: { x: r4(c.x / ref.width), y: r4(c.y / ref.height) },
    rotation: c.rotation || 0,
    opacity: c.opacity ?? 1,
    hidden: !!c.hidden,
    hit: serializeHit(c),
    sprite: spriteRef(c.sprite, doc),
  };

  if (c.icon && c.icon.name) {
    const nat = naturalSize(c.icon.name);
    const span = Math.min(c.w, c.h) * (c.icon.scale ?? 0.5);
    out.icon = {
      name: c.icon.name,
      file: iconPath(c.icon.name),
      width: r2(span),
      height: r2(span * (nat.h / nat.w)),
      offset: { x: r2((c.icon.offsetX || 0) * c.w), y: r2((c.icon.offsetY || 0) * c.h) },
      rotation: c.icon.rotation || 0,
      opacity: c.icon.opacity ?? 1,
      tint: c.icon.tint || '#FFFFFF',
    };
  }

  if (c.type === 'joystick') {
    const ns = nubSize(c);
    out.stick = {
      nub: { ...spriteRef(c.stick.nub, doc), width: r2(ns.w), height: r2(ns.h) },
      travelRadius: r2(travelRadius(c)),
      travelRatio: r4(c.stick.travel),
      deadZone: r4(c.stick.deadZone),
      deadZoneRadius: r2(travelRadius(c) * c.stick.deadZone),
      mode: c.stick.mode,
      highlight: c.stick.highlight || 'nub',
      recenter: c.stick.recenter !== false,
      invertY: !!c.stick.invertY,
      axes: { x: c.stick.axisX || `${c.id}_x`, y: c.stick.axisY || `${c.id}_y` },
    };
  }

  if (c.type === 'dpad') {
    out.dpad = {
      layout: c.dpad.layout,
      diagonals: c.dpad.diagonals !== false,
      deadZone: r4(c.dpad.deadZone),
      actions: { ...c.dpad.actions },
    };
    if (c.dpad.layout === 'composed') {
      out.dpad.elements = dpadElements(c).map(elm => ({
        direction: elm.dir,
        ...spriteRef(elm.sprite, doc),
        offset: { x: r2(elm.x), y: r2(elm.y) },
        width: r2(elm.w),
        height: r2(elm.h),
      }));
    }
  }

  return out;
}

function serializeHit(c) {
  const shape = hitShape(c);
  if (shape === 'circle') return { shape, radius: r2(hitRadius(c)) };
  return {
    shape,
    width: r2(c.w * (c.hit.scale || 1)),
    height: r2(c.h * (c.hit.scale || 1)),
  };
}

function spriteRef(name, doc) {
  const pressed = pressedName(name);
  return {
    sprite: name,
    file: spritePath(name, doc.style),
    pressedSprite: pressed,
    pressedFile: pressed ? pressedPath(name, doc.highlightSet) : null,
  };
}

/** Every file the layout references, for packaging or preloading. */
function assetList(doc) {
  const sprites = usedSprites(doc);
  const icons = usedIcons(doc);
  return {
    sprites: sprites.map(n => spritePath(n, doc.style)),
    pressed: sprites.map(n => pressedPath(n, doc.highlightSet)).filter(Boolean),
    icons: icons.map(n => iconPath(n)),
  };
}

export const toJSON = doc => JSON.stringify(serialize(doc), null, 2);

/* ═══════════════════════ import ═══════════════════════ */

/** Read an exported layout back in, tolerating hand-edited or partial files. */
export function deserialize(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!data || typeof data !== 'object') throw new Error('Not a layout file.');
  if (data.format && data.format !== SCHEMA) throw new Error(`Unknown format "${data.format}".`);
  if (!Array.isArray(data.controls)) throw new Error('No "controls" array in that file.');

  const ref = data.reference || {};
  const doc = makeDoc({
    name: data.name || 'Imported layout',
    style: (data.style && data.style.id) || 'a',
    highlightSet: (data.highlightSet && data.highlightSet.id) || 'a',
    reference: {
      width: num(ref.width, 1280),
      height: num(ref.height, 720),
      orientation: ref.orientation || (num(ref.width, 1280) >= num(ref.height, 720) ? 'landscape' : 'portrait'),
      device: ref.device || 'Custom',
      deviceId: ref.deviceId || 'generic-16-9',
    },
    safeArea: {
      top: num((data.safeArea || {}).top, 0), right: num((data.safeArea || {}).right, 0),
      bottom: num((data.safeArea || {}).bottom, 0), left: num((data.safeArea || {}).left, 0),
    },
  });
  if (data.background) doc.background = { ...doc.background, ...data.background };

  doc.controls = data.controls.map((raw, i) => importControl(raw, doc, i)).filter(Boolean);
  return doc;
}

const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
const knownSprite = name => SPRITES.some(s => s.name === name);

function importControl(src, doc, index) {
  const spriteName = (src.sprite && (src.sprite.sprite || src.sprite.name)) || src.spriteName || src.sprite;
  const name = typeof spriteName === 'string' && knownSprite(spriteName) ? spriteName : null;
  if (!name) {
    console.warn('[import] skipping control with unknown sprite', src.id || index, spriteName);
    return null;
  }

  const rect = src.rect || {};
  const centre = src.center || {};
  const w = num(rect.width, naturalSize(name).w);
  const h = num(rect.height, naturalSize(name).h);

  const c = makeControl(name, { type: src.type, x: 0, y: 0 });
  c.id = src.id || `control_${index + 1}`;
  c.label = src.label || c.id;
  c.action = src.action || '';
  c.w = w;
  c.h = h;
  c.rotation = num(src.rotation, 0);
  c.opacity = num(src.opacity, 1);
  c.hidden = !!src.hidden;
  c.anchor = typeof src.anchor === 'string' ? src.anchor : 'center';

  // Prefer the anchor offset: it is the part that survives a screen change.
  if (src.anchorOffset && Number.isFinite(src.anchorOffset.x)) {
    const a = anchorPoint(c.anchor, doc.reference);
    c.x = a.x + src.anchorOffset.x;
    c.y = a.y + src.anchorOffset.y;
  } else if (Number.isFinite(centre.x)) {
    c.x = centre.x;
    c.y = centre.y;
  } else if (src.normalized) {
    c.x = num(src.normalized.x, 0.5) * doc.reference.width;
    c.y = num(src.normalized.y, 0.5) * doc.reference.height;
  } else {
    c.x = num(rect.x, 0) + w / 2;
    c.y = num(rect.y, 0) + h / 2;
  }

  if (src.hit) {
    c.hit.shape = ['auto', 'circle', 'rect'].includes(src.hit.shape) ? src.hit.shape : 'auto';
    if (src.hit.shape === 'circle' && Number.isFinite(src.hit.radius)) {
      c.hit.scale = clamp(src.hit.radius / (Math.max(w, h) / 2), 0.25, 4);
    } else if (Number.isFinite(src.hit.width)) {
      c.hit.scale = clamp(src.hit.width / w, 0.25, 4);
    }
  }

  if (src.icon && src.icon.name) {
    c.icon = {
      name: src.icon.name,
      scale: Number.isFinite(src.icon.width) ? src.icon.width / Math.min(w, h) : 0.5,
      tint: src.icon.tint || '#ffffff',
      opacity: num(src.icon.opacity, 1),
      rotation: num(src.icon.rotation, 0),
      offsetX: src.icon.offset && Number.isFinite(src.icon.offset.x) ? src.icon.offset.x / w : 0,
      offsetY: src.icon.offset && Number.isFinite(src.icon.offset.y) ? src.icon.offset.y / h : 0,
    };
  }

  if (c.type === 'joystick' && src.stick) {
    const nubName = (src.stick.nub && (src.stick.nub.sprite || src.stick.nub.name)) || c.stick.nub;
    if (knownSprite(nubName)) c.stick.nub = nubName;
    if (src.stick.nub && Number.isFinite(src.stick.nub.width)) {
      c.stick.nubScale = clamp(src.stick.nub.width / w, 0.1, 1);
    }
    c.stick.travel = Number.isFinite(src.stick.travelRatio) ? src.stick.travelRatio
      : Number.isFinite(src.stick.travelRadius) ? clamp(src.stick.travelRadius / (w / 2), 0.05, 2)
      : c.stick.travel;
    c.stick.deadZone = num(src.stick.deadZone, c.stick.deadZone);
    c.stick.mode = src.stick.mode === 'floating' ? 'floating' : 'fixed';
    c.stick.highlight = ['nub', 'both', 'none'].includes(src.stick.highlight) ? src.stick.highlight : 'nub';
    c.stick.recenter = src.stick.recenter !== false;
    c.stick.invertY = !!src.stick.invertY;
    if (src.stick.axes) {
      c.stick.axisX = src.stick.axes.x || '';
      c.stick.axisY = src.stick.axes.y || '';
    }
  }

  if (c.type === 'dpad' && src.dpad) {
    c.dpad.layout = src.dpad.layout === 'composed' ? 'composed' : 'unified';
    c.dpad.diagonals = src.dpad.diagonals !== false;
    c.dpad.deadZone = num(src.dpad.deadZone, c.dpad.deadZone);
    if (src.dpad.actions) c.dpad.actions = { ...c.dpad.actions, ...src.dpad.actions };
    const first = Array.isArray(src.dpad.elements) ? src.dpad.elements[0] : null;
    if (first && Number.isFinite(first.width)) {
      c.dpad.elementScale = clamp(first.width / Math.min(w, h), 0.1, 1);
      if (first.offset && Number.isFinite(first.offset.y)) {
        c.dpad.gap = clamp((Math.abs(first.offset.y) - first.width / 2) / Math.min(w, h), 0, 0.5);
      }
    }
  }

  return c;
}

/* ═══════════════════════ raster ═══════════════════════ */

/**
 * Make sure every sprite this document draws is decoded before we render it.
 * `settle()` alone only waits for requests already in flight, so a layout the
 * stage has not drawn yet (just imported, or exported headlessly) would render
 * as empty placeholders.
 */
async function ensureLoaded(doc) {
  const jobs = usedSprites(doc).map(name => loadImage(spritePath(name, doc.style)));
  for (const c of doc.controls) {
    // Icons are cached per tint, so request them exactly as the renderer will.
    if (c.icon && c.icon.name) jobs.push(loadImage(iconPath(c.icon.name), c.icon.tint || null));
  }
  await Promise.allSettled(jobs);
  await settle();
}

/**
 * Render the layout to a PNG at the reference resolution.
 * @param {object} doc
 * @param {{scale?: number, background?: boolean}} [opts]
 */
export async function toPNG(doc, opts = {}) {
  const scale = opts.scale || 1;
  const background = opts.background !== false;
  await ensureLoaded(doc);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(doc.reference.width * scale);
  canvas.height = Math.round(doc.reference.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  drawLayout(ctx, doc, { background: background && doc.background.mode !== 'none', skipHidden: true });

  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not encode the PNG.'))), 'image/png');
  });
}

/* ═══════════════════════ vector ═══════════════════════ */

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** SVG export: one <g> per control, sprites embedded as data URIs. */
export async function toSVG(doc) {
  await ensureLoaded(doc);
  const ref = doc.reference;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${ref.width}" height="${ref.height}" viewBox="0 0 ${ref.width} ${ref.height}">`,
    `<title>${esc(doc.name)}</title>`,
    `<desc>Touch control layout, ${ref.width}x${ref.height}. Sprites: ${esc(PACK.name)} (${esc(PACK.license)}).</desc>`,
  ];

  if (doc.background.mode === 'gradient') {
    parts.push(
      `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${esc(doc.background.color)}"/>` +
      `<stop offset="1" stop-color="${esc(doc.background.color2)}"/></linearGradient></defs>`,
      `<rect width="${ref.width}" height="${ref.height}" fill="url(#bg)"/>`,
    );
  } else if (doc.background.mode === 'solid') {
    parts.push(`<rect width="${ref.width}" height="${ref.height}" fill="${esc(doc.background.color)}"/>`);
  }

  for (const c of doc.controls) {
    if (c.hidden) continue;
    const transform = `translate(${r2(c.x)} ${r2(c.y)})` + (c.rotation ? ` rotate(${r2(c.rotation)})` : '');
    parts.push(`<g id="${esc(c.id)}" data-type="${esc(c.type)}"${c.action ? ` data-action="${esc(c.action)}"` : ''}` +
      ` transform="${transform}"${(c.opacity ?? 1) !== 1 ? ` opacity="${c.opacity}"` : ''}>`);

    if (c.type === 'dpad' && c.dpad.layout === 'composed') {
      for (const elm of dpadElements(c)) {
        parts.push(imageTag(spritePath(elm.sprite, doc.style), elm.x, elm.y, elm.w, elm.h));
      }
    } else {
      parts.push(imageTag(spritePath(c.sprite, doc.style), 0, 0, c.w, c.h));
    }

    if (c.type === 'joystick') {
      const ns = nubSize(c);
      parts.push(imageTag(spritePath(c.stick.nub, doc.style), 0, 0, ns.w, ns.h));
    }

    if (c.icon && c.icon.name) {
      const nat = naturalSize(c.icon.name);
      const span = Math.min(c.w, c.h) * (c.icon.scale ?? 0.5);
      parts.push(imageTag(iconPath(c.icon.name), (c.icon.offsetX || 0) * c.w, (c.icon.offsetY || 0) * c.h,
        span, span * (nat.h / nat.w), c.icon.tint));
    }
    parts.push('</g>');
  }

  parts.push('</svg>');
  return parts.join('\n');
}

function imageTag(path, cx, cy, w, h, tint) {
  const img = image(path, tint || null);
  const href = img ? img.src : path;
  return `  <image x="${r2(cx - w / 2)}" y="${r2(cy - h / 2)}" width="${r2(w)}" height="${r2(h)}" ` +
    `href="${href}" preserveAspectRatio="none"/>`;
}

/* ═══════════════════════ bundle ═══════════════════════ */

/** JSON + PNG + SVG + the sprite files the layout uses, in one .zip. */
export async function toBundle(doc) {
  const data = serialize(doc);
  const png = await toPNG(doc, { scale: 2 });
  const svg = await toSVG(doc);
  const slug = slugify(doc.name);

  const files = [
    { name: `${slug}/layout.json`, data: JSON.stringify(data, null, 2) },
    { name: `${slug}/preview@2x.png`, data: new Uint8Array(await png.arrayBuffer()) },
    { name: `${slug}/preview.svg`, data: svg },
    { name: `${slug}/README.txt`, data: bundleReadme(doc, data) },
  ];

  const wanted = [...new Set([...data.assets.sprites, ...data.assets.pressed, ...data.assets.icons])];
  for (const path of wanted) {
    try {
      const res = await fetch(path);
      if (!res.ok) continue;
      files.push({ name: `${slug}/${path.replace(/^assets\//, 'sprites/')}`, data: await res.text() });
    } catch { /* a missing sprite should not sink the whole bundle */ }
  }

  return { blob: makeZip(files), filename: `${slug}.zip`, fileCount: files.length };
}

function bundleReadme(doc, data) {
  return [
    `${doc.name}`,
    `${'='.repeat(doc.name.length)}`,
    '',
    `Touch control layout for a ${data.reference.width}x${data.reference.height} ${data.reference.orientation} screen.`,
    `Exported ${data.exported} by Touch Layout Studio.`,
    '',
    'Contents',
    '--------',
    '  layout.json     every control: id, action, anchor, offset, size, hit area, stick travel',
    '  preview@2x.png  rendered preview',
    '  preview.svg     the same layout as vector art',
    '  sprites/        only the sprite files this layout references',
    '',
    'Positioning',
    '-----------',
    'Each control carries three positions. `anchorOffset` plus `anchor` is the one to',
    'use: it keeps a layout correct on screens of a different size. `center` and',
    '`normalized` are given for convenience against the reference resolution above.',
    '',
    'Sticks',
    '------',
    '`stick.travelRadius` is how far the nub may move from the pad centre, in reference',
    'pixels. Normalise the touch offset by it, clamp the length to 1, then apply',
    '`stick.deadZone` and rescale so the output still reaches 1.0 at the edge.',
    '',
    'Sprites',
    '-------',
    `${data.pack.name} by Kenney (kenney.nl), ${data.pack.license}.`,
    'Every style folder uses identical filenames, so swapping `style.dir` reskins the',
    'whole layout without touching any other field.',
    '',
  ].join('\n');
}

export const slugify = s =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'layout';
