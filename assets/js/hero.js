// Hero phone: replays a recorded trial (spike-band power, 4 arrays), shows a typing indicator,
// then the sentence FETTUCCINE decoded, with the latency measured on the iPhone for that trial.
import { hexToRgb, prefersReduced, sleep } from './util.js';

// the phone keeps its own dark palette in both site themes
const NEG = hexToRgb('#3d8fd6'), MID = hexToRgb('#000000'), POS = hexToRgb('#f2b04a');
const LUT = (() => {
  const l = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255 * 2 - 1, a = Math.pow(Math.abs(t), 0.85), c = t < 0 ? NEG : POS;
    for (let k = 0; k < 3; k++) l[i * 3 + k] = MID[k] + (c[k] - MID[k]) * a;
  }
  return l;
})();
const KEEP = 3;   // messages kept on screen

function rowsOf(b64) {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

export async function initHero(data) {
  const phone = document.getElementById('phone');
  const chat = document.getElementById('phChat');
  const state = document.getElementById('phState');
  const clock = document.getElementById('phTime');
  const cv = document.getElementById('phRaster'), ctx = cv.getContext('2d');
  const trials = data.trials.map((t) => ({ ...t, u: rowsOf(t.rows) }));

  let visible = true;
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe(phone);
  requestAnimationFrame(() => phone.classList.add('in'));

  // full-resolution image of each trial, built once
  const full = trials.map((t) => {
    const img = new ImageData(t.F, t.R);
    for (let i = 0; i < t.R * t.F; i++) { const v = t.u[i] * 3; img.data.set([LUT[v], LUT[v + 1], LUT[v + 2], 255], i * 4); }
    const c = document.createElement('canvas'); c.width = t.F; c.height = t.R; c.getContext('2d').putImageData(img, 0, 0);
    return c;
  });

  let shown = null;   // last frame drawn, redrawn after a resize (resizing clears the canvas)
  function size() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(cv.clientWidth * dpr), hgt = Math.round(cv.clientHeight * dpr);
    if (w === cv.width && hgt === cv.height) return;
    cv.width = w; cv.height = hgt;
    if (shown) draw(...shown);
  }
  size(); new ResizeObserver(size).observe(cv);

  function draw(k, frac) {
    shown = [k, frac];
    const t = trials[k], W = cv.width, H = cv.height;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const sx = Math.max(1, Math.round(t.F * frac)), dw = W * (sx / t.F);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(full[k], 0, 0, sx, t.R, 0, 0, dw, H);
    ctx.fillStyle = '#000';
    for (let a = 1; a < 4; a++) ctx.fillRect(0, Math.round(a * H / 4) - 1, W, 2);   // gaps between the 4 arrays
    if (frac < 1) { ctx.fillStyle = '#fff'; ctx.fillRect(Math.min(W - 2, dw), 0, 2, H); }
  }

  function message(text, ms) {
    const m = document.createElement('div'); m.className = 'ph-msg';
    const b = document.createElement('div'); b.className = 'ph-bubble'; b.textContent = text;
    const meta = document.createElement('div'); meta.className = 'ph-meta'; meta.innerHTML = `decoded in <b>${Math.round(ms)} ms</b>`;
    m.append(b, meta);
    return m;
  }
  function typing() {
    const m = document.createElement('div'); m.className = 'ph-msg ph-typing';
    m.innerHTML = '<div class="ph-bubble" aria-label="decoding"><i></i><i></i><i></i></div>';
    return m;
  }
  function push(node) {
    [...chat.children].forEach((c) => c.classList.add('ph-old'));
    chat.append(node);
    while (chat.children.length > KEEP) chat.firstElementChild.remove();
  }
  const setState = (txt, done) => { state.lastChild.textContent = txt; state.classList.toggle('done', !!done); };

  if (prefersReduced()) {
    trials.slice(0, KEEP).forEach((t) => push(message(t.decoded, t.iphone_ms)));
    draw(KEEP - 1, 1); setState('Decoded', true); clock.textContent = trials[KEEP - 1].dur.toFixed(1) + ' s';
    return;
  }
  // start mid-conversation: the previous sentence is already on screen
  const prev = trials[trials.length - 1]; push(message(prev.decoded, prev.iphone_ms));
  await sleep(500);
  for (let i = 0; ; i++) {
    const k = i % trials.length, t = trials[k];
    const playMs = 1000 * Math.min(6, Math.max(3, t.dur / 3));   // 3–6 s per sentence on screen
    setState('Listening');
    let t0 = performance.now(), last = t0;
    await new Promise((res) => {
      const step = (now) => {
        if (!visible) t0 += now - last;   // pause while off screen
        last = now;
        const frac = Math.min(1, (now - t0) / playMs);
        draw(k, frac); clock.textContent = (frac * t.dur).toFixed(1) + ' s';
        frac < 1 ? requestAnimationFrame(step) : res();
      };
      requestAnimationFrame(step);
    });
    setState('Decoding');
    const dots = typing(); push(dots);
    await sleep(900);
    dots.replaceWith(message(t.decoded, t.iphone_ms));
    setState('Decoded', true);
    await sleep(2600);
    while (!visible) await sleep(400);
  }
}
