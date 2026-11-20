// Shared helpers: SVG building, scales, tooltip, theme tokens, float16, WER alignment.
export const SVGNS = 'http://www.w3.org/2000/svg';

export function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k === 'text') n.textContent = v;
    else if (k === 'style') n.setAttribute('style', v);
    else n.setAttribute(k, v);
  }
  if (parent) parent.appendChild(n);
  return n;
}
export function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
export const lin = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
export const logs = (d0, d1, r0, r1) => { const a = Math.log10(d0), b = Math.log10(d1); return (v) => r0 + ((Math.log10(v) - a) / (b - a)) * (r1 - r0); };

export function fitW(container, min, max = 1400) {
  const cw = container.clientWidth || min;
  container.style.overflowX = cw < min ? 'auto' : '';
  return Math.round(Math.min(max, Math.max(min, cw)));
}
export function svg(container, w, h, label) {
  container.innerHTML = '';
  const s = el('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: 'chart', role: 'img', 'aria-label': label || '' }, container);
  s.style.width = w + 'px'; s.style.maxWidth = 'none'; s.style.height = 'auto';
  return s;
}
// re-run a draw function whenever its container changes width
export function responsive(container, draw) {
  let last = 0, t;
  draw();
  new ResizeObserver(() => {
    const w = container.clientWidth;
    if (Math.abs(w - last) < 4) return; last = w;
    clearTimeout(t); t = setTimeout(draw, 80);
  }).observe(container);
}

// ---- tooltip ----
const tipEl = () => document.getElementById('tip');
export function tip(evt, html) {
  const t = tipEl(); if (!t) return;
  t.innerHTML = html; t.hidden = false;
  const x = evt.clientX, y = evt.clientY;
  const w = t.offsetWidth, hgt = t.offsetHeight;
  t.style.left = Math.min(x, window.innerWidth - w - 24) + 'px';
  t.style.top = Math.min(y, window.innerHeight - hgt - 24) + 'px';
}
export function untip() { const t = tipEl(); if (t) t.hidden = true; }
export function hover(node, fn) {
  node.addEventListener('pointermove', (e) => tip(e, fn(e)));
  node.addEventListener('pointerleave', untip);
  node.addEventListener('pointerdown', (e) => tip(e, fn(e)));
}

// ---- theme tokens (for canvas) ----
export function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const g = (n) => cs.getPropertyValue(n).trim();
  return {
    bg: g('--bg'), bg2: g('--bg-2'), bg3: g('--bg-3'), line: g('--line'), line2: g('--line-2'),
    fg: g('--fg'), fg2: g('--fg-2'), fg3: g('--fg-3'), accent: g('--accent'), accent2: g('--accent-2'),
    whisper: g('--whisper'), parakeet: g('--parakeet'), cascade: g('--cascade'), err: g('--err'),
    pos: g('--pos'), neg: g('--neg'), ui: g('--font-body'), display: g('--font-display'),
  };
}
export function hexToRgb(c) {
  c = c.trim();
  if (c.startsWith('rgb')) { const m = c.match(/[\d.]+/g).map(Number); return [m[0], m[1], m[2]]; }
  if (c.length === 4) c = '#' + [...c.slice(1)].map((x) => x + x).join('');
  const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// diverging LUT: neg -> bg -> pos, 256 entries, input z in [-2.5, 2.5]
export function divergingLUT(T) {
  const neg = hexToRgb(T.neg), mid = hexToRgb(T.bg2), pos = hexToRgb(T.pos);
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255 * 2 - 1; const a = Math.pow(Math.abs(t), 0.85);
    const c = t < 0 ? mix(mid, neg, a) : mix(mid, pos, a);
    lut[i * 3] = c[0]; lut[i * 3 + 1] = c[1]; lut[i * 3 + 2] = c[2];
  }
  return lut;
}
// sequential saliency ramp, after the paper's magma map (stopping short of its yellow end).
// From the card surface towards more contrast: bright on dark themes, deep on light themes.
const MAGMA = ['#3b0f70', '#8c2981', '#de4968', '#f7845e', '#fbb48a'].map(hexToRgb);
export function seqColor(T, v) {
  const bg = hexToRgb(T.bg2), dark = luminance(bg) < 0.4;
  const stops = [bg, ...(dark ? MAGMA : [...MAGMA].reverse())];
  const x = Math.max(0, Math.min(1, v)) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x));
  const c = mix(stops[i], stops[i + 1], x - i);
  return `rgb(${c.map((q) => Math.round(q)).join(',')})`;
}
export function luminance([r, g, b]) { return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }

// ---- float16 -> float32 ----
const F16 = (() => {
  const t = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) {
    const s = i & 0x8000 ? -1 : 1, e = (i >> 10) & 0x1f, f = i & 0x3ff;
    t[i] = e === 0 ? s * Math.pow(2, -14) * (f / 1024) : e === 31 ? (f ? NaN : s * Infinity) : s * Math.pow(2, e - 15) * (1 + f / 1024);
  }
  return t;
})();
export function f16ToF32(u16) { const o = new Float32Array(u16.length); for (let i = 0; i < u16.length; i++) o[i] = F16[u16[i]]; return o; }

// ---- text normalisation + WER alignment (matches the paper's evaluation) ----
export function normalize(s) {
  s = s.replace(/[^a-zA-Z\- ']/g, '');
  s = s.replace(/- /g, ' ').toLowerCase().replace(/--/g, '').replace(/ '/g, "'").trim();
  return s.split(/\s+/).filter(Boolean).join(' ');
}
export function align(ref, hyp) {
  const r = ref ? ref.split(' ') : [], q = hyp ? hyp.split(' ') : [];
  const D = Array.from({ length: r.length + 1 }, (_, i) => { const a = new Array(q.length + 1).fill(0); a[0] = i; return a; });
  for (let j = 0; j <= q.length; j++) D[0][j] = j;
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= q.length; j++)
    D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (r[i - 1] === q[j - 1] ? 0 : 1));
  const ops = []; let i = r.length, j = q.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (r[i - 1] === q[j - 1] ? 0 : 1)) { ops.push({ op: r[i - 1] === q[j - 1] ? 'ok' : 'sub', ref: r[i - 1], hyp: q[j - 1] }); i--; j--; }
    else if (j > 0 && D[i][j] === D[i][j - 1] + 1) { ops.push({ op: 'ins', hyp: q[j - 1] }); j--; }
    else { ops.push({ op: 'del', ref: r[i - 1] }); i--; }
  }
  ops.reverse();
  return { ops, errors: D[r.length][q.length], n: r.length };
}
export function renderDiff(container, ref, hyp) {
  const { ops, errors, n } = align(ref, hyp);
  container.innerHTML = '';
  for (const o of ops) {
    if (container.childNodes.length) container.append(' ');
    if (o.op === 'ok') container.append(h('span', { class: 'w' }, o.hyp));
    else if (o.op === 'sub') container.append(h('span', { class: 'w sub', title: `cue: “${o.ref}”` }, o.hyp));
    else if (o.op === 'ins') container.append(h('span', { class: 'w ins', title: 'inserted' }, o.hyp));
    else container.append(h('span', { class: 'w del', title: 'missed' }, o.ref));
  }
  return { errors, n };
}
export const fmtMs = (ms) => ms >= 1000 ? (ms / 1000).toFixed(ms >= 10000 ? 1 : 2) + ' s' : (ms >= 100 ? Math.round(ms) : ms.toFixed(ms >= 10 ? 1 : 2)) + ' ms';
export const prefersReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
