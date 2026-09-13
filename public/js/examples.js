/* Ready-made layouts. They double as documentation: every one of them uses
 * anchors, hit areas and stick travel the way a real game would. */

import { makeDoc, makeControl, nearestAnchor, round2, backdropFor } from './model.js';
import { referenceFor } from './devices.js';

/** Build a control and patch the bits the presets care about. */
function ctl(sprite, ref, opts) {
  const c = makeControl(sprite, { type: opts.type, x: opts.x, y: opts.y, scale: opts.scale });
  c.id = opts.id;
  c.label = opts.label || opts.id;
  c.action = opts.action ?? opts.id;
  c.anchor = opts.anchor || nearestAnchor(opts.x, opts.y, ref);
  if (opts.size) {
    const k = opts.size / c.w;
    c.w = round2(opts.size);
    c.h = round2(c.h * k);
  }
  if (opts.icon) {
    c.icon = { name: opts.icon, scale: opts.iconScale ?? 0.5, tint: opts.tint || '#ffffff', opacity: 1, rotation: opts.iconRotation || 0, offsetX: 0, offsetY: 0 };
  }
  if (opts.hitScale) c.hit.scale = opts.hitScale;
  if (opts.rotation) c.rotation = opts.rotation;
  if (opts.opacity != null) c.opacity = opts.opacity;
  if (c.stick && opts.stick) Object.assign(c.stick, opts.stick);
  if (c.dpad && opts.dpad) Object.assign(c.dpad, opts.dpad);
  if (opts.nub) c.stick.nub = opts.nub;
  return c;
}

function base(name, deviceId, orientation, style) {
  const ref = referenceFor(deviceId, orientation);
  const doc = makeDoc({
    name,
    style: style || 'a',
    reference: { width: ref.width, height: ref.height, orientation: ref.orientation, device: ref.device, deviceId: ref.deviceId },
    safeArea: { ...ref.safe },
    background: backdropFor(style || 'a'),
  });
  return { doc, ref: doc.reference };
}

/* ── presets ────────────────────────────────────────────────────────── */

function platformer() {
  const { doc, ref } = base('Platformer', 'iphone-15', 'landscape', 'a');
  doc.controls = [
    ctl('joystick_circle_pad_a', ref, {
      id: 'move', type: 'joystick', x: 150, y: 280, size: 168, hitScale: 1.15,
      stick: { travel: 0.42, deadZone: 0.18, axisX: 'move_x', axisY: 'move_y' },
    }),
    ctl('button_circle', ref, {
      id: 'jump', x: 735, y: 300, size: 104, icon: 'icon_jump', iconScale: 0.5, hitScale: 1.2,
    }),
    ctl('button_circle', ref, {
      id: 'attack', x: 615, y: 255, size: 92, icon: 'icon_sword', iconScale: 0.5, hitScale: 1.2,
    }),
    ctl('button_circle', ref, {
      id: 'dash', x: 735, y: 185, size: 76, icon: 'icon_arrow', iconScale: 0.5, hitScale: 1.2, opacity: 0.92,
    }),
    ctl('button_square', ref, {
      id: 'pause', x: 762, y: 40, size: 56, icon: 'icon_pause', iconScale: 0.45, opacity: 0.8,
    }),
  ];
  return doc;
}

function twinStick() {
  const { doc, ref } = base('Twin-stick shooter', 'ipad-11', 'landscape', 'h');
  doc.controls = [
    ctl('joystick_polygon_pad_a', ref, {
      id: 'move', type: 'joystick', x: 200, y: 620, size: 200, hitScale: 1.1,
      stick: { travel: 0.45, deadZone: 0.2, axisX: 'move_x', axisY: 'move_y' },
    }),
    ctl('joystick_polygon_pad_a', ref, {
      id: 'aim', type: 'joystick', x: 994, y: 620, size: 200, hitScale: 1.1,
      stick: { travel: 0.45, deadZone: 0.25, mode: 'floating', axisX: 'aim_x', axisY: 'aim_y' },
    }),
    ctl('button_circle_wide', ref, {
      id: 'shoulder_left', action: 'grenade', x: 130, y: 70, size: 132, icon: 'icon_button_l', iconScale: 0.4,
    }),
    ctl('button_circle_wide', ref, {
      id: 'shoulder_right', action: 'reload', x: 1064, y: 70, size: 132, icon: 'icon_button_r', iconScale: 0.4,
    }),
    ctl('button_circle', ref, {
      id: 'fire', x: 994, y: 400, size: 96, icon: 'icon_burst', iconScale: 0.5, hitScale: 1.25,
    }),
    ctl('button_circle', ref, {
      id: 'shield', x: 200, y: 400, size: 84, icon: 'icon_shield', iconScale: 0.5, hitScale: 1.2,
    }),
  ];
  return doc;
}

function racer() {
  const { doc, ref } = base('Racer', 'pixel-8', 'landscape', 'f');
  doc.controls = [
    ctl('direction_left', ref, {
      id: 'steer_left', action: 'steer_left', x: 120, y: 320, size: 116, hitScale: 1.3,
    }),
    ctl('direction_right', ref, {
      id: 'steer_right', action: 'steer_right', x: 280, y: 320, size: 116, hitScale: 1.3,
    }),
    ctl('button_circle', ref, {
      id: 'accelerate', x: 778, y: 320, size: 124, icon: 'icon_pedal', iconScale: 0.5, hitScale: 1.2,
    }),
    ctl('button_circle', ref, {
      id: 'brake', x: 630, y: 250, size: 96, icon: 'icon_pedal_brake', iconScale: 0.5, hitScale: 1.2,
    }),
    ctl('button_bean', ref, {
      id: 'handbrake', x: 760, y: 180, size: 104, icon: 'icon_arrow_rotate', iconScale: 0.42,
    }),
    ctl('button_square', ref, {
      id: 'look_back', x: 446, y: 60, size: 56, icon: 'icon_arrow_curved', iconScale: 0.45, opacity: 0.8,
    }),
  ];
  return doc;
}

function portraitRpg() {
  const { doc, ref } = base('Portrait RPG', 'iphone-15', 'portrait', 'g');
  // 393 points across is tight, and a hexagon is taller than it is wide — so its
  // touch area is a rectangle, not a circle, and needs more room than it looks.
  // The skills stack up the right edge rather than ringing the attack button.
  doc.controls = [
    ctl('joystick_hexagon_pad_b', ref, {
      id: 'move', type: 'joystick', x: 92, y: 740, size: 144, hitScale: 1.15,
      stick: { travel: 0.44, deadZone: 0.18, mode: 'floating', axisX: 'move_x', axisY: 'move_y' },
    }),
    ctl('button_hexagon', ref, {
      id: 'attack', x: 300, y: 748, size: 96, icon: 'icon_sword', iconScale: 0.5, hitScale: 1.15,
    }),
    ctl('button_hexagon', ref, {
      id: 'skill_1', x: 300, y: 618, size: 72, icon: 'icon_fire', iconScale: 0.5, hitScale: 1.15,
    }),
    ctl('button_hexagon', ref, {
      id: 'skill_2', x: 196, y: 540, size: 72, icon: 'icon_star', iconScale: 0.5, hitScale: 1.15,
    }),
    ctl('button_hexagon', ref, {
      id: 'potion', x: 300, y: 500, size: 68, icon: 'icon_shield', iconScale: 0.5, hitScale: 1.15,
    }),
    ctl('button_square', ref, {
      id: 'menu', x: 330, y: 100, size: 56, icon: 'icon_menu', iconScale: 0.45, opacity: 0.85,
    }),
    ctl('button_square', ref, {
      id: 'bag', x: 264, y: 100, size: 56, icon: 'icon_key', iconScale: 0.45, opacity: 0.85,
    }),
  ];
  return doc;
}

function dpadRetro() {
  const { doc, ref } = base('Retro d-pad', 'galaxy-s24', 'landscape', 'b');
  doc.controls = [
    ctl('dpad', ref, {
      id: 'dpad', type: 'dpad', x: 150, y: 300, size: 184, hitScale: 1.05,
      dpad: { diagonals: true, deadZone: 0.22, actions: { north: 'up', south: 'down', west: 'left', east: 'right' } },
    }),
    ctl('button_circle', ref, {
      id: 'button_a', action: 'confirm', x: 810, y: 322, size: 88, icon: 'icon_button_a', iconScale: 0.45, hitScale: 1.2,
    }),
    ctl('button_circle', ref, {
      id: 'button_b', action: 'cancel', x: 700, y: 268, size: 88, icon: 'icon_button_b', iconScale: 0.45, hitScale: 1.2,
    }),
    ctl('button_square_wide', ref, {
      id: 'start', x: 512, y: 358, size: 104, icon: 'icon_play', iconScale: 0.34, opacity: 0.9,
    }),
    ctl('button_square_wide', ref, {
      id: 'select', x: 392, y: 358, size: 104, icon: 'icon_menu', iconScale: 0.34, opacity: 0.9,
    }),
  ];
  return doc;
}

function composedStick() {
  const { doc, ref } = base('Composed parts', 'generic-16-9', 'landscape', 'e');
  doc.controls = [
    ctl('joystick_square_pad_c', ref, {
      id: 'move', type: 'joystick', x: 220, y: 500, size: 220, hitScale: 1.1,
      nub: 'joystick_square_nub_b',
      stick: { travel: 0.5, deadZone: 0.12, axisX: 'move_x', axisY: 'move_y' },
    }),
    ctl('dpad', ref, {
      id: 'camera', type: 'dpad', x: 1060, y: 500, size: 200,
      dpad: { layout: 'composed', elementScale: 0.42, gap: 0.08, diagonals: false, deadZone: 0.3,
              actions: { north: 'cam_up', south: 'cam_down', west: 'cam_left', east: 'cam_right' } },
    }),
    ctl('button_diamond', ref, {
      id: 'interact', x: 830, y: 420, size: 96, icon: 'icon_hand', iconScale: 0.45, hitScale: 1.2,
    }),
    ctl('button_diamond', ref, {
      id: 'talk', x: 730, y: 340, size: 84, icon: 'icon_talk', iconScale: 0.45, hitScale: 1.2,
    }),
  ];
  return doc;
}

export const EXAMPLES = [
  { id: 'platformer', name: 'Platformer', note: 'Stick + face buttons, iPhone landscape', build: platformer },
  { id: 'twin-stick', name: 'Twin-stick shooter', note: 'Two sticks, one floating, iPad', build: twinStick },
  { id: 'racer', name: 'Racer', note: 'Split steering and pedals, Pixel', build: racer },
  { id: 'portrait-rpg', name: 'Portrait RPG', note: 'Floating stick + skill ring, portrait', build: portraitRpg },
  { id: 'retro-dpad', name: 'Retro d-pad', note: 'D-pad, A/B, start and select', build: dpadRetro },
  { id: 'composed', name: 'Composed parts', note: 'Square stick + four-arm d-pad', build: composedStick },
];

export const buildExample = id => {
  const found = EXAMPLES.find(e => e.id === id);
  return found ? found.build() : platformer();
};
