// FETTUCCINE project page: bootstrap.
import { initHero } from './hero.js';
import { initDemo } from './demo.js';
import { pipeline, initAugment } from './method.js';
import { latencyChart, initRace, memoryChart, werChart, bestTable, zooTable, initAdaptation, recipeChart } from './charts.js';

// ---- theme: the device's setting, dark if it has none; the toggle's choice is stored per viewer
// (and applied before first paint by the inline script in <head>) ----
const root = document.documentElement;
const fire = () => window.dispatchEvent(new Event('themechange'));
document.getElementById('themeBtn').addEventListener('click', () => {
  const light = root.dataset.theme ? root.dataset.theme === 'light' : matchMedia('(prefers-color-scheme: light)').matches;
  root.dataset.theme = light ? 'dark' : 'light';
  try { localStorage.setItem('fettuccine-theme', root.dataset.theme); } catch (e) { /* storage unavailable */ }
  fire();
});
matchMedia('(prefers-color-scheme: light)').addEventListener('change', fire);

// ---- copy BibTeX ----
document.getElementById('copyBib').addEventListener('click', async (e) => {
  const btn = e.currentTarget, txt = document.getElementById('bibtex').textContent;
  try { await navigator.clipboard.writeText(txt); btn.lastElementChild.textContent = 'Copied'; }
  catch (err) { const r = document.createRange(); r.selectNodeContents(document.getElementById('bibtex')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); btn.lastElementChild.textContent = 'Selected'; }
  setTimeout(() => (btn.lastElementChild.textContent = 'Copy'), 1600);
});

// ---- paper / arXiv links: set in config.js; missing ones show as disabled ----
const links = (window.FETTUCCINE && window.FETTUCCINE.links) || {};
document.querySelectorAll('[data-todo]').forEach((a) => {
  const url = links[a.dataset.todo];
  if (url) { a.href = url; a.target = '_blank'; a.rel = 'noopener'; }
  else { a.setAttribute('aria-disabled', 'true'); a.removeAttribute('href'); a.title = 'Link coming soon'; }
});

// ---- data, loaded lazily ----
// The hero gets its own small file so it can start right away; everything else (charts, demo
// trials, saliency) is fetched only when its section comes within ~one screen of the viewport.
const get = (p) => fetch('assets/data/' + p).then((r) => { if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); });
const once = (fn) => { let p; return () => (p = p || fn()); };
const site = once(() => get('site.json'));
const trials = once(() => get('trials/index.json'));
const safe = (name, fn) => { try { const r = fn(); if (r && r.catch) r.catch((e) => console.error(name, e)); } catch (e) { console.error(name, e); } };
function near(ids, fn, margin = '700px') {
  let done = false;
  const io = new IntersectionObserver((es) => {
    if (done || !es.some((e) => e.isIntersecting)) return;
    done = true; io.disconnect(); fn().catch((e) => console.error(ids[0], e));
  }, { rootMargin: margin });
  ids.map((id) => document.getElementById(id)).filter(Boolean).forEach((el) => io.observe(el));
}

// "Open on your phone" QR: only on the published site, on desktop
const qr = document.getElementById('qr');
if (qr && qr.dataset.site && (location.origin + '/' === qr.dataset.site || new URLSearchParams(location.search).has('qr')) && matchMedia('(pointer: fine)').matches) qr.hidden = false;

get('hero.json').then((h) => safe('hero', () => initHero(h))).catch((e) => console.error('hero', e));
near(['demo', 'inside'], async () => { const [s, i] = await Promise.all([site(), trials()]); safe('demo', () => initDemo(i, s)); });
near(['method'], async () => { safe('pipeline', pipeline); });
near(['augment'], async () => { const s = await site(); safe('augment', () => initAugment(s.aug)); safe('recipe', () => recipeChart(s.recipe)); });
near(['results'], async () => { const s = await site(); safe('wer', () => werChart(s.zoo)); safe('best', () => bestTable(s.zoo)); safe('zoo', () => zooTable(s.zoo)); });
near(['latency'], async () => { const s = await site(); safe('latency', () => latencyChart(s.latency)); safe('race', () => initRace(s.latency_paired)); });
near(['mobile'], async () => { const s = await site(); safe('memory', () => memoryChart(s.memory, s.zoo)); });
near(['adaptation'], async () => { const s = await site(); safe('adapt', () => initAdaptation(s.finetune)); });
