// Live demo + interpretability + lesion test. Shared state: the selected trial.
import { h, tokens, divergingLUT, seqColor, f16ToF32, normalize, renderDiff, fmtMs, hover, svg, el, logs, sleep, prefersReduced, fitW, responsive } from './util.js';

const KS = [0, 1, 2, 4, 8, 16, 32, 64, 128, 256];
const ARRAYS = [ // display order follows the paper's figures. xy: array site in the brain figure; color: paper Fig. 5
  { name: '55b', base: 128, region: 'middle precentral gyrus', xy: [675, 78], color: '#cf5a9b' },
  { name: 'd6v', base: 192, region: 'dorsal 6v (premotor)', xy: [657, 143], color: '#3a9160' },
  { name: 'area 4', base: 64, region: 'primary motor cortex', xy: [618, 232], color: '#3d84c4' },
  { name: 'v6v', base: 0, region: 'ventral 6v (premotor)', xy: [596, 293], color: '#7cc596' },
];
const CFG = window.FETTUCCINE || {};
const BASE = 'assets/';

const S = {
  index: null, site: null, cur: null, cache: new Map(), feat: 'sbp',
  engine: 'idle', worker: null, jobs: new Map(), jobSeq: 0, loading: null,
  word: 'sentence', order: 'top', kIdx: 5, custom: new Set(),
};
const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ data
async function loadTrial(meta) {
  if (S.cache.has(meta.id)) return S.cache.get(meta.id);
  const [bin, js] = await Promise.all([
    fetch(BASE + 'data/' + meta.bin).then((r) => r.arrayBuffer()).then(gunzip),
    fetch(BASE + 'data/' + meta.json).then((r) => r.json()),
  ]);
  const x = f16ToF32(new Uint16Array(bin)); // [T, 512] time-major
  const t = { meta, x, ...js };
  S.cache.set(meta.id, t);
  return t;
}
async function gunzip(buf) { // trial files are gzip-compressed (float16 [T, 512])
  const u8 = new Uint8Array(buf);
  if (!(u8[0] === 0x1f && u8[1] === 0x8b)) return buf;
  return new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
function modelInput(t, drop) {
  const T = t.meta.T, buf = new Float32Array(512 * 1500);
  const dropped = new Uint8Array(256); if (drop) for (const e of drop) dropped[e] = 1;
  for (let f = 0; f < T; f++) {
    const row = f * 512;
    for (let c = 0; c < 512; c++) if (!dropped[c & 255]) buf[c * 1500 + f] = t.x[row + c];
  }
  return buf;
}

// ------------------------------------------------------------------ engine
// States: idle (not downloaded) -> loading -> live, or replay (live model disabled/unavailable).
// Until the live model is ready, Decode plays the saved output of the same model, labelled as such.
const MODEL_BASE = () => new URL(BASE + 'model/', location.href).href;
const VENDOR_BASE = () => new URL(BASE + 'vendor/', location.href).href;
const mb = (b) => Math.round(b / 1e6);
// Backend choice: 'auto' measures GPU vs CPU at load time. Overrides for comparing devices:
// ?backend=cpu|gpu (both graphs), ?enc=…, ?dec=…, ?threads=N
const Q = new URLSearchParams(location.search), pick = (v) => (/^(cpu|gpu|auto)$/.test(v || '') ? v : null);
const PREFER = { enc: pick(Q.get('enc')) || pick(Q.get('backend')) || CFG.backend || 'auto',
                 dec: pick(Q.get('dec')) || pick(Q.get('backend')) || CFG.backend || 'auto' };
const THREADS = +Q.get('threads') || 0;

function setEngine(state, text, detail) {
  S.engine = state;
  $('engineChip').className = 'chip' + (state === 'live' ? ' live' : state === 'loading' ? ' loading' : state === 'replay' ? ' replay' : '');
  $('engineText').textContent = text;
  $('engineChip').title = detail || '';
  $('loadModelBtn').hidden = state !== 'idle';
}
async function modelCached(man) {
  try {
    if (!window.caches) return false;
    const c = await caches.open('fettuccine-model-' + man.version);
    const has = async (urls) => { for (const u of urls) if (!(await c.match(u))) return false; return true; };
    const runtime = (await has(man.wasm.parts.map((p) => VENDOR_BASE() + p))) || (man.wasm_gpu && await has(man.wasm_gpu.parts.map((p) => VENDOR_BASE() + p)));
    return runtime && has([MODEL_BASE() + 'tokenizer.json', ...man.encoder.parts.map((p) => MODEL_BASE() + p), ...man.decoder.parts.map((p) => MODEL_BASE() + p)]);
  } catch (e) { return false; }
}
function ensureModel() {
  if (S.loading) return S.loading;
  if (S.engine === 'replay') return Promise.resolve(false);
  const bar = $('loadBar'); bar.hidden = false; bar.firstElementChild.style.width = '0%';
  setEngine('loading', 'Preparing model…');
  S.loading = new Promise((resolve) => {
    let single = false;
    try { single = localStorage.getItem('fettuccine-threads') === '1'; } catch (e) { /* storage blocked */ }
    const timer = setTimeout(() => fallback('timed out'), 300000);
    let w, watchdog;
    function fallback(why) {
      clearTimeout(timer); clearTimeout(watchdog); bar.hidden = true; console.warn('[fettuccine] live model unavailable:', why);
      setEngine('replay', 'Saved outputs', 'The live model could not start in this browser');
      resolve(false);
    }
    function start(threads) {
      try { w = new Worker(new URL('./decoder.worker.js', import.meta.url), { type: 'module' }); }
      catch (e) { fallback(String(e)); return; }
      S.worker = w;
      w.onerror = (e) => fallback(e.message || 'worker error');
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'progress') {
          bar.firstElementChild.style.width = Math.round(100 * m.loaded / m.total) + '%';
          $('engineText').textContent = m.cached ? 'Loading model from this device…' : `Downloading model · ${mb(m.loaded)} / ${mb(m.total)} MB`;
        } else if (m.type === 'stage' && m.stage === 'runtime-start') {
          // Some browsers never start a multi-threaded runtime inside a worker: retry with one thread.
          if (m.threads > 1) watchdog = setTimeout(() => {
            console.warn('[fettuccine] multi-threaded runtime did not start; retrying with one thread');
            try { localStorage.setItem('fettuccine-threads', '1'); } catch (e) { /* ignore */ }
            w.terminate(); start(1);
          }, 8000);
        } else if (m.type === 'stage' && m.stage === 'runtime-ok') {
          clearTimeout(watchdog);
        } else if (m.type === 'stage') {
          bar.firstElementChild.style.width = '100%';
          $('engineText').textContent = 'Starting the decoder…';
        } else if (m.type === 'ready') {
          clearTimeout(timer); bar.hidden = true;
          S.place = { enc: m.enc, dec: m.dec };
          const cpu = `CPU (${m.threads} thread${m.threads > 1 ? 's' : ''})`, where = (p) => (p === 'webgpu' ? 'GPU' : cpu);
          S.where = m.enc === 'webgpu' || m.dec === 'webgpu' ? 'GPU' : 'CPU';
          setEngine('live', `Live · your ${S.where}`, 'Whisper Tiny, int8 · ' + (m.enc === m.dec
            ? (m.enc === 'webgpu' ? 'WebGPU' : cpu + ', WebAssembly')
            : `encoder on ${where(m.enc)}, decoder on ${where(m.dec)}`) + ' · model saved in this browser');
          if (m.bench && Object.keys(m.bench).length) console.info('[fettuccine] backend timings (ms):', m.bench, '→', S.place);
          if (S.playedSaved) $('decodeNote').textContent = 'Model ready. Decode again to run it here.';
          w.onmessage = onWorker; resolve(true);
        } else if (m.type === 'error') fallback(m.message);
      };
      w.postMessage({ type: 'load', base: MODEL_BASE(), vendor: VENDOR_BASE(), prefer: PREFER, threads });
    }
    start(THREADS || (single ? 1 : 0));
  });
  return S.loading;
}
async function initEngine() {
  if (CFG.live === false) { setEngine('replay', 'Saved outputs', 'Live decoding is turned off on this site'); return; }
  let man;
  try { man = await (await fetch(BASE + 'model/manifest.json', { cache: 'no-cache' })).json(); }
  catch (e) { setEngine('replay', 'Saved outputs', 'Live model not included on this site'); return; }
  S.manifest = man;
  const rt = 'gpu' in navigator && man.wasm_gpu && (PREFER.enc !== 'cpu' || PREFER.dec !== 'cpu') ? man.wasm_gpu : man.wasm;
  man.total_bytes = man.encoder.bytes + man.decoder.bytes + rt.bytes + man.tokenizer_bytes;
  if (await modelCached(man)) { ensureModel(); return; }           // already on this device: start it
  $('loadModelBtn').lastElementChild.textContent = `Download · ${mb(man.total_bytes)} MB`;
  setEngine('idle', 'Model not downloaded', `Runs in this browser. ${mb(man.total_bytes)} MB, downloaded once.`);
  const conn = navigator.connection;
  const goodNet = !(conn && (conn.saveData || /2g/.test(conn.effectiveType || '')));
  if (CFG.prefetch !== false && matchMedia('(pointer: fine)').matches && goodNet) {
    new IntersectionObserver((es, ob) => { if (es.some((x) => x.isIntersecting)) { ob.disconnect(); ensureModel(); } }, { threshold: 0.3 }).observe($('raster'));
  }
}
function savedNote() {
  if (S.engine === 'loading') return 'saved output while the model downloads';
  if (S.engine === 'idle') return 'saved output; download the model to run it here';
  return 'saved output';
}
function onWorker(e) {
  const m = e.data, job = S.jobs.get(m.jobId); if (!job) return;
  if (m.type === 'encoded') job.onEncoded?.(m);
  else if (m.type === 'token') job.onToken?.(m);
  else if (m.type === 'done') { S.jobs.delete(m.jobId); job.resolve(m); }
  else if (m.type === 'error') { S.jobs.delete(m.jobId); job.reject(new Error(m.message)); }
}
function runLive(features, hooks = {}) {
  const jobId = ++S.jobSeq;
  return new Promise((resolve, reject) => {
    S.jobs.set(jobId, { ...hooks, resolve, reject });
    S.worker.postMessage({ type: 'decode', features, jobId }, [features.buffer]);
  });
}

// ------------------------------------------------------------------ raster
function drawRaster(t) {
  const cv = $('raster'), ctx = cv.getContext('2d');
  const T = tokens(), lut = divergingLUT(T), dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = cv.clientWidth || 800, cssH = 300;
  cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr); cv.style.height = cssH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = T.bg2; ctx.fillRect(0, 0, cssW, cssH);
  const left = 72, right = 14, top = 12, rh = 196, ey = top + rh + 12, eh = 52;
  const w = cssW - left - right, Tn = t.meta.T, off = S.feat === 'sbp' ? 256 : 0;
  // image: 256 rows (4 arrays x 64) x T
  const img = new ImageData(Tn, 256);
  const clampZ = S.feat === 'sbp' ? 1.4 : 1.6;
  let r = 0;
  for (const a of ARRAYS) for (let e = 0; e < 64; e++, r++) {
    const ch = off + a.base + e;
    // light temporal smoothing (5-bin running mean) for legibility; the model sees the raw features
    for (let f = 0; f < Tn; f++) {
      let acc = 0, cnt = 0;
      for (let d = -2; d <= 2; d++) { const g = f + d; if (g >= 0 && g < Tn) { acc += t.x[g * 512 + ch]; cnt++; } }
      let v = (acc / cnt) / clampZ; v = v < -1 ? -1 : v > 1 ? 1 : v;
      const li = Math.round((v + 1) * 127.5) * 3, o = (r * Tn + f) * 4;
      img.data[o] = lut[li]; img.data[o + 1] = lut[li + 1]; img.data[o + 2] = lut[li + 2]; img.data[o + 3] = 255;
    }
  }
  const oc = document.createElement('canvas'); oc.width = Tn; oc.height = 256; oc.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.drawImage(oc, left, top, w, rh);
  ctx.font = `500 11px ${T.ui}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ARRAYS.forEach((a, i) => {
    ctx.fillStyle = T.fg3; ctx.fillText(a.name, left - 10, top + (i + 0.5) * rh / 4);
    if (i) { ctx.fillStyle = T.bg2; ctx.fillRect(left, top + i * rh / 4 - 1, w, 2); }
  });
  const xs = (f) => left + (f / Tn) * w;
  // estimated word regions + envelope
  // estimated word boundaries (shaded), placed where the envelope's activity is highest (paper, Sec. 3)
  for (const [s, e] of t.wb || []) { ctx.fillStyle = T.bg3; ctx.fillRect(xs(s), ey, xs(e) - xs(s), eh); }
  ctx.fillStyle = T.fg3; ctx.fillText('envelope', left - 10, ey + eh / 2);
  const env = t.env; ctx.beginPath();
  for (let i = 0; i < env.length; i++) { const x = left + (i / (env.length - 1)) * w, y = ey + eh - (env[i] / 255) * (eh - 6) - 3; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.strokeStyle = T.fg2; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.font = `400 10px ${T.ui}`; ctx.fillStyle = T.fg3; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const step = tickStep(w, t.meta.dur);
  for (let s = 0; s <= t.meta.dur; s += step) ctx.fillText(s + ' s', xs(s * 50), ey + eh + 6);
}

function tickStep(wPx, dur) {
  for (const st of [1, 2, 4, 5, 10]) if ((wPx / dur) * st >= 44) return st;
  return 10;
}

// ------------------------------------------------------------------ demo
function renderTrialList() {
  const list = $('trialList'); list.innerHTML = '';
  for (const m of S.index.trials) {
    const b = h('button', { class: 'trial', type: 'button', role: 'listitem', 'aria-pressed': 'false', 'data-id': m.id },
      h('span', { class: 'meta' }, h('span', {}, m.session), h('span', {}, m.dur.toFixed(1) + ' s')),
      h('span', { class: 'cue' }, m.cue));
    b.addEventListener('click', () => select(m.id));
    list.append(b);
  }
}
async function select(id) {
  const meta = S.index.trials.find((m) => m.id === id);
  document.querySelectorAll('.trial').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
  $('cueText').textContent = meta.cue; $('lesionCue').textContent = meta.cue;
  $('outText').innerHTML = '<span class="placeholder">Press decode</span>';
  $('lesionOut').innerHTML = '<span class="placeholder">—</span>'; $('lesionNote').textContent = '';
  $('speakBtn').disabled = true; $('decodeNote').textContent = ''; $('decodeNote').title = '';
  const t = await loadTrial(meta); S.cur = t;
  drawRaster(t);
  S.word = 'sentence'; renderWordChips(); renderArrays(); drawTimeSal();
}

async function decodeCurrent() {
  const t = S.cur; if (!t) return;
  const btn = $('decodeBtn'); btn.disabled = true;
  const out = $('outText');
  const live = S.engine === 'live';
  out.innerHTML = live ? '<span class="placeholder">Decoding…</span>' : '';
  let text, encMs, decMs, steps;
  if (live) {
    let lastLen = 0;
    const res = await runLive(modelInput(t), {
      onToken: (m) => {
        const words = normalize(m.text).split(' ').filter(Boolean);
        if (words.length !== lastLen) {
          out.innerHTML = ''; words.forEach((w, i) => out.append(h('span', { class: 'w' + (i >= lastLen ? ' new' : '') }, w))); lastLen = words.length;
        }
      },
    }).catch((e) => { console.error(e); return null; });
    if (res) { text = res.text; encMs = res.encMs; decMs = res.decMs; steps = res.steps; }
  }
  if (text === undefined) { // replay
    const words = normalize(t.decode.text).split(' ');
    out.innerHTML = '';
    for (let i = 0; i < words.length; i++) { out.append(h('span', { class: 'w new' }, words[i])); await sleep(prefersReduced() ? 0 : 60); }
    text = t.decode.text;
  }
  const hyp = normalize(text);
  const { errors, n } = renderDiff(out, t.meta.cue, hyp);
  const errs = `${errors} of ${n} words wrong`, note = $('decodeNote');
  if (encMs !== undefined) {
    // time in this browser only; see the note at the bottom of the page
    note.textContent = `${errs} · ${fmtMs(encMs + decMs)} on your ${S.where || 'device'}` + (hyp === normalize(t.decode.text) ? '' : ' · differs slightly from the saved output (a near tie)');
    note.title = `neural encoder ${fmtMs(encMs)} + text decoder ${fmtMs(decMs)} (${steps} tokens)`;
  } else {
    S.playedSaved = true;
    note.textContent = `${errs} · ${savedNote()}`; note.title = '';
  }
  $('speakBtn').disabled = !('speechSynthesis' in window);
  S.lastText = hyp;
  btn.disabled = false;
}

// ------------------------------------------------------------------ interpretability
function salVector() {
  const t = S.cur;
  const raw = S.word === 'global' ? S.site.saliency.elec
    : (S.word === 'sentence' || !t) ? t.sal_spatial_all.map((v) => v / 255) : t.sal_spatial[S.word].map((v) => v / 255);
  // contrast stretch between the 10th and 99th percentile, then a gentle gamma so hot spots stand out
  const srt = [...raw].sort((a, b) => a - b), lo = srt[25], hi = srt[253] || 1;
  return raw.map((v) => Math.pow(Math.min(1, Math.max(0, (v - lo) / (hi - lo || 1))), 1.3));
}
function droppedSet() {
  if (S.order === 'custom') return S.custom;
  const k = KS[S.kIdx];
  if (S.order === 'top') return new Set(S.site.saliency.rank.slice(0, k));
  return new Set(S.site.lesion.rand_sets[String(k)] || []);
}
function renderWordChips() {
  const box = $('wordChips'); box.innerHTML = '';
  const t = S.cur;
  const mk = (key, label) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(S.word === key) }, label);
    b.addEventListener('click', () => { S.word = key; renderWordChips(); renderArrays(); drawTimeSal(); });
    return b;
  };
  (t.words || []).forEach((wd, i) => box.append(mk(i, wd.w)));
  box.append(h('span', { class: 'sep' }), mk('sentence', 'Whole sentence'), mk('global', 'All 200 sentences'));
}
function renderArrays() {
  const box = $('arrays'); const T = tokens();
  const v = salVector(), drop = droppedSet();
  const rankPos = new Map(S.site.saliency.rank.map((e, i) => [e, i + 1]));
  if (!box.childElementCount) {
    for (const a of ARRAYS) {
      const g = h('div', { class: 'grid8', role: 'group', 'aria-label': `Array ${a.name}` });
      for (let i = 0; i < 64; i++) {
        const e = a.base + i;
        const b = h('button', { type: 'button', 'data-e': e, 'aria-label': `Electrode ${e} in ${a.name}` });
        b.addEventListener('click', () => {
          if (S.order !== 'custom') setOrder('custom', true);
          S.custom.has(e) ? S.custom.delete(e) : S.custom.add(e); renderArrays(); updateK();
        });
        hover(b, () => `<b>Electrode ${e}</b> · ${a.name}<br>${a.region}<br>rank ${rankPos.get(e)} of 256 across 200 sentences<br><span style="opacity:.7">click to silence</span>`);
        g.append(b);
      }
      const arr = h('div', { class: 'array', 'data-a': a.name }, h('div', { class: 'an', style: `--arr:${a.color}` }, h('b', {}, a.name), h('span', {}, a.region.split(' (')[0])), g);
      arr.addEventListener('pointerenter', () => highlightArray(a.name));
      arr.addEventListener('pointerleave', () => highlightArray(null));
      box.append(arr);
    }
    renderBrain();
  }
  box.querySelectorAll('button[data-e]').forEach((b) => {
    const e = +b.dataset.e; b.style.background = seqColor(T, Math.min(1, v[e]));
    b.classList.toggle('off', drop.has(e));
  });
  ARRAYS.forEach((a) => {
    let m = 0; for (let i = 0; i < 64; i++) m += Math.min(1, v[a.base + i]);
    $('brain').querySelector(`[data-a="${a.name}"] rect`).style.fill = seqColor(T, m / 64);
  });
  $('cbarSwatch').style.background = `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((x) => seqColor(T, x)).join(',')})`;
}
// T15's brain with the four arrays (images from paper Fig. 5A): the whole hemisphere, a zoom on the
// arrays, and a square on each array site that shows the array's mean saliency.
function renderBrain() {
  const box = $('brain');
  const s = el('svg', { viewBox: '0 0 1000 360', role: 'img', 'aria-label': 'Left hemisphere of participant T15 with the four electrode arrays: 55b on the middle precentral gyrus, d6v and v6v on ventral premotor cortex, and area 4 on primary motor cortex' }, box);
  el('image', { href: BASE + 'img/t15_brain.webp', x: 0, y: 26, width: 360, height: 308.5, class: 'b-img' }, s);
  el('rect', { x: 108, y: 82, width: 111, height: 99, rx: 3, class: 'b-box' }, s);
  el('line', { x1: 219, y1: 82, x2: 450, y2: 10, class: 'b-link' }, s);
  el('line', { x1: 219, y1: 181, x2: 450, y2: 350, class: 'b-link' }, s);
  el('clipPath', { id: 'bZoomClip' }, el('defs', {}, s)).append(el('rect', { x: 450, y: 10, width: 380, height: 340, rx: 12 }));
  el('image', { href: BASE + 'img/t15_brain_zoom.webp', x: 450, y: 10, width: 380, height: 340, 'clip-path': 'url(#bZoomClip)', class: 'b-img' }, s);
  el('rect', { x: 450, y: 10, width: 380, height: 340, rx: 12, class: 'b-frame' }, s);
  for (const a of ARRAYS) {
    const [x, y] = a.xy, m = el('g', { class: 'mk', 'data-a': a.name }, s);
    el('line', { x1: x + 14, y1: y, x2: 846, y2: y, class: 'b-lead' }, m);
    el('rect', { x: x - 12, y: y - 12, width: 24, height: 24, rx: 3 }, m);
    el('text', { x: 852, y: y + 1, class: 'b-name', style: `fill:${a.color}`, text: a.name }, m);
    el('text', { x: 852, y: y + 18, class: 'b-region', text: a.region.split(' (')[0] }, m);
    m.addEventListener('pointerenter', () => highlightArray(a.name));
    m.addEventListener('pointerleave', () => highlightArray(null));
    hover(m, () => `<b>${a.name}</b> · ${a.region}<br>64 electrodes<br><span style="opacity:.7">color: mean saliency of the array</span>`);
  }
  // credit as a text line under the figure (wraps on narrow screens instead of running under the zoom)
  box.append(h('a', { class: 'b-cite', href: 'https://doi.org/10.1056/NEJMoa2314132', target: '_blank', rel: 'noopener' }, 'Participant T15 · adapted with permission from Card et al., 2024'));
}
function highlightArray(name) {
  document.querySelectorAll('#arrays .array, #brain .mk').forEach((n) => n.classList.toggle('hl', n.dataset.a === name));
}
function drawTimeSal() {
  const cv = $('timeSal'), ctx = cv.getContext('2d'), t = S.cur; if (!t) return;
  const T = tokens(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = cv.clientWidth || 800, cssH = 200;
  cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr); cv.style.height = cssH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cssW, cssH);
  const narrow = cssW < 520, left = narrow ? 8 : 72, right = narrow ? 8 : 14, top = 8, ph = 160, w = cssW - left - right, Tn = t.meta.T;
  const xs = (f) => left + (f / Tn) * w;
  for (const [s, e] of t.wb || []) { ctx.fillStyle = T.bg3; ctx.fillRect(xs(s), top, xs(e) - xs(s), ph); }
  ctx.font = `500 11px ${T.ui}`; ctx.fillStyle = T.fg3; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  if (!narrow) ctx.fillText('saliency', left - 10, top + ph / 2);
  if (S.word === 'global') {
    ctx.textAlign = 'center'; ctx.fillText('Pick a word or the whole sentence to see when the decoder looked.', left + w / 2, top + ph / 2);
    return;
  }
  const curves = t.sal_temporal; const n = curves.length;
  const sel = typeof S.word === 'number' ? S.word : -1;
  const order = [...Array(n).keys()].sort((a, b) => (a === sel) - (b === sel));
  for (const i of order) {
    const c = curves[i]; const isSel = i === sel, any = sel < 0;
    ctx.beginPath();
    for (let j = 0; j < c.length; j++) { const x = left + (j / (c.length - 1)) * w, y = top + ph - (c[j] / 255) * (ph - 26) - 2; j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    if (isSel) {
      ctx.lineTo(left + w, top + ph); ctx.lineTo(left, top + ph); ctx.closePath();
      ctx.fillStyle = T.accent; ctx.globalAlpha = 0.12; ctx.fill(); ctx.globalAlpha = 1;
      ctx.beginPath(); for (let j = 0; j < c.length; j++) { const x = left + (j / (c.length - 1)) * w, y = top + ph - (c[j] / 255) * (ph - 26) - 2; j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    }
    ctx.strokeStyle = isSel ? T.accent : any ? T.fg2 : T.fg3; ctx.globalAlpha = isSel || any ? 1 : 0.45;
    ctx.lineWidth = isSel ? 2 : 1.25; ctx.stroke(); ctx.globalAlpha = 1;
  }
  // labels at peaks
  ctx.font = `500 ${narrow ? 12 : 13}px ${T.display}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  const lanes = [-1e9, -1e9];   // two rows of labels; each word takes the first row it fits in
  t.words.forEach((wd, i) => {
    const x = xs(t.sal_peak[i]), tw = ctx.measureText(wd.w).width;
    const fits = lanes.findIndex((end) => x - tw / 2 >= end + 4), lane = fits >= 0 ? fits : lanes[0] <= lanes[1] ? 0 : 1; lanes[lane] = x + tw / 2;
    ctx.fillStyle = i === sel ? T.accent : sel < 0 ? T.fg : T.fg3; ctx.fillText(wd.w, x, top + 18 + lane * 16);
  });
  ctx.font = `400 10px ${T.ui}`; ctx.fillStyle = T.fg3; ctx.textBaseline = 'top';
  const step = tickStep(w, t.meta.dur);
  for (let s = 0; s <= t.meta.dur; s += step) ctx.fillText(s + ' s', xs(s * 50), top + ph + 8);
}

// ------------------------------------------------------------------ lesion
function setOrder(o, keepCustom) {
  S.order = o;
  document.querySelectorAll('[data-order]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.order === o)));
  $('kRow').style.opacity = o === 'custom' ? 0.4 : 1; $('kSlider').disabled = o === 'custom';
  if (o === 'custom' && !keepCustom && !S.custom.size) { /* start empty */ }
  renderArrays(); updateK(); drawAbl();
}
function updateK() {
  const k = S.order === 'custom' ? S.custom.size : KS[S.kIdx];
  $('kBadge').textContent = `${k} / 256`;
}
async function lesionDecode() {
  const t = S.cur; if (!t) return;
  const out = $('lesionOut'), note = $('lesionNote'), btn = $('lesionBtn');
  btn.disabled = true; out.innerHTML = '<span class="placeholder">Decoding…</span>'; note.textContent = '';
  const drop = [...droppedSet()];
  const live = S.engine === 'live';
  let text;
  if (live) {
    const res = await runLive(modelInput(t, drop)).catch(() => null);
    if (res) text = res.text;
  }
  if (text === undefined) {
    if (S.order === 'custom') {
      out.innerHTML = `<span class="placeholder">${S.engine === 'loading' ? 'Hand-picked lesions need the live model; it is still downloading.' : S.engine === 'idle' ? 'Hand-picked lesions need the live model. Download it above.' : 'Hand-picked lesions need the live model.'}</span>`;
      btn.disabled = false; return;
    }
    text = t.lesion[S.order][String(KS[S.kIdx])];
    note.textContent = 'saved output';
  }
  const { errors, n } = renderDiff(out, t.meta.cue, normalize(text));
  if (!normalize(text)) out.innerHTML = '<span class="placeholder">(nothing decoded)</span>';
  note.textContent = `${errors} / ${n} word errors` + (note.textContent ? ' · ' + note.textContent : '');
  btn.disabled = false;
}
function drawAbl() {
  const A = S.site.lesion.sweep, box = $('ablChart');
  const W = fitW(box, 320, 640), H = 300, m = { l: 48, r: 16, t: 14, b: 40 };
  const s = svg(box, W, H, 'Word error rate versus number of electrodes silenced');
  const x = (i) => m.l + (i / (KS.length - 1)) * (W - m.l - m.r);
  const y = logs(0.05, 1.0, H - m.b, m.t);
  const g = el('g', { class: 'grid' }, s);
  for (const v of [0.05, 0.1, 0.2, 0.5, 1]) {
    el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }, g);
    el('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end', text: Math.round(v * 100) + '%' }, s);
  }
  KS.forEach((k, i) => el('text', { x: x(i), y: H - m.b + 18, 'text-anchor': 'middle', text: k }, s));
  el('text', { x: (m.l + W - m.r) / 2, y: H - 6, 'text-anchor': 'middle', text: 'electrodes silenced (k)' }, s);
  const line = (vals, color, dash) => {
    el('path', { d: vals.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(Math.max(0.05, v))}`).join(''), fill: 'none', style: `stroke:${color};stroke-width:2;stroke-linejoin:round;stroke-linecap:round` + (dash ? ';stroke-dasharray:5 4' : '') }, s);
    vals.forEach((v, i) => {
      const c = el('circle', { cx: x(i), cy: y(Math.max(0.05, v)), r: 4, style: `fill:${color};stroke:var(--bg-2);stroke-width:2` }, s);
      hover(c, () => `<b>k = ${KS[i]}</b><br>WER ${(v * 100).toFixed(1)}%`);
    });
  };
  line(A.rand, 'var(--fg-3)', true); line(A.top, 'var(--accent)');
  if (S.order !== 'custom') {
    const i = S.kIdx, arr = S.order === 'top' ? A.top : A.rand;
    el('line', { x1: x(i), x2: x(i), y1: m.t, y2: H - m.b, style: 'stroke:var(--fg-3);stroke-width:1' }, s);
    el('circle', { cx: x(i), cy: y(Math.max(0.05, arr[i])), r: 7, style: 'fill:none;stroke:var(--fg);stroke-width:1.5' }, s);
  }
}

// ------------------------------------------------------------------ init
export async function initDemo(index, site) {
  S.index = index; S.site = site;
  renderTrialList();
  $('decodeBtn').addEventListener('click', decodeCurrent);
  $('loadModelBtn').addEventListener('click', () => ensureModel());
  initEngine();
  $('speakBtn').addEventListener('click', () => {
    if (!S.lastText || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(S.lastText); u.rate = 0.95; speechSynthesis.speak(u);
  });
  document.querySelectorAll('[data-feat]').forEach((b) => b.addEventListener('click', () => {
    S.feat = b.dataset.feat; document.querySelectorAll('[data-feat]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    if (S.cur) drawRaster(S.cur);
  }));
  document.querySelectorAll('[data-order]').forEach((b) => b.addEventListener('click', () => setOrder(b.dataset.order)));
  $('kSlider').addEventListener('input', (e) => { S.kIdx = +e.target.value; updateK(); renderArrays(); drawAbl(); });
  $('lesionBtn').addEventListener('click', lesionDecode);
  $('lesionReset').addEventListener('click', () => { S.custom.clear(); S.kIdx = 0; $('kSlider').value = 0; updateK(); renderArrays(); drawAbl(); $('lesionOut').innerHTML = '<span class="placeholder">—</span>'; $('lesionNote').textContent = ''; });
  updateK(); responsive($('ablChart'), drawAbl);
  await select(index.trials[0].id);
  const redraw = () => { if (S.cur) { drawRaster(S.cur); drawTimeSal(); renderArrays(); } };
  window.addEventListener('themechange', redraw);
  let rt; new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(redraw, 120); }).observe($('raster'));
}
