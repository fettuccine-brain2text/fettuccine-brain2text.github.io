// Method figures: cascade vs. FETTUCCINE pipeline diagram, and the word-level augmentation sandbox.
import { svg, el, h, tokens, divergingLUT } from './util.js';

const $ = (id) => document.getElementById(id);

export function pipeline() {
  const box = $('pipeDiagram');
  box.style.overflowX = 'auto';
  const inner = h('div', { style: 'min-width:720px' }); box.innerHTML = ''; box.append(inner);
  const W = 1060, H = 262;
  const s = svg(inner, W, H, 'Cascaded decoder compared with FETTUCCINE');
  s.style.width = '100%';   // scale the fixed-size drawing to the card
  el('defs', {}, s).innerHTML = '<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" style="fill:var(--fg-3)"/></marker>';
  const box_ = (x, y, w, hh, title, sub, kind) => {
    const trained = kind === 'trained', lora = kind === 'lora';
    el('rect', { x, y, width: w, height: hh, rx: 7, style: `fill:${trained ? 'var(--accent-wash)' : 'var(--bg-3)'};stroke:${trained ? 'var(--accent)' : 'var(--line-2)'};stroke-width:1.5` }, s);
    el('text', { x: x + w / 2, y: y + hh / 2 - (sub ? 4 : -4), 'text-anchor': 'middle', style: 'font-family:var(--font-display);font-size:16px;font-weight:600;fill:var(--fg)', text: title }, s);
    if (sub) el('text', { x: x + w / 2, y: y + hh / 2 + 16, 'text-anchor': 'middle', text: sub }, s);
    if (lora) {
      el('rect', { x: x + w - 54, y: y - 10, width: 50, height: 20, rx: 10, style: 'fill:var(--accent);stroke:var(--bg-2);stroke-width:2' }, s);
      el('text', { x: x + w - 29, y: y + 4, 'text-anchor': 'middle', style: 'fill:var(--accent-ink);font-size:10px', text: '+LoRA' }, s);
    }
  };
  const arrow = (x1, y, x2) => el('line', { x1, y1: y, x2: x2 - 3, y2: y, style: 'stroke:var(--fg-3);stroke-width:1.5', 'marker-end': 'url(#arr)' }, s);
  // row labels
  const rows = [
    { y: 34, label: 'Cascade', note: 'workstation · ~320 GB · up to 16 s per sentence', color: 'var(--cascade)' },
    { y: 176, label: 'FETTUCCINE', note: 'phone · 209 MB · 48 ms per sentence', color: 'var(--accent)' },
  ];
  for (const r of rows) {
    el('text', { x: 0, y: r.y - 12, style: `fill:${r.color};font-size:13px;font-weight:600`, text: r.label }, s);
    el('text', { x: W, y: r.y - 12, 'text-anchor': 'end', text: r.note }, s);
  }
  const bh = 74, y1 = 34, y2 = 176;
  // shared input
  const inX = 0, inW = 130;
  for (const y of [y1, y2]) {
    el('rect', { x: inX, y, width: inW, height: bh, rx: 7, style: 'fill:var(--bg);stroke:var(--line-2);stroke-dasharray:4 3' }, s);
    el('text', { x: inX + inW / 2, y: y + 32, 'text-anchor': 'middle', style: 'font-family:var(--font-display);font-size:15px;font-weight:600;fill:var(--fg)', text: 'Neural data' }, s);
    el('text', { x: inX + inW / 2, y: y + 52, 'text-anchor': 'middle', text: '512 × T · 50 Hz' }, s);
  }
  // cascade
  const cw = 170, gap = 34; let x = inW + gap;
  box_(x, y1, cw, bh, 'GRU', 'phoneme probabilities', 'trained'); arrow(inW, y1 + bh / 2, x); x += cw + gap;
  box_(x, y1, cw, bh, '5-gram LM', 'WFST search · ~300 GB', 'frozen'); arrow(x - gap, y1 + bh / 2, x); x += cw + gap;
  box_(x, y1, cw, bh, 'LLM rescoring', 'OPT-6.7B', 'frozen'); arrow(x - gap, y1 + bh / 2, x); x += cw + gap;
  const outX = x;
  // fettuccine
  x = inW + gap;
  box_(x, y2, cw, bh, 'Neural Adapter', '1D U-Net · ~6 M', 'trained'); arrow(inW, y2 + bh / 2, x); x += cw + gap;
  box_(x, y2, cw, bh, 'ASR encoder', 'frozen weights', 'lora'); arrow(x - gap, y2 + bh / 2, x); x += cw + gap;
  box_(x, y2, cw, bh, 'ASR decoder', 'frozen · BPE text', 'frozen'); arrow(x - gap, y2 + bh / 2, x); x += cw + gap;
  // outputs
  for (const [y, txt] of [[y1, 'text'], [y2, 'text']]) {
    arrow(outX - gap, y + bh / 2, outX);
    el('rect', { x: outX, y: y + 12, width: W - outX, height: bh - 24, rx: 7, style: 'fill:var(--bg);stroke:var(--line-2)' }, s);
    el('text', { x: outX + (W - outX) / 2, y: y + bh / 2 + 5, 'text-anchor': 'middle', style: 'font-family:var(--font-display);font-size:15px;fill:var(--fg)', text: '“how are you doing”' }, s);
  }
}

// ------------------------------------------------------------------ augmentation sandbox
export function initAugment(A) {
  const cv = $('augCanvas'), ctx = cv.getContext('2d');
  const on = { warp: true, gain: true, crop: false };
  const R = A.R, F = A.F; // rows x frames (50 Hz), values 0..255 (z mapped)
  const rows = Uint8Array.from(atob(A.rows), (c) => c.charCodeAt(0));
  let aug = null;
  const randn = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const U = (a, b) => a + Math.random() * (b - a);

  function segments() { // alternating silence/word segments covering [0, F)
    const seg = []; let pos = 0;
    A.wb.forEach(([s, e], i) => { if (s > pos) seg.push({ kind: 'sil', s: pos, e: s }); seg.push({ kind: 'word', s, e, w: A.words[i], i }); pos = e; });
    if (pos < F) seg.push({ kind: 'sil', s: pos, e: F });
    return seg;
  }
  // Random draws are made once per "Resample"; the toggles only switch them on or off,
  // so turning an augmentation off and on again shows the same sample.
  let P = null;
  function sample() {
    // the crop toggle should always show a crop: keep between a third of the words and all but one
    const n = A.words.length, lo = Math.max(1, Math.round(n / 3)), hi = Math.max(lo, n - 1);
    const keep = n > 1 ? lo + Math.floor(Math.random() * (hi - lo + 1)) : 1;
    P = {
      seg: segments().map((sg) => ({ f: sg.kind === 'word' ? U(0.5, 2.0) : U(0.3, 3.0), g: sg.kind === 'word' ? 1 + 0.6 * randn() : 1 })),
      crop: { k: keep, start: Math.floor(Math.random() * (n - keep + 1)) },
    };
    apply();
  }
  function apply() {
    let seg = segments().map((sg, j) => ({ ...sg, j }));
    let words = A.words.slice();
    if (on.crop) {
      const { k, start } = P.crop;
      const wi = seg.filter((sg) => sg.kind === 'word').map((sg) => sg.j);
      const a = wi[start], b = wi[start + k - 1];
      seg = seg.slice(Math.max(0, a - 1), Math.min(seg.length, b + 2));
      words = A.words.slice(start, start + k);
    }
    const out = seg.map((sg) => {
      const f = on.warp ? P.seg[sg.j].f : 1, g = on.gain ? P.seg[sg.j].g : 1;
      return { ...sg, f, g, len: Math.max(1, Math.round((sg.e - sg.s) * f)) };
    });
    aug = { seg: out, words };
    draw();
  }
  function render(segs, totalF, y, hh, T, lut, x0, w, scaleF) {
    const img = new ImageData(totalF, R); let col = 0;
    for (const sg of segs) {
      const len = sg.len ?? (sg.e - sg.s), g = sg.g ?? 1;
      for (let j = 0; j < len; j++, col++) {
        const src = sg.s + (len > 1 ? (j / (len - 1)) * (sg.e - sg.s - 1) : 0);
        const a = Math.floor(src), b = Math.min(sg.e - 1, a + 1), t = src - a;
        for (let r = 0; r < R; r++) {
          let z = ((rows[r * F + a] * (1 - t) + rows[r * F + b] * t) - 127.5) / 127.5 * g;
          z = Math.max(-1, Math.min(1, z));
          const li = Math.round((z + 1) * 127.5) * 3, o = (r * totalF + col) * 4;
          img.data[o] = lut[li]; img.data[o + 1] = lut[li + 1]; img.data[o + 2] = lut[li + 2]; img.data[o + 3] = 255;
        }
      }
    }
    const oc = document.createElement('canvas'); oc.width = totalF; oc.height = R; oc.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(oc, x0, y, w * (totalF / scaleF), hh);
    // word labels
    ctx.font = `500 12px ${T.display}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; col = 0;
    const lanes = [-1e9, -1e9];
    for (const sg of segs) {
      const len = sg.len ?? (sg.e - sg.s);
      if (sg.kind === 'word') {
        const xa = x0 + (col / scaleF) * w, xb = x0 + ((col + len) / scaleF) * w, xm = (xa + xb) / 2, tw = ctx.measureText(sg.w).width;
        const lane = xm - tw / 2 < lanes[0] + 4 ? 1 : 0; lanes[lane] = xm + tw / 2;
        ctx.fillStyle = T.line2; ctx.fillRect(xa, y - 6, Math.max(1, xb - xa - 2), 2);
        ctx.fillStyle = T.fg2; ctx.fillText(sg.w, xm, y - 9 - lane * 14);
      }
      col += len;
    }
  }
  function draw() {
    const T = tokens(), lut = divergingLUT(T), dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = cv.clientWidth || 600, cssH = 260;
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr); cv.style.height = cssH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cssW, cssH);
    const x0 = 72, w = cssW - x0 - 8, hh = 78;
    const orig = segments();
    const augF = aug.seg.reduce((a, sg) => a + sg.len, 0);
    const scaleF = Math.max(F, augF);
    ctx.font = `500 11px ${T.ui}`; ctx.fillStyle = T.fg3; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('original', 0, 40 + hh / 2); ctx.fillText('augmented', 0, 168 + hh / 2);
    render(orig, F, 40, hh, T, lut, x0, w, scaleF);
    render(aug.seg, augF, 168, hh, T, lut, x0, w, scaleF);
    ctx.font = `400 10px ${T.ui}`; ctx.fillStyle = T.fg3; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const st = (w / (scaleF / 50)) * 2 >= 40 ? 2 : 4;
    for (let sec = 0; sec <= scaleF / 50; sec += st) ctx.fillText(sec + ' s', x0 + (sec * 50 / scaleF) * w, 168 + hh + 4);
  }
  document.querySelectorAll('[data-aug]').forEach((b) => b.addEventListener('click', () => {
    on[b.dataset.aug] = !on[b.dataset.aug]; b.setAttribute('aria-pressed', String(on[b.dataset.aug])); apply();
  }));
  $('augBtn').addEventListener('click', sample);
  window.addEventListener('themechange', () => aug && draw());
  let rt; new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => aug && draw(), 120); }).observe(cv);
  sample();
}
