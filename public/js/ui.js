/* Small DOM helpers shared by the panels. */

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k in node && k !== 'list' && typeof v !== 'object') node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const $ = sel => document.querySelector(sel);
export const $$ = sel => [...document.querySelectorAll(sel)];

export function toast(message, kind = '') {
  const node = el('div', { class: `toast ${kind}`.trim(), text: message });
  $('#toasts').append(node);
  setTimeout(() => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 220);
  }, kind === 'err' ? 5200 : 2600);
}

export function setStatus(parts) {
  const bar = $('#statusbar');
  if (!bar) return;
  bar.innerHTML = '';
  for (const [label, value] of parts) {
    bar.append(el('span', {}, [el('b', { text: label + ' ' }), String(value)]));
  }
}

/**
 * Hand a file to the user.
 *
 * A plain <a download> covers the normal case. Inside a published Artifact the
 * sandbox makes that inert, so ask the host to save the file instead — the
 * viewer gets a confirmation prompt and may decline.
 *
 * @returns {Promise<'saved'|'declined'|'linked'>}
 */
export async function download(blob, filename) {
  if (typeof window !== 'undefined' && window.claude && window.claude.use) {
    try {
      const downloads = await window.claude.use('downloads');
      if (downloads) {
        await downloads.save({ filename, data: blob });
        return 'saved';
      }
    } catch (err) {
      if (err && err.code === 'declined') return 'declined';
      if (err && err.code) {
        toast(`Could not save ${filename}: ${err.message || err.code}`, 'err');
        return 'declined';
      }
      // Anything else: fall through to the ordinary link.
    }
  }

  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'linked';
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = el('textarea', { value: text, style: 'position:fixed;opacity:0;' });
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

/** A labelled row for the inspector. */
export function row(label, control, opts = {}) {
  return el('div', { class: 'row' + (opts.two ? ' two' : '') }, [
    el('label', { text: label }),
    el('div', { class: 'ctl' }, [].concat(control)),
  ]);
}

export function sliderRow(label, { min, max, step, value, format, oninput }) {
  const out = el('output', { text: format ? format(value) : String(value) });
  const input = el('input', {
    type: 'range', min, max, step, value,
    oninput: e => {
      const v = parseFloat(e.target.value);
      out.textContent = format ? format(v) : String(v);
      oninput(v, e);
    },
  });
  return el('div', { class: 'slider-row' }, [el('label', { text: label }), input, out]);
}

export function checkRow(label, checked, onchange) {
  const id = 'chk-' + Math.random().toString(36).slice(2, 8);
  return el('div', { class: 'check-row' }, [
    el('input', { type: 'checkbox', id, checked, onchange: e => onchange(e.target.checked) }),
    el('label', { htmlFor: id, text: label }),
  ]);
}

export function numberInput(value, onchange, opts = {}) {
  return el('input', {
    type: 'number', value: round(value, opts.decimals ?? 1),
    min: opts.min, max: opts.max, step: opts.step ?? 1,
    onchange: e => {
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v)) onchange(v);
      else e.target.value = round(value, opts.decimals ?? 1);
    },
  });
}

const round = (n, d) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

export function section(title, body, extra) {
  return el('div', { class: 'insp-section' }, [
    el('h3', { class: 'insp-title' }, [title, extra]),
    ...[].concat(body),
  ]);
}
