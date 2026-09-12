/* Sprite loading.
 *
 * Every sprite is fetched once as text, optionally recoloured, then handed to
 * an <img> through a data: URI. Data URIs keep the export canvas untainted, so
 * `toBlob()` works no matter where the site is hosted. */

import { MANIFEST } from '../assets/manifest.js';
import { SPRITE_SOURCES } from '../assets/sprites.js';

const BASE = 'assets/vector';

export const STYLES = MANIFEST.styles;
export const HIGHLIGHT_SETS = MANIFEST.highlightSets;
export const SPRITES = MANIFEST.sprites;
export const ICONS = MANIFEST.icons;
export const PACK = { name: MANIFEST.pack, license: MANIFEST.license, source: MANIFEST.source };

const spriteByName = new Map(SPRITES.map(s => [s.name, s]));
const iconByName = new Map(ICONS.map(i => [i.name, i]));
const styleById = new Map(STYLES.map(s => [s.id, s]));
const highlightById = new Map(HIGHLIGHT_SETS.map(h => [h.id, h]));

export const spriteInfo = name => spriteByName.get(name) || null;
export const iconInfo = name => iconByName.get(name) || null;
export const styleInfo = id => styleById.get(id) || STYLES[0];
export const highlightInfo = id => highlightById.get(id) || HIGHLIGHT_SETS[0];

/** Sprites of a group, e.g. `spritesOf('joystick_pad')`. */
export const spritesOf = group => SPRITES.filter(s => s.group === group);

/** Natural pixel size of any sprite or icon. */
export function naturalSize(name) {
  const s = spriteByName.get(name) || iconByName.get(name);
  return s ? { w: s.w, h: s.h } : { w: 64, h: 64 };
}

/* ── paths ──────────────────────────────────────────────────────────── */

export const spritePath = (name, styleId) => `${BASE}/${styleInfo(styleId).dir}/${name}.svg`;
export const highlightPath = (name, setId) => `${BASE}/${highlightInfo(setId).dir}/${name}.svg`;
export const iconPath = name => `${BASE}/icons/${name}.svg`;

/** Pressed-state path for a sprite, or null when the sprite has no highlight. */
export function pressedPath(name, setId) {
  const info = spriteByName.get(name);
  return info && info.highlight ? highlightPath(info.highlight, setId) : null;
}
export const pressedName = name => (spriteByName.get(name) || {}).highlight || null;

/* ── loading ────────────────────────────────────────────────────────── */

const textCache = new Map();   // url  -> Promise<string>
const imageCache = new Map();  // key  -> { img, ready }
const listeners = new Set();

/** Called whenever a new sprite finishes loading, so the stage can redraw. */
export function onAssetLoad(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const notify = () => listeners.forEach(fn => fn());

/** `assets/vector/style-a/button_circle.svg` -> `style-a/button_circle` */
const bundleKey = url => {
  const at = url.indexOf(`${BASE}/`);
  return at < 0 ? null : url.slice(at + BASE.length + 1).replace(/\.svg$/, '');
};

/** The SVG source for a sprite path, from the bundle or (failing that) the network. */
export function spriteSource(url) {
  const key = bundleKey(url);
  return key && key in SPRITE_SOURCES ? SPRITE_SOURCES[key] : null;
}

function fetchText(url) {
  let p = textCache.get(url);
  if (!p) {
    // Every sprite ships inlined, so this normally resolves without a request.
    const inlined = spriteSource(url);
    p = inlined != null
      ? Promise.resolve(inlined)
      : fetch(url).then(r => {
          if (!r.ok) throw new Error(`${r.status} ${url}`);
          return r.text();
        });
    textCache.set(url, p);
  }
  return p;
}

/* Kenney's icons are solid #FFFFFF (a handful use gradients); swapping those
 * colours is all it takes to recolour one. */
function tintSvg(svg, colour) {
  return svg
    .replace(/fill="#FFFFFF"/gi, `fill="${colour}"`)
    .replace(/stop-color="#[0-9A-Fa-f]{3,8}"/g, `stop-color="${colour}"`);
}

const keyFor = (url, tint) => (tint ? `${url}|${tint}` : url);

/** UTF-8 safe base64, without the deprecated escape/unescape pair. */
function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** Load a sprite, resolving to a decoded <img>. */
export function loadImage(url, tint = null) {
  const key = keyFor(url, tint);
  const hit = imageCache.get(key);
  if (hit) return hit.promise;

  const entry = { img: null, ready: false, failed: false };
  entry.promise = fetchText(url)
    .then(svg => {
      const src = 'data:image/svg+xml;base64,' + base64(tint ? tintSvg(svg, tint) : svg);
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { entry.img = img; entry.ready = true; resolve(img); notify(); };
        img.onerror = () => reject(new Error(`decode failed: ${url}`));
        img.src = src;
      });
    })
    .catch(err => { entry.failed = true; console.warn('[assets]', err.message); return null; });

  imageCache.set(key, entry);
  return entry.promise;
}

const dataUrlCache = new Map();

/**
 * A `src` for an <img> in the editor chrome, built from the inlined bundle so
 * the panels need no network at all. Falls back to the file path if a sprite
 * somehow is not in the bundle.
 */
export function imgSrc(url, tint = null) {
  const key = keyFor(url, tint);
  let hit = dataUrlCache.get(key);
  if (hit === undefined) {
    const src = spriteSource(url);
    hit = src == null ? url : 'data:image/svg+xml;base64,' + base64(tint ? tintSvg(src, tint) : src);
    dataUrlCache.set(key, hit);
  }
  return hit;
}

/** Synchronous accessor for the render loop — returns null until loaded. */
export function image(url, tint = null) {
  if (!url) return null;
  const key = keyFor(url, tint);
  const hit = imageCache.get(key);
  if (hit) return hit.ready ? hit.img : null;
  loadImage(url, tint);
  return null;
}

/** True once every sprite requested so far has settled. */
export function pendingCount() {
  let n = 0;
  for (const e of imageCache.values()) if (!e.ready && !e.failed) n++;
  return n;
}

/** Wait for every in-flight load — used before exporting an image. */
export async function settle() {
  for (let i = 0; i < 8 && pendingCount(); i++) {
    await Promise.allSettled([...imageCache.values()].map(e => e.promise));
  }
}

/** Warm the cache for a whole style so switching styles feels instant. */
export function preloadStyle(styleId, names) {
  (names || SPRITES.map(s => s.name)).forEach(n => loadImage(spritePath(n, styleId)));
}
