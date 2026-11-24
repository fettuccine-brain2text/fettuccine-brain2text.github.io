// Results figures: accuracy across participants + tables, latency raincloud + race, WER vs. memory, adaptation, ablations.
import { svg, el, h, lin, logs, hover, fmtMs, prefersReduced, fitW, responsive } from './util.js';

const $ = (id) => document.getElementById(id);
const C = { whisper: 'var(--whisper)', parakeet: 'var(--parakeet)', cascade: 'var(--cascade)', accent: 'var(--accent)', muted: 'var(--fg-3)' };

function axisLog(s, x, y0, ticks, fmt) {
  const g = el('g', { class: 'grid' }, s);
  for (const t of ticks) { el('line', { x1: x(t), x2: x(t), y1: 0, y2: y0 }, g); el('text', { x: x(t), y: y0 + 16, 'text-anchor': 'middle', text: fmt(t) }, s); }
}

// ------------------------------------------------------------ latency
export function latencyChart(L) { const box = $('latChart'); responsive(box, () => drawLatency(L, box)); }
function drawLatency(L, box) {
  const W = fitW(box, 560), H = 470, m = { l: 14, r: 16, t: 10, b: 44 };
  const s = svg(box, W, H, 'Latency distributions on a log scale');
  const x = logs(10, 30000, m.l, W - m.r);
  axisLog(s, x, H - m.b, [10, 30, 100, 300, 1000, 3000, 10000, 30000], (t) => t >= 1000 ? t / 1000 + ' s' : t + ' ms');
  el('text', { x: (m.l + W - m.r) / 2, y: H - 8, 'text-anchor': 'middle', text: 'latency per sentence (log scale)' }, s);
  const rows = [
    { key: 'whisper-base', name: 'FETTUCCINE · Whisper Base', color: C.whisper },
    { key: 'parakeet-eou', name: 'FETTUCCINE · Parakeet EOU', color: C.parakeet },
    { key: 'gru', name: 'GRU + 5-gram + LLM (cascade)', color: C.cascade },
  ];
  const band = (H - m.t - m.b) / rows.length;
  rows.forEach((r, i) => {
    const hgt = band * 0.36, d = L[r.key], y0 = m.t + band * i + 30 + hgt;   // label, 14 px gap, cloud, points, then room before the next row
    // density on log axis
    const xsLog = []; for (let v = 1; v <= 4.5; v += 0.02) xsLog.push(v);
    const lv = d.values.map((v) => Math.log10(v)); const bw = 0.06;
    const dens = xsLog.map((u) => lv.reduce((a, v) => a + Math.exp(-0.5 * ((u - v) / bw) ** 2), 0));
    const mx = Math.max(...dens);
    const keep = dens.map((v) => v > mx * 0.004);
    const k0 = keep.indexOf(true), k1 = keep.lastIndexOf(true);
    const pts = xsLog.slice(k0, k1 + 1).map((u, k) => [x(10 ** u), y0 - (dens[k0 + k] / mx) * hgt]);
    el('path', { d: `M${pts[0][0]},${y0}` + pts.map((p) => `L${p[0]},${p[1]}`).join('') + `L${pts[pts.length - 1][0]},${y0}Z`, style: `fill:${r.color};fill-opacity:.12;stroke:none` }, s);
    el('path', { d: pts.map((p, k) => `${k ? 'L' : 'M'}${p[0]},${p[1]}`).join(''), style: `fill:none;stroke:${r.color};stroke-width:2` }, s);
    // jittered points
    const gp = el('g', {}, s);
    let seed = 7 + i;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const v of d.values) el('circle', { cx: x(v), cy: y0 + 6 + rnd() * band * 0.2, r: 1.4, style: `fill:${r.color};fill-opacity:.4` }, gp);
    // median marker
    el('line', { x1: x(d.median), x2: x(d.median), y1: y0 - 3, y2: y0 + band * 0.26 + 6, style: 'stroke:var(--fg);stroke-width:2' }, s);
    el('text', { x: m.l + 2, y: y0 - hgt - 14, class: 't2', text: r.name }, s);
    el('text', { x: W - m.r, y: y0 - hgt - 14, 'text-anchor': 'end', text: `median ${fmtMs(d.median)} · max ${fmtMs(d.max)}` }, s);
    const hit = el('rect', { x: m.l, y: y0 - hgt - 26, width: W - m.l - m.r, height: band * 0.9, style: 'fill:transparent' }, s);
    hover(hit, () => `<b>${r.name}</b><br>median ${fmtMs(d.median)}<br>95th pct ${fmtMs(d.p95)} · 99th ${fmtMs(d.p99)}<br>slowest ${fmtMs(d.max)}<br>n = ${d.values.length}`);
  });
}

// ------------------------------------------------------------ race: 10 sentences back to back
export function initRace(P) {   // P: per-sentence latencies, aligned across decoders (same index = same sentence)
  const box = $('race');
  const rows = [
    { key: 'whisper-base', name: 'FETTUCCINE · Whisper Base', color: C.whisper },
    { key: 'parakeet-eou', name: 'FETTUCCINE · Parakeet EOU', color: C.parakeet },
    { key: 'gru', name: 'GRU + 5-gram + LLM', color: C.cascade },
  ];
  const N = 10;
  box.innerHTML = '';
  const els = rows.map((r) => {
    const bar = h('div', { class: 'bar' }, h('i', { style: `background:${r.color}` }));
    const t = h('span', { class: 't' }, '–');
    const [pre, rest] = r.name.includes(' · ') ? r.name.split(' · ') : ['', r.name];
    box.append(h('div', { class: 'race-row' }, h('span', { class: 'n', title: r.name }, pre ? h('span', { class: 'long' }, pre + ' · ') : null, rest), bar, t));
    return { bar: bar.firstChild, t };
  });
  let running = false;
  async function go() {
    if (running) return; running = true;
    const n = P[rows[0].key].length, pick = Array.from({ length: N }, () => Math.floor(Math.random() * n));
    const draws = rows.map((r) => pick.map((j) => P[r.key][j]));
    const totals = draws.map((d) => d.reduce((a, b) => a + b, 0));
    const maxT = Math.max(...totals);
    const t0 = performance.now(), speed = prefersReduced() ? 1e9 : 1;
    await new Promise((res) => {
      const step = (now) => {
        const el_ = (now - t0) * speed;
        rows.forEach((r, i) => {
          const done = Math.min(el_, totals[i]);
          els[i].bar.style.width = (100 * done / maxT) + '%';
          let k = 0, acc = 0; while (k < N && acc + draws[i][k] <= done) acc += draws[i][k++];
          els[i].t.textContent = el_ >= totals[i] ? fmtMs(totals[i]) : `${k}/${N}`;
        });
        if (el_ < maxT) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
    running = false;
  }
  $('raceBtn').addEventListener('click', go);
}

// ------------------------------------------------------------ WER vs memory
// T15: our points are the WER measured on the phone. T12: no phone runs, so the WER is from the
// GPU evaluation (zoo table, same model sizes); the memory stays the phone's.
const T12_ROW = {   // memory point -> zoo row (BrainWhisperer reports no T12 result)
  'GRU + 5-gram + LLM': 'GRU + 5-gram + OPT-6.7B', 'BIT E2E': 'BIT E2E (Aero1-Audio 1.5B)',
  'LightBeam': 'LightBeam (GRU) + 4-gram + Llama-3.2-1B', 'Parakeet TDT v2': 'Parakeet TDT',
};
const T12_LAB = { 'Whisper Base': [-10, 4, 'end'], 'Whisper Small': [10, 15, 'start'], 'Parakeet EOU': [10, -7, 'start'] };
export function memoryChart(M, Z) {
  const box = $('memChart'); let part = 't15';
  const t12 = M.map((p) => {
    const r = Z.rows.find((q) => q.name === (T12_ROW[p.name] || p.name));
    return r && r.t12 != null ? { ...p, wer: r.t12, lab: T12_LAB[p.name] || (p.name.startsWith('GRU') ? p.lab : undefined), note: p.kind === 'ours' ? 'T12 WER on GPU · memory on iPhone 15 Pro Max' : p.note } : null;
  }).filter(Boolean);
  const note = $('memNote');
  const set = (k) => {
    part = k;
    document.querySelectorAll('[data-mempart]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mempart === k)));
    note.textContent = k === 't15' ? 'T15 (brain-to-text 2025). FETTUCCINE word error rates measured on the phone.'
      : 'T12 (brain-to-text 2024). FETTUCCINE word error rates from GPU evaluation.';
    drawMemory(k === 't15' ? M : t12, box, k === 't15' ? [4, 12.5, [4, 6, 8, 10, 12]] : [8, 21, [8, 10, 12, 14, 16, 18, 20]]);
  };
  document.querySelectorAll('[data-mempart]').forEach((b) => b.addEventListener('click', () => set(b.dataset.mempart)));
  responsive(box, () => set(part));
}
function drawMemory(M, box, [y0, y1, yTicks]) {
  const W = fitW(box, 620), H = 420, m = { l: 56, r: 24, t: 16, b: 48 };
  const s = svg(box, W, H, 'Word error rate versus peak memory');
  const x = logs(0.1, 1000, m.l, W - m.r), y = lin(y0, y1, H - m.b, m.t);
  const g = el('g', { class: 'grid' }, s);
  for (const t of [0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000]) { el('line', { x1: x(t), x2: x(t), y1: m.t, y2: H - m.b }, g); el('text', { x: x(t), y: H - m.b + 18, 'text-anchor': 'middle', text: t < 1 ? t * 1000 + ' MB' : t + ' GB' }, s); }
  for (const t of yTicks) { el('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t) }, g); el('text', { x: m.l - 10, y: y(t) + 4, 'text-anchor': 'end', text: t + '%' }, s); }
  el('text', { x: (m.l + W - m.r) / 2, y: H - 8, 'text-anchor': 'middle', text: 'peak memory (log scale)' }, s);
  el('text', { x: 14, y: (m.t + H - m.b) / 2, transform: `rotate(-90 14 ${(m.t + H - m.b) / 2})`, 'text-anchor': 'middle', text: 'word error rate' }, s);
  // points that would sit on top of each other (on T12, Whisper Small and Parakeet EOU) are
  // nudged apart sideways so both stay visible; the tooltip keeps the exact values
  const pts = M.map((p) => ({ p, cx: x(p.mem_gb), cy: y(p.wer) }));
  pts.forEach((a, i) => pts.slice(i + 1).forEach((b) => {
    const dx = b.cx - a.cx;
    if (Math.hypot(dx, b.cy - a.cy) < 12) { const k = (12 - Math.abs(dx)) / 2 * (dx >= 0 ? 1 : -1); a.cx -= k; b.cx += k; }
  }));
  for (const { p, cx, cy } of pts) {
    const color = p.kind === 'ours' ? (p.family === 'parakeet' ? C.parakeet : C.whisper) : 'var(--fg-3)';
    const mk = el('circle', { cx, cy, r: 5.5, style: `fill:${color};stroke:var(--bg-2);stroke-width:2` }, s);
    const [dx, dy, anchor] = p.lab || [10, 4, 'start'];
    el('text', { x: cx + dx, y: cy + dy, 'text-anchor': anchor, class: p.kind === 'ours' ? 't1' : 't2', text: p.name }, s);
    hover(mk, () => `<b>${p.name}</b><br>${p.wer.toFixed(2)}% WER · ${p.mem_gb < 1 ? Math.round(p.mem_gb * 1024) + ' MB' : p.mem_gb.toFixed(1) + ' GB'}<br>${p.note}`);
  }
}

// ------------------------------------------------------------ accuracy (Table 1)
// Three FETTUCCINE variants, each best at something, against the best end-to-end decoder and the best cascade.
const PICK = [
  { name: 'Whisper Small', role: 'Most accurate' },
  { name: 'Parakeet TDT · TensorRT', role: 'Fastest', label: 'Parakeet TDT (TensorRT)' },
  { name: 'Whisper Tiny', role: 'Smallest' },
  { name: 'BrainWhisperer E2E (cross)', role: 'Best end-to-end baseline', label: 'BrainWhisperer' },
  { name: 'BIT E2E (Aero1-Audio 1.5B)', role: 'End-to-end baseline', label: 'BIT (Aero1-Audio 1.5B)' },
  { name: 'LightBeam (Transformer) + 4-gram + Llama-3.2-1B', role: 'Best cascade', label: 'LightBeam + LLM (cascade)' },
];
const picked = (Z) => PICK.map((p) => ({ ...p, ...Z.rows.find((r) => r.name === p.name), label: p.label || p.name }));

export function werChart(Z) { const box = $('werChart'); responsive(box, () => drawWER(picked(Z), box)); }
function drawWER(rows, box) {
  const cw = box.clientWidth || 640, two = cw >= 620;
  box.innerHTML = '';
  box.classList.toggle('stack', !two);
  const panels = [['wer_pub', 'T15 · brain-to-text 2025', 12], ['t12', 'T12 · brain-to-text 2024', 20]];
  panels.forEach(([key, title, max], pi) => {
    const labels = !two || pi === 0;
    const W = two ? Math.floor((cw - 28) / 2) : cw, rowH = 34, m = { l: labels ? 168 : 8, r: 56, t: 30, b: 34 };
    const H = m.t + m.b + rowH * rows.length;
    const cell = h('div', { class: 'pp' }); box.append(cell);
    const s = svg(cell, W, H, `Test word error rate, ${title}`);
    const x = lin(0, max, m.l, W - m.r);
    el('text', { x: m.l, y: 14, class: 't1', text: title }, s);
    const g = el('g', { class: 'grid' }, s);
    for (let t = 0; t <= max; t += max > 12 ? 5 : 4) { el('line', { x1: x(t), x2: x(t), y1: m.t - 6, y2: H - m.b }, g); el('text', { x: x(t), y: H - m.b + 16, 'text-anchor': 'middle', text: t + '%' }, s); }
    rows.forEach((r, i) => {
      const yc = m.t + rowH * i + rowH / 2, ours = r.kind === 'ours';
      if (i === 3) el('line', { x1: 0, x2: W, y1: yc - rowH / 2, y2: yc - rowH / 2, style: 'stroke:var(--line);stroke-width:1' }, s);
      if (labels) el('text', { x: 0, y: yc + 4, class: ours ? 't1' : 't2', text: r.label.replace(' (cascade)', '') }, s);   // colour says FETTUCCINE
      const v = r[key];
      if (v == null) { el('text', { x: m.l + 4, y: yc + 4, text: 'not reported' }, s); return; }
      const fill = ours ? (/Parakeet/.test(r.name) ? C.parakeet : C.whisper) : 'var(--fg-3)';
      const bar = el('path', { d: hbar(x(0), yc - 8, x(v) - x(0), 16), style: `fill:${fill};fill-opacity:${ours ? 1 : r.group === 'cascade' ? 0.35 : 0.6}` }, s);
      el('text', { x: x(v) + 6, y: yc + 4, class: 't1', text: v.toFixed(2) + '%' }, s);
      hover(bar, () => `<b>${r.label}</b><br>${r.role}<br>${v.toFixed(2)}% test WER, ${title.split(' ·')[0]}`);
    });
  });
}

// the same picks as a table, with speed and memory; the full table sits in a <details>
const fmt = (v, d = 2) => v == null ? '–' : typeof v === 'string' ? v : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export function bestTable(Z) {
  const rows = picked(Z).filter((r) => r.role !== 'End-to-end baseline');
  const num = (t) => (t ? parseFloat((t.match(/[\d,.]+/) || [''])[0].replace(/,/g, '')) : undefined);
  const cols = [
    { k: 'T15 WER', get: (r) => r.wer_pub, f: (v) => fmt(v) + '%' },
    { k: 'T12 WER', get: (r) => r.t12, f: (v) => fmt(v) + '%' },
    { k: 'Latency · A40', get: (r) => r.lat ?? num(r.lat_txt), f: (v, r) => (r.lat_txt ? r.lat_txt.split(' ±')[0] : fmt(v, 1)) + ' ms' },
    { k: 'GPU memory', get: (r) => r.vram ?? num(r.vram_txt), f: (v, r) => (r.vram_txt || fmt(v, 0)) + ' MB' },
    { k: 'Latency · iPhone', get: (r) => r.phone && r.phone.lat, f: (v) => fmt(v, 0) + ' ms' },
    { k: 'Memory · iPhone', get: (r) => r.phone && r.phone.mem, f: (v) => fmt(v, 0) + ' MB' },
  ];
  const best = cols.map((c) => Math.min(...rows.map((r) => c.get(r)).filter((v) => v != null)));
  const missing = (r, c) => (c.k.includes('iPhone') && r.kind === 'ours' ? 'GPU only' : 'not reported');
  const t = h('table', { class: 'best-t' });
  t.append(h('thead', {}, h('tr', {}, h('th', {}), ...cols.map((c) => h('th', {}, c.k)))));
  const tb = h('tbody'); t.append(tb);
  rows.forEach((r, i) => {
    if (i === 3) tb.append(h('tr', { class: 'gap' }, h('td', { colspan: cols.length + 1 })));
    tb.append(h('tr', {}, h('th', { scope: 'row' }, h('span', { class: 'v' }, (r.kind === 'ours' ? 'FETTUCCINE ' : '') + r.label.replace(' (cascade)', '')), h('span', { class: 'm' }, r.role)),
      ...cols.map((c, j) => { const v = c.get(r); return v == null ? h('td', { class: 'na', title: missing(r, c) }, '–') : h('td', { class: v === best[j] ? 'best' : '' }, c.f(v, r)); })));
  });
  const box = $('bestTable'); box.innerHTML = ''; box.append(t);
}
export function zooTable(Z) {
  // follows Table 1 (server, NVIDIA A40; compute columns are the worse of the two participants) and Table 2 (iPhone)
  const box = $('zooTable');
  const rows = Z.rows, ours = rows.filter((r) => r.kind === 'ours');
  const f = fmt;
  const min = (vals) => Math.min(...vals.filter((v) => v != null));
  const best = { wer: min(ours.map((r) => r.wer_pub)), t12: min(ours.map((r) => r.t12)), lat: min(ours.map((r) => r.lat)), vram: min(ours.map((r) => r.vram)),
    pwer: min(ours.map((r) => r.phone && r.phone.wer)), plat: min(ours.map((r) => r.phone && r.phone.lat)), pmem: min(ours.map((r) => r.phone && r.phone.mem)) };
  const td = (v, isBest, cls = '', title) => h('td', { class: (isBest ? 'best ' : '') + cls, title }, v);
  const t = h('table', { class: 'zoo' });
  t.append(h('thead', {},
    h('tr', { class: 'grp' }, h('th', {}), h('th', { colspan: 2 }, 'Word error rate · test'), h('th', {}), h('th', { colspan: 2 }, 'NVIDIA A40'), h('th', { colspan: 3, class: 'gl' }, 'iPhone 15 Pro Max · T15 validation')),
    h('tr', {}, ...['Model', 'T15 %', 'T12 %', 'Params B', 'Latency ms', 'GPU MB'].map((c) => h('th', {}, c)),
      ...['WER %', 'Latency ms', 'Memory MB'].map((c, i) => h('th', { class: i ? '' : 'gl' }, c)))));
  const tb = h('tbody'); t.append(tb);
  const sub = (txt) => tb.append(h('tr', { class: 'sub' }, h('td', { colspan: 9 }, txt)));
  sub('FETTUCCINE');
  for (const r of ours) {
    const p = r.phone;
    tb.append(h('tr', {}, h('td', {}, r.name),
      td(f(r.wer_pub), r.wer_pub === best.wer), td(f(r.t12), r.t12 === best.t12), td(f(r.params), false),
      td(f(r.lat, 1), r.lat === best.lat, '', r.lat_sd != null ? `± ${f(r.lat_sd, 1)} ms (s.d.)` : undefined), td(f(r.vram, 0), r.vram === best.vram),
      td(p ? f(p.wer, 1) : '–', p && p.wer === best.pwer, 'gl', p ? `± ${f(p.wer_se, 1)} (s.e.m.)` : undefined),
      td(p ? f(p.lat, 1) : '–', p && p.lat === best.plat),
      td(p ? f(p.mem, 0) + (p.split ? '*' : '') : '–', p && p.mem === best.pmem, '', p && p.split ? 'encoder split in two to fit in memory' : undefined)));
  }
  for (const [g, label] of [['e2e', 'End-to-end, as reported'], ['cascade', 'Cascaded, as reported']]) {
    sub(label);
    for (const r of rows.filter((r) => r.kind !== 'ours' && r.group === g)) {
      tb.append(h('tr', {}, h('td', {}, r.name), h('td', {}, f(r.wer_pub)), h('td', {}, f(r.t12)), h('td', {}, r.params_txt || '–'),
        h('td', {}, r.lat_txt || f(r.lat, 1)), h('td', {}, r.vram_txt || f(r.vram, 0)),
        h('td', { class: 'gl' }, '–'), h('td', {}, '–'), h('td', {}, '–')));
    }
  }
  box.innerHTML = ''; box.append(t);
}

// ------------------------------------------------------------ adaptation
export function initAdaptation(F) {
  let bb = 'whisper';
  const color = () => (bb === 'whisper' ? C.whisper : C.parakeet);
  function bars() {
    const d = F[bb], box = $('ftBars');
    const W = fitW(box, 240, 420), H = 250, m = { l: 40, r: 8, t: 12, b: 40 };
    const s = svg(box, W, H, 'Zero-shot and finetuned WER per held-out session');
    const y = lin(0, 1, H - m.b, m.t), n = d.sessions.length, bw = (W - m.l - m.r) / n;
    const g = el('g', { class: 'grid' }, s);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) { el('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t) }, g); el('text', { x: m.l - 6, y: y(t) + 4, 'text-anchor': 'end', text: Math.round(t * 100) + '%' }, s); }
    d.sessions.forEach((sess, i) => {
      const cx = m.l + bw * (i + 0.5), w = Math.min(14, bw * 0.3);
      const z = d.zero[i], fz = d.full[i];
      const r1 = el('path', { d: barPath(cx - w - 1, y(z), w, y(0)), style: 'fill:var(--fg-3);fill-opacity:.55' }, s);
      const r2 = el('path', { d: barPath(cx + 1, y(fz), w, y(0)), style: `fill:${color()}` }, s);
      hover(r1, () => `<b>${sess}</b><br>zero-shot ${(z * 100).toFixed(1)}% WER`);
      hover(r2, () => `<b>${sess}</b><br>finetuned ${(fz * 100).toFixed(1)}% WER<br>(${d.ntrials[i]} calibration sentences)`);
      el('text', { x: cx, y: H - m.b + 16, 'text-anchor': 'middle', text: sess.slice(5).replace('.', '/') }, s);
    });
    el('line', { x1: m.l, x2: W - m.r, y1: y(d.pt_wer), y2: y(d.pt_wer), style: 'stroke:var(--fg-2);stroke-width:1.5;stroke-dasharray:4 3' }, s);
    el('text', { x: (m.l + W) / 2, y: H - 6, 'text-anchor': 'middle', text: 'held-out day (2024)' }, s);
    // legend lives in the figure bar above the charts
    $('ftSwatch').style.background = color();
    $('ftPt').textContent = `WER on pretraining days (${(d.pt_wer * 100).toFixed(1)}%)`;
  }
  function lines(boxId, xsVals, labels, curves, xLabel, xLog) {
    const box = $(boxId); const W = fitW(box, 240, 420), H = 250, m = { l: 40, r: 10, t: 12, b: 40 };
    const s = svg(box, W, H, xLabel);
    const x = logs(xsVals[0] * 0.8, xsVals[xsVals.length - 1] * 1.25, m.l, W - m.r);
    const y = logs(0.02, 1.1, H - m.b, m.t);
    const g = el('g', { class: 'grid' }, s);
    for (const t of [0.03, 0.1, 0.3, 1]) { el('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t) }, g); el('text', { x: m.l - 6, y: y(t) + 4, 'text-anchor': 'end', text: Math.round(t * 100) + '%' }, s); }
    xsVals.forEach((v, i) => el('text', { x: x(v), y: H - m.b + 16, 'text-anchor': 'middle', text: labels[i] }, s));
    el('text', { x: (m.l + W) / 2, y: H - 6, 'text-anchor': 'middle', text: xLabel }, s);
    const mean = xsVals.map((_, j) => curves.reduce((a, c) => a + c[j], 0) / curves.length);
    const sem = xsVals.map((_, j) => { const mu = mean[j]; const v = curves.reduce((a, c) => a + (c[j] - mu) ** 2, 0) / (curves.length - 1); return Math.sqrt(v / curves.length); });
    for (const c of curves) el('path', { d: c.map((v, j) => `${j ? 'L' : 'M'}${x(xsVals[j])},${y(v)}`).join(''), style: 'fill:none;stroke:var(--fg-3);stroke-width:1;stroke-opacity:.6' }, s);
    const up = xsVals.map((v, j) => `${x(v)},${y(Math.min(1.1, mean[j] + sem[j]))}`), dn = xsVals.map((v, j) => `${x(v)},${y(Math.max(0.021, mean[j] - sem[j]))}`).reverse();
    el('path', { d: 'M' + up.join('L') + 'L' + dn.join('L') + 'Z', style: `fill:${color()};fill-opacity:.15` }, s);
    el('path', { d: mean.map((v, j) => `${j ? 'L' : 'M'}${x(xsVals[j])},${y(v)}`).join(''), style: `fill:none;stroke:${color()};stroke-width:2` }, s);
    mean.forEach((v, j) => { const c = el('circle', { cx: x(xsVals[j]), cy: y(v), r: 4.5, style: `fill:${color()};stroke:var(--bg-2);stroke-width:2` }, s); hover(c, () => `<b>${labels[j]}</b><br>mean ${(v * 100).toFixed(1)}% ± ${(sem[j] * 100).toFixed(1)} (s.e.m.)<br>${curves.length} held-out sessions`); });
  }
  function render() {
    const d = F[bb];
    bars();
    lines('ftMinutes', [1.25, 2.5, 7, 15, 30, 50], ['1.25', '2.5', '7', '15', '30', 'all'], d.fewshot, 'minutes of new-day data');
    lines('ftScaling', d.scaling_n, d.scaling_n.map(String), d.scaling, 'days in pretraining');
  }
  document.querySelectorAll('[data-bb]').forEach((b) => b.addEventListener('click', () => {
    bb = b.dataset.bb; document.querySelectorAll('[data-bb]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); render();
  }));
  responsive($('ftMinutes'), render);
  // swipeable row on narrow screens: dots follow the scroll and jump to a chart
  const gal = $('ftGallery'), cards = [...gal.children], dots = [...$('ftDots').children];
  const mark = (i) => dots.forEach((d, j) => d.setAttribute('aria-selected', String(i === j)));
  dots.forEach((d, i) => d.addEventListener('click', () => gal.scrollTo({ left: cards[i].offsetLeft - cards[0].offsetLeft, behavior: 'smooth' })));
  gal.addEventListener('scroll', () => {
    const x = gal.scrollLeft; let k = 0, bd = Infinity;
    cards.forEach((c, i) => { const d = Math.abs(c.offsetLeft - cards[0].offsetLeft - x); if (d < bd) { bd = d; k = i; } });
    if (gal.scrollLeft + gal.clientWidth >= gal.scrollWidth - 4) k = cards.length - 1;
    mark(k);
  }, { passive: true });
  mark(0);
}
function barPath(x, yTop, w, yBase) { const r = Math.min(3, w / 2, Math.max(0, yBase - yTop)); return `M${x},${yBase}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yBase}Z`; }

// ------------------------------------------------------------ recipe ablations (horizontal bars)
export function recipeChart(R) { const box = $('recipeChart'); responsive(box, () => drawRecipe(R, box)); }
function drawRecipe(R, box) {
  const W = fitW(box, 400, 640), rowH = 26, m = { l: 190, r: 52, t: 6, b: 48 };
  const H = m.t + m.b + rowH * R.length;
  const s = svg(box, W, H, 'Validation WER for each ablation of the recipe');
  const x = lin(0, 14, m.l, W - m.r);
  const g = el('g', { class: 'grid' }, s);
  for (const t of [0, 4, 8, 12]) { el('line', { x1: x(t), x2: x(t), y1: m.t, y2: H - m.b }, g); el('text', { x: x(t), y: H - m.b + 16, 'text-anchor': 'middle', text: t + '%' }, s); }
  el('text', { x: (x(0) + x(14)) / 2, y: H - 8, 'text-anchor': 'middle', text: 'validation word error rate' }, s);
  const base = R[0].val;
  R.forEach((r, i) => {
    const yc = m.t + rowH * i + rowH / 2, full = i === 0;
    el('text', { x: m.l - 10, y: yc + 4, 'text-anchor': 'end', class: full ? 't1' : 't2', text: r.name }, s);
    const p = el('path', { d: hbar(x(0), yc - 6, x(r.val) - x(0), 12), style: `fill:${full ? 'var(--accent)' : 'var(--fg-3)'};fill-opacity:${full ? 1 : 0.6}` }, s);
    el('text', { x: x(r.val) + 6, y: yc + 4, class: 't1', text: r.val.toFixed(2) }, s);
    hover(p, () => `<b>${r.name}</b><br>val ${r.val.toFixed(2)}% · pub ${r.pub.toFixed(2)}% · priv ${r.priv.toFixed(2)}%${full ? '' : `<br>${r.val - base >= 0 ? '+' : ''}${(r.val - base).toFixed(2)} vs full recipe`}`);
  });
  el('line', { x1: x(base), x2: x(base), y1: m.t, y2: H - m.b, style: 'stroke:var(--accent);stroke-width:1;stroke-dasharray:3 3' }, s);
}
function hbar(x, y, w, hh) { const r = Math.min(4, w / 2, hh / 2); return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hh - r}Q${x + w},${y + hh} ${x + w - r},${y + hh}H${x}Z`; }
