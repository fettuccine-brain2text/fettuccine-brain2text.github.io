// FETTUCCINE in-browser decoder (module worker).
// encoder    : neural [1,512,1500] -> ck0..ck3, cv0..cv3 [1,6,1500,64]  (cross-attention K/V per decoder layer)
// decoder_kv : ids [1,n], past_k/v [4,6,P,64], ck*/cv* -> logits [1,51864], present_k/v [4,6,P+n,64]
// Each graph runs on WebGPU or CPU (WebAssembly), whichever measures faster on this device at load time.
// Greedy decoding mirrors the paper's evaluation: Whisper suppress lists, max 30 new tokens,
// stop on <|endoftext|> or 5 consecutive non-alphanumeric tokens.
let ort = null;          // ONNX Runtime Web, loaded below: the WebGPU build only when a GPU adapter exists

const SOT = 50257, NOTS = 50362, EOT = 50256, MAX_NEW = 30, T_CTX = 1500;
let enc = null, dec = null, tok = null, suppress = null, beginSuppress = null, nonalpha = null;

// Model files are kept in Cache Storage (keyed by the manifest version), so a returning visitor
// starts the decoder from disk instead of downloading ~35 MB again. Falls back to plain fetch
// wherever Cache Storage is unavailable (e.g. insecure origins).
let store = null;
async function openStore(version) {
  try {
    if (!self.caches) return null;
    const name = 'fettuccine-model-' + version;
    for (const k of await caches.keys()) if (k.startsWith('fettuccine-model-') && k !== name) caches.delete(k);
    return await caches.open(name);
  } catch (e) { return null; }
}
async function getBytes(url, onBytes) {
  let r = store ? await store.match(url).catch(() => null) : null;
  const fromCache = !!r;
  if (!r) {
    r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    if (store) { try { await store.put(url, r.clone()); } catch (e) { /* quota or opaque: ignore */ } }
  }
  const reader = r.body.getReader(), chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); n += value.byteLength; onBytes(value.byteLength, fromCache);
  }
  const out = new Uint8Array(n); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}
// Model files ship gzip-compressed (wasm runtime 14 -> 3.7 MB, model 47 -> 35 MB) and are inflated here.
// If a server already undid the gzip (Content-Encoding), the magic-byte check skips inflation.
async function inflate(u8) {
  if (!(u8[0] === 0x1f && u8[1] === 0x8b)) return u8;
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function fetchParts(base, parts, onBytes) {
  const bufs = [];
  for (const p of parts) bufs.push(await getBytes(base + p, onBytes));
  const out = new Uint8Array(bufs.reduce((a, b) => a + b.byteLength, 0));
  let o = 0; for (const b of bufs) { out.set(b, o); o += b.byteLength; }
  return out;
}

// A real GPU adapter, or null. Software adapters (SwiftShader, llvmpipe) are far slower than the
// CPU backend, so they are skipped unless the GPU is forced (?backend=gpu).
async function gpuAdapter(force) {
  try {
    if (!(self.navigator && navigator.gpu)) return null;
    const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!a) return null;
    const i = a.info || {};
    const soft = a.isFallbackAdapter || i.isFallbackAdapter || /swiftshader|llvmpipe|software|basic render/i.test(`${i.architecture} ${i.description} ${i.device}`);
    return soft && !force ? null : a;
  } catch (e) { return null; }
}

const PROBE = 'CAg6QQoOCgF4CgF4EgF5IgNBZGQSBXByb2JlWhMKAXgSDgoMCAESCAoCCAEKAggEYhMKAXkSDgoMCAESCAoCCAEKAggEQgQKABAR';   // y = x + x
const CROSS = ['ck0', 'ck1', 'ck2', 'ck3', 'cv0', 'cv1', 'cv2', 'cv3'];   // cross-attention K/V, one per decoder layer
let place = { enc: 'cpu', dec: 'cpu' };
const zeros = () => new ort.Tensor('float32', new Float32Array(512 * T_CTX), [1, 512, T_CTX]);
const emptyPast = () => new ort.Tensor('float32', new Float32Array(0), [4, 6, 0, 64]);
const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];

// Cross K/V must sit where the decoder runs; download GPU tensors when the decoder is on CPU.
async function crossFor(out) {
  const c = {};
  for (const k of CROSS) {
    const t = out[k];
    if (place.dec === 'webgpu' || t.location === 'cpu') { c[k] = t; continue; }
    c[k] = new ort.Tensor('float32', await t.getData(true), t.dims);
  }
  return c;
}
async function timeEncoder(s, runs) {
  if (timeEncoder.last) for (const k of CROSS) timeEncoder.last[k].dispose?.();
  timeEncoder.last = null;
  const ms = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now(); const o = await s.run({ neural: zeros() }); await o.ck3.getData(); ms.push(performance.now() - t);   // GPU runs resolve before the work is done; reading a result waits for it
    if (i < runs - 1) for (const k of CROSS) o[k].dispose?.(); else timeEncoder.last = o;
  }
  return median(ms);
}
async function timeDecoder(s, cross, steps = 6) {
  let pk = emptyPast(), pv = emptyPast(), feed = [SOT, NOTS]; const ms = [];
  for (let i = 0; i < steps; i++) {
    const t = performance.now();
    const r = await s.run({ ids: new ort.Tensor('int64', BigInt64Array.from(feed, BigInt), [1, feed.length]), past_k: pk, past_v: pv, ...cross });
    await r.logits.getData(); ms.push(performance.now() - t);
    pk.dispose?.(); pv.dispose?.(); pk = r.present_k; pv = r.present_v; feed = [220];
  }
  pk.dispose?.(); pv.dispose?.();
  return median(ms.slice(2));   // skip the warm-up steps
}

// prefer: { enc, dec } each 'auto' | 'gpu' | 'cpu'
async function load(base, vendor, prefer, threadsWanted) {
  const manifest = await (await fetch(base + 'manifest.json', { cache: 'no-cache' })).json();
  const wantGpu = (prefer.enc !== 'cpu' || prefer.dec !== 'cpu') && manifest.wasm_gpu;
  const adapter = wantGpu ? await gpuAdapter(prefer.enc === 'gpu' || prefer.dec === 'gpu') : null;
  const useGpu = !!adapter;
  ort = await import(useGpu ? '../vendor/ort.webgpu.bundle.min.js' : '../vendor/ort.wasm.bundle.min.js');
  const runtime = useGpu ? manifest.wasm_gpu : manifest.wasm;
  store = await openStore(manifest.version);
  const total = manifest.encoder.bytes + manifest.decoder.bytes + runtime.bytes + manifest.tokenizer_bytes;
  let loaded = 0, cachedBytes = 0, last = 0;
  const bump = (n, fromCache) => {
    loaded += n; if (fromCache) cachedBytes += n;
    const now = performance.now();
    if (now - last > 80 || loaded >= total) { last = now; postMessage({ type: 'progress', loaded, total, cached: cachedBytes >= loaded }); }
  };
  const cores = navigator.hardwareConcurrency || 1;
  const threads = !self.crossOriginIsolated ? 1 : Math.max(1, Math.min(8, threadsWanted || (cores <= 4 ? cores : cores - 2)));
  ort.env.wasm.numThreads = threads;
  ort.env.logLevel = 'error';
  if (useGpu) ort.env.webgpu.adapter = adapter;
  ort.env.wasm.wasmBinary = (await inflate(await fetchParts(vendor, runtime.parts, bump))).buffer;
  // Start the runtime on a 75-byte graph first. In some browsers a multi-threaded runtime never starts inside a
  // worker; the page watches for this message and restarts the worker single-threaded if it does not arrive.
  postMessage({ type: 'stage', stage: 'runtime-start', threads });
  const probe = await ort.InferenceSession.create(Uint8Array.from(atob(PROBE), (c) => c.charCodeAt(0)), { executionProviders: ['wasm'] });
  await probe.release();
  postMessage({ type: 'stage', stage: 'runtime-ok', threads });
  tok = JSON.parse(new TextDecoder().decode(await getBytes(base + 'tokenizer.json', bump)));
  suppress = tok.suppress; beginSuppress = tok.begin_suppress;
  nonalpha = new Uint8Array(tok.vocab.length);
  for (const i of tok.nonalpha) nonalpha[i] = 1;
  const encBytes = await inflate(await fetchParts(base, manifest.encoder.parts, bump));
  const decBytes = await inflate(await fetchParts(base, manifest.decoder.parts, bump));
  postMessage({ type: 'stage', stage: 'init', cached: cachedBytes >= loaded });

  const opts = (ep, outLoc) => ({ executionProviders: [ep], graphOptimizationLevel: 'all', extra: { session: { disable_quant_qdq: '1' } },
                                  ...(outLoc ? { preferredOutputLocation: outLoc } : {}) });
  const bench = {};
  place = { enc: 'cpu', dec: 'cpu' };
  // Encoder: WebGPU when it is actually faster here. The first GPU run compiles shaders (done now, not on the visitor's first decode).
  if (useGpu && prefer.enc !== 'cpu') {
    try {
      const g = await ort.InferenceSession.create(encBytes, opts('webgpu', 'gpu-buffer'));
      await timeEncoder(g, 1);
      bench.encGpu = await timeEncoder(g, prefer.enc === 'gpu' ? 1 : 2);
      enc = g; place.enc = 'webgpu';
    } catch (e) { console.warn('[fettuccine] WebGPU encoder unavailable:', e); }
  }
  // A slow GPU (e.g. a weak integrated one) can lose to the CPU: measure the CPU too before committing.
  if (place.enc === 'webgpu' && prefer.enc !== 'gpu' && bench.encGpu > 600) {
    const c = await ort.InferenceSession.create(encBytes, opts('wasm'));
    bench.encCpu = await timeEncoder(c, 1);
    if (bench.encCpu < bench.encGpu) { await enc.release(); enc = c; place.enc = 'cpu'; } else await c.release();
  }
  if (!enc) enc = await ort.InferenceSession.create(encBytes, opts('wasm'));
  // Decoder: one token per step, so GPU dispatch overhead can outweigh the compute; time both and keep the faster.
  if (useGpu && prefer.dec !== 'cpu') {
    try {
      const g = await ort.InferenceSession.create(decBytes, opts('webgpu', { logits: 'cpu', present_k: 'gpu-buffer', present_v: 'gpu-buffer' }));
      const sample = timeEncoder.last || await enc.run({ neural: zeros() });
      place.dec = 'webgpu';
      bench.decGpu = await timeDecoder(g, await crossFor(sample));
      dec = g;
      if (prefer.dec !== 'gpu') {
        const c = await ort.InferenceSession.create(decBytes, opts('wasm'));
        place.dec = 'cpu';
        bench.decCpu = await timeDecoder(c, await crossFor(sample));
        if (bench.decCpu < bench.decGpu) { await g.release(); dec = c; } else { await c.release(); place.dec = 'webgpu'; }
      }
      for (const k of CROSS) sample[k].dispose?.();
    } catch (e) { console.warn('[fettuccine] WebGPU decoder unavailable:', e); place.dec = 'cpu'; dec = null; }
  }
  timeEncoder.last = null;
  if (!dec) dec = await ort.InferenceSession.create(decBytes, opts('wasm'));
  postMessage({ type: 'ready', threads, enc: place.enc, dec: place.dec, bench, gpu: useGpu ? (adapter.info?.vendor || 'gpu') : null, cached: cachedBytes >= loaded });
}

// ---- tokenizer (GPT-2 byte-level BPE, decode only) ----
const byteDecoder = (() => {
  const bs = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = bs.slice(); let n = 0;
  for (let b = 0; b < 256; b++) if (!bs.includes(b)) { bs.push(b); cs.push(256 + n); n++; }
  const m = new Map(); bs.forEach((b, i) => m.set(String.fromCharCode(cs[i]), b));
  return m;
})();
function decodeIds(ids) {
  const bytes = [];
  for (const id of ids) {
    if (id >= EOT) continue;
    for (const ch of tok.vocab[id]) bytes.push(byteDecoder.get(ch) ?? 63);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

async function decode(features, jobId) {
  const t0 = performance.now();
  const out = await enc.run({ neural: new ort.Tensor('float32', features, [1, 512, T_CTX]) });
  const cross = await crossFor(out);
  if (cross.ck3.location === 'gpu-buffer') await cross.ck3.getData();   // wait for the GPU so the encode time shown is real
  const t1 = performance.now();
  postMessage({ type: 'encoded', jobId, ms: t1 - t0 });
  const ids = [SOT, NOTS], gen = [];
  let feed = ids.slice(), pk = emptyPast(), pv = emptyPast();
  for (let step = 0; step < MAX_NEW; step++) {
    const r = await dec.run({ ids: new ort.Tensor('int64', BigInt64Array.from(feed, BigInt), [1, feed.length]), past_k: pk, past_v: pv, ...cross });
    pk.dispose?.(); pv.dispose?.(); pk = r.present_k; pv = r.present_v;
    const l = await r.logits.getData();
    for (const s of suppress) l[s] = -Infinity;
    if (step === 0) for (const s of beginSuppress) l[s] = -Infinity;
    let am = 0; for (let i = 1; i < l.length; i++) if (l[i] > l[am]) am = i;
    ids.push(am); feed = [am];
    if (am === EOT) break;
    gen.push(am);
    postMessage({ type: 'token', jobId, text: decodeIds(gen), step, ms: performance.now() - t1 });
    if (ids.length >= 5 && ids.slice(-5).every((i) => nonalpha[i])) break;
  }
  const t2 = performance.now();
  pk.dispose?.(); pv.dispose?.();
  for (const k of CROSS) { out[k].dispose?.(); cross[k].dispose?.(); }
  postMessage({ type: 'done', jobId, ids: gen, text: decodeIds(gen), encMs: t1 - t0, decMs: t2 - t1, steps: gen.length });
}

let queue = Promise.resolve();
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'load') {
    queue = queue.then(() => load(m.base, m.vendor, m.prefer, m.threads)).catch((err) => postMessage({ type: 'error', stage: 'load', message: String(err && err.message || err) }));
  } else if (m.type === 'decode') {
    queue = queue.then(() => decode(m.features, m.jobId)).catch((err) => postMessage({ type: 'error', stage: 'decode', jobId: m.jobId, message: String(err && err.message || err) }));
  }
};
