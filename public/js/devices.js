/* Reference screens. Sizes are logical (CSS) points in landscape; the editor
 * swaps width/height for portrait. Safe-area insets are the landscape values
 * for devices with a notch or home indicator. */

export const DEVICES = [
  { id: 'generic-16-9',   name: 'Generic 16:9',        w: 1280, h: 720,  safe: { top: 0, right: 0,  bottom: 0,  left: 0  } },
  { id: 'generic-19-5-9', name: 'Generic 19.5:9',      w: 1560, h: 720,  safe: { top: 0, right: 0,  bottom: 0,  left: 0  } },
  { id: 'iphone-se',      name: 'iPhone SE',           w: 667,  h: 375,  safe: { top: 0, right: 0,  bottom: 0,  left: 0  } },
  { id: 'iphone-15',      name: 'iPhone 15',           w: 852,  h: 393,  safe: { top: 0, right: 59, bottom: 21, left: 59 } },
  { id: 'iphone-15-max',  name: 'iPhone 15 Pro Max',   w: 932,  h: 430,  safe: { top: 0, right: 59, bottom: 21, left: 59 } },
  { id: 'pixel-8',        name: 'Pixel 8',             w: 892,  h: 412,  safe: { top: 0, right: 48, bottom: 16, left: 48 } },
  { id: 'galaxy-s24',     name: 'Galaxy S24',          w: 915,  h: 412,  safe: { top: 0, right: 44, bottom: 16, left: 44 } },
  { id: 'ipad-11',        name: 'iPad Pro 11"',        w: 1194, h: 834,  safe: { top: 0, right: 0,  bottom: 20, left: 0  } },
  { id: 'ipad-mini',      name: 'iPad mini',           w: 1133, h: 744,  safe: { top: 0, right: 0,  bottom: 20, left: 0  } },
  { id: 'steam-deck',     name: 'Steam Deck',          w: 1280, h: 800,  safe: { top: 0, right: 0,  bottom: 0,  left: 0  } },
  { id: 'hd-1080',        name: '1080p',               w: 1920, h: 1080, safe: { top: 0, right: 0,  bottom: 0,  left: 0  } },
];

export const deviceById = id => DEVICES.find(d => d.id === id) || DEVICES[0];

/** Reference block for a device in the given orientation. */
export function referenceFor(id, orientation) {
  const d = deviceById(id);
  const portrait = orientation === 'portrait';
  const s = d.safe;
  return {
    device: d.name,
    deviceId: d.id,
    orientation: portrait ? 'portrait' : 'landscape',
    width: portrait ? d.h : d.w,
    height: portrait ? d.w : d.h,
    safe: portrait
      // Rotating moves the notch to the top and the home indicator stays at the bottom.
      ? { top: Math.max(s.left, s.right), right: 0, bottom: s.bottom, left: 0 }
      : { ...s },
  };
}
