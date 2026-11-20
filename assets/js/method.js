// Method figures: the FETTUCCINE architecture (Whisper or Parakeet), and the word-level augmentation sandbox.
import { tokens, divergingLUT } from './util.js';

const $ = (id) => document.getElementById(id);

// Component names and sizes follow the paper (Sec. 3, Appendix D, Tables 7 and 9).
const ARCH = {
  whisper: {
    adapter: '1D U-Net · 6 M parameters',
    enc: 'Whisper encoder', encSub: 'Transformer',
    dec: 'Whisper decoder', decSub: 'Transformer, text tokens',
    bb: 'Whisper, pretrained on speech · Tiny, Base, Small, Large v3 Turbo',
    cap: 'Trained in two stages with a cross-entropy loss: the adapter alone, then the adapter with LoRA. The recognizer’s own weights stay frozen.',
  },
  parakeet: {
    adapter: 'Convolutional subsampling · 8× · 5 M parameters',
    enc: 'FastConformer encoder', encSub: 'Conformer',
    dec: 'Transducer decoder', decSub: 'TDT or RNN-T',
    bb: 'Parakeet, pretrained on speech · TDT 0.6B v2, EOU 120M',
    cap: 'Trained in two stages with the transducer loss: the adapter alone, then the adapter with LoRA. The recognizer’s own weights stay frozen.',
  },
};
export function pipeline() {
  const set = (k) => {
    const A = ARCH[k];
    document.querySelectorAll('#method [data-a]').forEach((n) => { n.textContent = A[n.dataset.a]; });
    document.querySelectorAll('[data-arch]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.arch === k)));
  };
  document.querySelectorAll('[data-arch]').forEach((b) => b.addEventListener('click', () => set(b.dataset.arch)));
  set('whisper');
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
