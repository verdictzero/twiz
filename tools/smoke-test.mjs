/* End-to-end smoke test for Touch Layout Studio.
 *
 *   python3 -m http.server 8899 --directory public &
 *   npm i -D playwright && npx playwright install chromium
 *   node tools/smoke-test.mjs [http://127.0.0.1:8899/]
 *
 * Covers the things that are easy to break silently: the stick maths, exports
 * of a layout the canvas has not drawn yet, anchor behaviour across a device
 * change, and a JSON round trip.
 */

import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://127.0.0.1:8899/';
let failures = 0;

const check = (label, pass, detail = '') => {
  if (!pass) failures++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const consoleErrors = [];
page.on('pageerror', e => consoleErrors.push(e.message));
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(900);

/* ── the app came up ───────────────────────────────────────────────── */

check('page boots with the default layout',
  (await page.evaluate(async () => (await import('./js/store.js')).state.doc.controls.length)) > 0);
check('sprite library is populated',
  (await page.locator('.pal-item').count()) > 40);

/* ── stick maths ───────────────────────────────────────────────────── */

const stick = await page.evaluate(async () => {
  const { state, setUI, loadDoc } = await import('./js/store.js');
  const { buildExample } = await import('./js/examples.js');
  const { playPointerDown, playPointerMove, playPointerUp, playInput } = await import('./js/play.js');

  loadDoc(buildExample('platformer'));
  setUI({ play: true });
  const c = state.doc.controls.find(x => x.type === 'joystick');
  const r = (c.w / 2) * c.stick.travel;
  const origin = { x: c.x, y: c.y };
  const fake = { pointerId: 1, target: { setPointerCapture() {} } };

  const read = (fx, fy) => {
    playPointerDown(fake, origin);
    playPointerMove(fake, { x: origin.x + fx * r, y: origin.y + fy * r });
    const v = playInput().get(c.id).value;
    playPointerUp(fake);
    return v;
  };

  const out = {
    deadZone: read(c.stick.deadZone * 0.5, 0),     // inside the dead zone
    clamped: read(4, 0),                            // far past the travel ring
    diagonal: read(3, -3),                          // clamped diagonal
    released: (playPointerUp(fake), playInput().has(c.id)),
  };
  setUI({ play: false });
  return out;
});

check('dead zone suppresses small movement',
  stick.deadZone.x === 0 && stick.deadZone.y === 0);
check('past the travel ring clamps to 1.0',
  Math.abs(stick.clamped.x - 1) < 1e-9 && Math.abs(stick.clamped.y) < 1e-9);
check('clamped diagonal has unit length',
  Math.abs(Math.hypot(stick.diagonal.x, stick.diagonal.y) - 1) < 1e-9,
  `${stick.diagonal.x.toFixed(3)}, ${stick.diagonal.y.toFixed(3)}`);
check('stick releases cleanly', stick.released === false);

/* ── exports of a layout the canvas never drew ─────────────────────── */

const exports_ = await page.evaluate(async () => {
  const { buildExample } = await import('./js/examples.js');
  const { toPNG, toSVG, toBundle } = await import('./js/export.js');
  const { image, spritePath, iconPath } = await import('./js/assets.js');
  const { usedSprites } = await import('./js/render.js');

  const doc = buildExample('twin-stick');       // never rendered on the stage
  const png = await toPNG(doc, { scale: 1 });
  const svg = await toSVG(doc);
  const bundle = await toBundle(doc);

  return {
    pngBytes: png.size,
    missingSprites: usedSprites(doc).filter(n => !image(spritePath(n, doc.style))).length,
    missingIcons: doc.controls.filter(c => c.icon && c.icon.name)
      .filter(c => !image(iconPath(c.icon.name), c.icon.tint || null)).length,
    svgEmbedded: !/href="assets\//.test(svg),
    svgImages: (svg.match(/<image/g) || []).length,
    bundleFiles: bundle.fileCount,
  };
});

check('PNG export of an unrendered layout has its sprites',
  exports_.missingSprites === 0 && exports_.missingIcons === 0 && exports_.pngBytes > 20000,
  `${Math.round(exports_.pngBytes / 1024)}kB`);
check('SVG embeds every sprite as a data URI',
  exports_.svgEmbedded && exports_.svgImages > 0, `${exports_.svgImages} images`);
check('bundle collects layout, preview and sprites',
  exports_.bundleFiles > 8, `${exports_.bundleFiles} files`);

/* ── anchors survive a device change ───────────────────────────────── */

const anchors = await page.evaluate(async () => {
  const { state, loadDoc, commit } = await import('./js/store.js');
  const { buildExample } = await import('./js/examples.js');
  const { anchorOffset, setReference } = await import('./js/model.js');
  const { referenceFor } = await import('./js/devices.js');

  loadDoc(buildExample('platformer'));
  const before = state.doc.controls.map(c => ({ id: c.id, a: c.anchor, o: anchorOffset(c, state.doc.reference) }));
  commit(doc => setReference(doc, referenceFor('ipad-11', 'portrait')), 'test');
  const after = state.doc.controls.map(c => ({ id: c.id, a: c.anchor, o: anchorOffset(c, state.doc.reference) }));
  return before.every((b, i) => after[i].a === b.a
    && Math.abs(after[i].o.x - b.o.x) < 0.01 && Math.abs(after[i].o.y - b.o.y) < 0.01);
});
check('anchor offsets survive a device + orientation change', anchors);

/* ── JSON round trip ───────────────────────────────────────────────── */

const roundTrip = await page.evaluate(async () => {
  const { buildExample } = await import('./js/examples.js');
  const { serialize, deserialize } = await import('./js/export.js');
  const key = d => d.controls.map(c =>
    [c.id, c.type, c.sprite, Math.round(c.x), Math.round(c.y), Math.round(c.w), Math.round(c.h),
     c.anchor, c.stick ? `${c.stick.nub}/${c.stick.travel}/${c.stick.deadZone}/${c.stick.mode}` : '',
     c.dpad ? `${c.dpad.layout}/${c.dpad.diagonals}` : '', c.icon ? c.icon.name : ''].join(':')).join('|');

  return ['platformer', 'twin-stick', 'racer', 'portrait-rpg', 'retro-dpad', 'composed'].map(id => {
    const doc = buildExample(id);
    return { id, same: key(doc) === key(deserialize(JSON.stringify(serialize(doc)))) };
  });
});
for (const r of roundTrip) check(`round trip preserves "${r.id}"`, r.same);

/* ── no console noise ──────────────────────────────────────────────── */

check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
