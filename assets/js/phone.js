// The FETTUCCINE phone: an iPhone 15 Pro Max (assets/css/phone.css) that replays recorded trials.
// Each trial: the recording fills in ("Listening"), typing dots appear ("Decoding"), then the decoded
// sentence arrives as a message with its measured iPhone latency. Every frame is a pure function of
// time, so the same code drives the website (real time), the link preview and the tweeprint video
// (frame by frame). Shared by the website and the tweeprint; keep the copies identical.
//
//   const phone = mountPhone(container, { avatar }); // builds the device; avatar: optional image URL for the header
//   const p = await createPhone(phone, trials);     // trials: [{dur, R: 64, F, rows (base64 u8), decoded, iphone_ms}]
//   p.render(t);  p.cycle;  p.still                  // t in seconds; p.still = a calm frame for stills

const KEEP = 3;           // messages kept on screen (the oldest leaves when the next recording starts)
const TYPING_S = 0.6;     // typing dots after the recording (sped up, like the replay; the real decode takes ~40-50 ms)
const SETTLE_S = 0.6;     // a new message has fully settled after this long
const HOLD_S = 1.6;       // decoded sentence rests before the next recording
const listenS = (dur) => 2.0 + 0.04 * dur;   // sped-up replay of the recording
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
// critically damped spring (no overshoot): one curve moves every element, so nothing clashes
const W_SPRING = 11.5, S_END = 1 - (1 + W_SPRING * SETTLE_S) * Math.exp(-W_SPRING * SETTLE_S);
const spring = (s) => (s <= 0 ? 0 : s >= SETTLE_S ? 1 : (1 - (1 + W_SPRING * s) * Math.exp(-W_SPRING * s)) / S_END);
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

const ICONS = '<svg viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>'
  + '<svg viewBox="0 0 17 12.5"><path stroke="#f5f5f7" stroke-width=".6" stroke-linejoin="round" d="M8.5 11.6L6.05 9.24A3.4 3.4 0 0 1 10.95 9.24ZM3.18 6.46A7.4 7.4 0 0 1 13.82 6.46L12.10 8.13A5.0 5.0 0 0 0 4.90 8.13ZM0.30 3.68A11.4 11.4 0 0 1 16.70 3.68L14.97 5.35A9.0 9.0 0 0 0 2.03 5.35Z"/></svg>'
  + '<svg viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.8" fill="none" stroke="#f5f5f7" stroke-opacity=".4"/><rect x="2" y="2" width="20" height="9" rx="2.4"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2z" fill-opacity=".4"/></svg>';

export function mountPhone(container, { avatar } = {}) {
  container.innerHTML = `<div class="phone"><div class="ph-bezel"><div class="ph-screen">
    <div class="ph-status" aria-hidden="true"><span class="ph-time">9:41</span><span class="ph-island"></span><span class="ph-icons">${ICONS}</span></div>
    <div class="ph-head">${avatar ? '<div class="ph-avatar"></div>' : ''}<div class="ph-name">FETTUCCINE</div><div class="ph-sub">On device</div></div>
    <div class="ph-chat" aria-live="polite"></div>
    <div class="ph-panel"><div class="ph-phead"><span class="ph-state"><i></i><span>Listening</span></span><span class="ph-clock">0.0 s</span></div><canvas aria-hidden="true"></canvas></div>
    <div class="ph-safe"><div class="ph-homebar"></div></div>
  </div></div></div>`;
  const phone = container.firstElementChild;
  if (avatar) phone.querySelector('.ph-avatar').style.backgroundImage = `url("${avatar}")`;
  return phone;
}

export async function createPhone(phone, data) {
  const $ = (s) => phone.querySelector(s);
  const chat = $('.ph-chat'), cv = $('canvas'), dot = $('.ph-state i'), stxt = $('.ph-state span'), clock = $('.ph-clock');
  const cs = getComputedStyle($('.ph-screen'));
  const v = (n) => cs.getPropertyValue(n).trim();
  const C = { screen: v('--ph-screen'), dot: v('--ph-dot'), done: v('--ph-done'), head: v('--ph-playhead') || '#ffffff' };
  const NEG = hex(v('--ph-neg')), POS = hex(v('--ph-pos')), MID = hex(C.screen);
  const LUT = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {   // same mapping as the demo raster: |z|^0.85 towards each pole
    const t = i / 255 * 2 - 1, a = Math.pow(Math.abs(t), 0.85), c = t < 0 ? NEG : POS;
    for (let k = 0; k < 3; k++) LUT[i * 3 + k] = MID[k] + (c[k] - MID[k]) * a;
  }
  const trials = data.map((t) => {
    const bin = atob(t.rows), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const c = document.createElement('canvas'); c.width = t.F; c.height = t.R;
    const img = new ImageData(t.F, t.R);
    for (let i = 0; i < t.R * t.F; i++) { const q = u[i] * 3; img.data.set([LUT[q], LUT[q + 1], LUT[q + 2], 255], i * 4); }
    c.getContext('2d').putImageData(img, 0, 0);
    return { ...t, img: c };
  });

  const segs = []; let t0 = 0;
  trials.forEach((t, k) => {
    const L = listenS(t.dur), arrive = t0 + L + TYPING_S;
    segs.push({ k, listen0: t0, listen1: t0 + L, arrive, end: arrive + SETTLE_S + HOLD_S });
    t0 = segs[segs.length - 1].end;
  });
  const CYCLE = t0;

  // three copies of the cycle, so the stack above the newest message is always filled
  chat.innerHTML = ''; const msgs = [];
  for (let c = -2; c <= 0; c++) for (const s of segs) {
    const t = trials[s.k];
    const m = document.createElement('div'); m.className = 'ph-msg';
    m.innerHTML = '<div class="ph-bubble"></div><div class="ph-meta">decoded in <b></b></div>';
    m.querySelector('.ph-bubble').textContent = t.decoded;
    m.querySelector('b').textContent = `${Math.round(t.iphone_ms)} ms`;
    chat.append(m);
    msgs.push({ el: m, meta: m.querySelector('.ph-meta'), at: s.arrive + c * CYCLE, typ: s.listen1 + c * CYCLE, listen0: s.listen0 + c * CYCLE, h: 0 });
  }
  msgs.sort((a, b) => a.at - b.at);
  msgs.forEach((m, i) => { m.retire = msgs[i + KEEP] ? msgs[i + KEEP].listen0 : Infinity; });   // text never shows twice
  const typing = document.createElement('div'); typing.className = 'ph-msg ph-typing';
  typing.innerHTML = '<div class="ph-bubble" aria-label="decoding"><i></i><i></i><i></i></div>';
  chat.append(typing);
  const dots = [...typing.querySelectorAll('i')];

  let typH = 0, gap = 0, U = 1, drawn = null;
  function measure() {   // sizes depend on --u; call again after a resize
    chat.querySelectorAll('.ph-bubble').forEach((b) => { b.style.width = ''; });
    // shrink-wrap wrapped bubbles to their longest line, as Messages does
    for (const b of chat.querySelectorAll('.ph-msg:not(.ph-typing) .ph-bubble')) {
      const r = document.createRange(); r.selectNodeContents(b);
      const rects = [...r.getClientRects()];
      if (rects.length < 2) continue;
      const w = Math.max(...rects.map((q) => q.right)) - Math.min(...rects.map((q) => q.left));
      const bs = getComputedStyle(b);
      b.style.width = `${Math.ceil(w + parseFloat(bs.paddingLeft) + parseFloat(bs.paddingRight)) + 1}px`;
    }
    U = $('.ph-screen').clientWidth / 430;   // px per pt
    gap = 14 * U;
    msgs.forEach((m) => { m.h = m.el.offsetHeight + gap; });
    typH = typing.querySelector('.ph-bubble').offsetHeight + gap;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(cv.clientHeight * dpr);
    drawn = null;   // resizing clears the canvas
  }
  await document.fonts.ready;
  measure();

  function drawRaster(ctx, W, H, t, frac, alpha) {
    if (!t || alpha <= 0) return;
    const sx = Math.max(1, Math.round(t.F * frac)), dw = W * (sx / t.F);
    ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const g = Math.round(H * 0.025), bh = (H - 3 * g) / 4;          // four arrays, separated
    for (let a = 0; a < 4; a++) ctx.drawImage(t.img, 0, a * 16, sx, 16, 0, a * (bh + g), dw, bh);
    ctx.globalAlpha = 1;
  }

  // write to the DOM only when a value changes, so idle frames cost nothing
  const put = (el, k, v) => { v = String(v); const c = el._c || (el._c = {}); if (c[k] !== v) { c[k] = v; el.style[k] = v; } };
  const text = (el, v) => { if (el.textContent !== v) el.textContent = v; };

  function render(tau) {
    const t = ((tau % CYCLE) + CYCLE) % CYCLE;
    const s = segs.find((x) => t >= x.listen0 && t < x.end) || segs[segs.length - 1];
    const prev = segs[(s.k - 1 + segs.length) % segs.length], tr = trials[s.k];
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    const listening = t < s.listen1, key = listening ? null : `${s.k}:${W}x${H}`;
    const repaint = listening || drawn !== key;   // a finished recording stays on the canvas untouched
    drawn = key;
    if (repaint) { ctx.fillStyle = C.screen; ctx.fillRect(0, 0, W, H); }
    if (listening) {
      const frac = (t - s.listen0) / (s.listen1 - s.listen0);
      drawRaster(ctx, W, H, trials[prev.k], 1, 1 - smooth((t - s.listen0) / 0.35));   // previous recording fades
      drawRaster(ctx, W, H, tr, frac, 1);
      const pw = Math.max(2, Math.round(W / 260));
      ctx.fillStyle = C.head; ctx.globalAlpha = 0.9; ctx.fillRect(Math.min(W - pw, W * frac - pw / 2), 0, pw, H); ctx.globalAlpha = 1;
      text(stxt, 'Listening'); text(clock, (frac * tr.dur).toFixed(1) + ' s');
      put(dot, 'background', C.dot); put(dot, 'opacity', (0.55 + 0.45 * Math.cos(2 * Math.PI * (t - s.listen0) / 1.4)).toFixed(3));
    } else {
      if (repaint) drawRaster(ctx, W, H, tr, 1, 1);
      text(clock, tr.dur.toFixed(1) + ' s'); put(dot, 'opacity', 1);
      if (t < s.arrive) { text(stxt, 'Decoding'); put(dot, 'background', C.dot); }
      else { text(stxt, 'Decoded'); put(dot, 'background', C.done); }
    }
    // the stack scrolls up, on one spring, by the typing dots and then by each later message
    const lift = (o) => typH * (spring(t - o.typ) - spring(t - o.at)) + o.h * spring(t - o.at);
    for (const m of msgs) {
      let off = 0, nLater = 0;
      for (const o of msgs) if (o.at > m.at && o.typ <= t) { off += lift(o); nLater += spring(t - o.at); }
      if (t < m.at || nLater >= KEEP) { put(m.el, 'opacity', 0); continue; }
      const x = spring(t - m.at);
      const op = smooth((t - m.at) / 0.25) * (1 - smooth((t - m.retire) / 0.45));   // the oldest leaves at the top
      put(m.el, 'opacity', op.toFixed(3));
      put(m.el, 'transform', `translate3d(0, ${(-off + (1 - x) * m.h).toFixed(2)}px, 0)`);
      put(m.meta, 'opacity', smooth((t - m.at - 0.12) / 0.3).toFixed(3));
    }
    // typing dots for the sentence being decoded
    const cur = msgs.find((o) => o.typ <= t && t < o.at + 0.3);
    if (cur) {
      put(typing, 'opacity', (smooth((t - cur.typ) / 0.2) * (1 - smooth((t - cur.at) / 0.18))).toFixed(3));
      put(typing, 'transform', `translate3d(0, ${((1 - spring(t - cur.typ)) * typH).toFixed(2)}px, 0)`);
      dots.forEach((d, i) => {   // the familiar wave: each dot brightens and lifts in turn
        const w = 0.5 + 0.5 * Math.cos(2 * Math.PI * ((t - cur.typ) / 1.1 - i * 0.14));
        put(d, 'opacity', (0.4 + 0.6 * w).toFixed(3));
        put(d, 'transform', `translateY(${(-2.5 * w * U).toFixed(2)}px)`);
      });
    } else put(typing, 'opacity', 0);
  }

  const still = segs[segs.length - 1].arrive + SETTLE_S + 0.9;   // mid-hold of the last sentence
  return { cycle: CYCLE, render, measure, still };
}

// Real-time playback for the website: pauses off screen, shows a still frame with reduced motion.
export async function playPhone(phone, data) {
  const p = await createPhone(phone, data);
  let resizeT; new ResizeObserver(() => { clearTimeout(resizeT); resizeT = setTimeout(() => { p.measure(); p.render(clock); }, 100); }).observe(phone);
  let clock = p.still;   // start mid-conversation, just before the next recording
  p.render(clock);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return p;
  let visible = true, last = performance.now();
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe(phone);
  const step = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;   // no jumps after a hidden tab
    if (visible) { clock += dt; p.render(clock); }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return p;
}
