/**
 * Speed test engine. All numbers come from real network transfers.
 *
 * Throughput (Mbps) = bytes * 8 / seconds / 1,000,000   (decimal megabits)
 *
 * Latency : round-trip time of tiny (0-byte) requests. The first `warmup`
 *           requests are discarded (they include connection set-up). Where the
 *           browser exposes Resource Timing for the response, the
 *           requestStart -> responseStart interval is used, otherwise the
 *           wall-clock time of the fetch. Reported ping = median of samples.
 * Jitter  : mean absolute difference between consecutive latency samples,
 *           i.e. sum(|rtt[i] - rtt[i-1]|) / (n - 1)  (the RFC 3550 idea,
 *           without the smoothing filter).
 * Download: several parallel streaming fetches for a fixed time; bytes are
 *           counted as they arrive. Bytes in the warm-up window are excluded.
 * Upload  : several parallel XHR POSTs for a fixed time; bytes are counted via
 *           upload progress events (fetch() has no upload progress). Warm-up excluded.
 */

export class TestCancelled extends Error {
  constructor() {
    super('Test cancelled');
    this.name = 'TestCancelled';
  }
}

const toMbps = (bytes, ms) => (bytes * 8) / (ms / 1000) / 1e6;
const round = (n, d = 2) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Mean absolute difference of consecutive samples (documented above). */
export function computeJitter(samples) {
  if (samples.length < 2) return null;
  let sum = 0;
  for (let i = 1; i < samples.length; i++) sum += Math.abs(samples[i] - samples[i - 1]);
  return sum / (samples.length - 1);
}

function bust(url) {
  const id = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  return `${url}${url.includes('?') ? '&' : '?'}r=${id}`;
}

/** AbortController that follows a parent signal and optionally times out. */
function linked(parent, timeoutMs) {
  const c = new AbortController();
  let timedOut = false;
  const onAbort = () => c.abort();
  if (parent.aborted) c.abort();
  else parent.addEventListener('abort', onAbort, { once: true });
  const timer = timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        c.abort();
      }, timeoutMs)
    : null;
  return {
    signal: c.signal,
    abort: () => c.abort(),
    get timedOut() {
      return timedOut;
    },
    dispose() {
      clearTimeout(timer);
      parent.removeEventListener('abort', onAbort);
    },
  };
}

function makePayload(bytes) {
  const buf = new Uint8Array(bytes);
  for (let o = 0; o < bytes; o += 65536) {
    crypto.getRandomValues(buf.subarray(o, Math.min(o + 65536, bytes)));
  }
  // text/plain is a CORS-safelisted type, so no preflight request is needed.
  return new Blob([buf], { type: 'text/plain;charset=UTF-8' });
}

/** Final throughput from byte/time samples, ignoring the warm-up window. */
function steadyMbps(samples, totalBytes, elapsedMs, warmupMs) {
  const w = Math.min(warmupMs, elapsedMs * 0.3);
  const base = samples.find((s) => s.t >= w) || { t: 0, bytes: 0 };
  const dt = elapsedMs - base.t;
  if (dt < 500) return toMbps(totalBytes, elapsedMs);
  return toMbps(totalBytes - base.bytes, dt);
}

export class SpeedTest {
  constructor(config) {
    this.cfg = config;
    this.running = false;
    this._ctrl = null;
  }

  cancel() {
    if (this._ctrl) this._ctrl.abort();
  }

  /**
   * @param {object} cb { onStage(stage), onProgress(0..100), onLive({stage, value}), onStageResult(stage, value, error) }
   * @returns {Promise<{ping,jitter,download,upload,server,errors}>}
   */
  async run(cb = {}) {
    if (this.running) throw new Error('A test is already running');
    this.running = true;
    this._ctrl = new AbortController();
    const signal = this._ctrl.signal;
    const result = { ping: null, jitter: null, download: null, upload: null, server: null, errors: {} };
    const weights = { ping: [0, 12], download: [12, 57], upload: [57, 100] };
    const ctx = (stage) => ({
      signal,
      result,
      progress: (f) => {
        const [a, b] = weights[stage];
        cb.onProgress?.(a + (b - a) * Math.min(1, Math.max(0, f)));
      },
      live: (value) => cb.onLive?.({ stage, value }),
    });

    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error('You appear to be offline.');
      }
      try {
        performance.setResourceTimingBufferSize?.(1000);
      } catch (_) {
        /* ignore */
      }

      const stages = [
        ['ping', (c) => this._ping(c)],
        ['download', (c) => this._download(c)],
        ['upload', (c) => this._upload(c)],
      ];
      for (const [name, fn] of stages) {
        if (signal.aborted) throw new TestCancelled();
        cb.onStage?.(name);
        try {
          await fn(ctx(name));
          cb.onStageResult?.(name, result);
        } catch (err) {
          if (signal.aborted || err instanceof TestCancelled) throw new TestCancelled();
          result.errors[name] = err.message || String(err);
          cb.onStageResult?.(name, result, result.errors[name]);
        }
        ctx(name).progress(1);
      }
      if (result.ping == null && result.download == null && result.upload == null) {
        const first = Object.values(result.errors)[0] || 'Unknown error';
        throw new Error(`All measurements failed. ${first}`);
      }
      cb.onStage?.('done');
      return result;
    } finally {
      this.running = false;
      this._ctrl = null;
    }
  }

  // ---- Ping & jitter -------------------------------------------------------
  async _ping({ signal, result, progress, live }) {
    const { samples, warmup, timeoutMs, minValid } = this.cfg.ping;
    const base = this.cfg.endpoints.ping;
    const rtts = [];
    let failures = 0;
    let lastError = null;
    try {
      performance.clearResourceTimings?.();
    } catch (_) {
      /* ignore */
    }

    for (let i = 0; i < samples + warmup; i++) {
      if (signal.aborted) throw new TestCancelled();
      const url = bust(`${base}?bytes=0`);
      const lc = linked(signal, timeoutMs);
      const t0 = performance.now();
      try {
        const res = await fetch(url, { cache: 'no-store', signal: lc.signal });
        if (!res.ok) throw new Error(`Ping endpoint returned HTTP ${res.status}`);
        await res.arrayBuffer();
        const wall = performance.now() - t0;
        if (i >= warmup) {
          const e = performance.getEntriesByName(url).pop();
          const viaTiming = e && e.responseStart > 0 && e.requestStart > 0 ? e.responseStart - e.requestStart : 0;
          const rtt = viaTiming > 0 ? viaTiming : wall;
          rtts.push(rtt);
          live(rtt);
        }
        const colo = res.headers.get('cf-meta-colo');
        if (colo && !result.server) result.server = colo;
      } catch (err) {
        if (signal.aborted) throw new TestCancelled();
        failures++;
        lastError = lc.timedOut ? 'Ping request timed out' : err.message;
        if (failures >= 4 && rtts.length === 0) throw new Error(lastError || 'Ping failed');
      } finally {
        lc.dispose();
      }
      progress((i + 1) / (samples + warmup));
    }
    if (rtts.length < minValid) {
      throw new Error(lastError || `Only ${rtts.length} valid latency samples were collected`);
    }
    result.ping = round(median(rtts), 1);
    result.jitter = round(computeJitter(rtts), 1);
  }

  // ---- Download ---------------------------------------------------------------
  async _download({ signal, result, progress, live }) {
    const cfg = this.cfg.download;
    const base = this.cfg.endpoints.download;
    if (!base) throw new Error('No download endpoint configured');
    const sc = linked(signal, 0);
    const start = performance.now();
    const samples = [];
    let total = 0;
    let fatal = null;
    let endMs = null;
    let endBytes = 0;

    const worker = async (idx) => {
      let n = 0;
      let consecutiveFailures = 0;
      while (!sc.signal.aborted) {
        const size = cfg.chunkBytes[Math.min(n++, cfg.chunkBytes.length - 1)];
        try {
          const res = await fetch(bust(`${base}?bytes=${size}`), { cache: 'no-store', signal: sc.signal });
          if (!res.ok) throw new Error(`Download endpoint returned HTTP ${res.status}`);
          if (res.body && res.body.getReader) {
            const reader = res.body.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              total += value.byteLength;
            }
          } else {
            total += (await res.arrayBuffer()).byteLength; // no streaming support
          }
          consecutiveFailures = 0;
        } catch (err) {
          if (sc.signal.aborted) return;
          if (++consecutiveFailures >= 3) {
            fatal = err;
            sc.abort();
            return;
          }
        }
      }
    };

    const ticker = setInterval(() => {
      const t = performance.now() - start;
      samples.push({ t, bytes: total });
      const ref = samples.find((s) => s.t >= t - 1000) || samples[0];
      if (t - ref.t > 200) live(toMbps(total - ref.bytes, t - ref.t));
      progress(t / cfg.durationMs);
      if (t >= cfg.durationMs && endMs == null) {
        endMs = t;
        endBytes = total;
        sc.abort();
      }
    }, 100);

    try {
      await Promise.all(Array.from({ length: cfg.streams }, (_, i) => worker(i)));
    } finally {
      clearInterval(ticker);
      sc.dispose();
    }
    if (signal.aborted) throw new TestCancelled();
    if (endMs == null) {
      endMs = performance.now() - start;
      endBytes = total;
    }
    if (fatal && endMs < cfg.minMeasureMs) throw fatal;
    if (endBytes === 0) throw new Error('No data was received from the download endpoint');
    if (endMs < cfg.minMeasureMs) throw new Error('Download finished too quickly to measure reliably');
    result.download = round(steadyMbps(samples, endBytes, endMs, cfg.warmupMs), 2);
    live(result.download);
  }

  // ---- Upload -----------------------------------------------------------------
  async _upload({ signal, result, progress, live }) {
    const cfg = this.cfg.upload;
    const url = this.cfg.endpoints.upload;
    if (!url) throw new Error('No upload endpoint configured. Add one in js/config.js to enable this test.');
    const payload = makePayload(cfg.chunkBytes);
    const sc = linked(signal, 0);
    const start = performance.now();
    const samples = [];
    let total = 0;
    let fatal = null;
    let endMs = null;
    let endBytes = 0;

    const post = () =>
      new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        let last = 0;
        const abort = () => xhr.abort();
        sc.signal.addEventListener('abort', abort, { once: true });
        const cleanup = () => sc.signal.removeEventListener('abort', abort);
        xhr.open('POST', bust(url));
        xhr.upload.onprogress = (e) => {
          total += e.loaded - last;
          last = e.loaded;
        };
        xhr.onload = () => {
          cleanup();
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Upload endpoint returned HTTP ${xhr.status}`));
        };
        xhr.onerror = () => {
          cleanup();
          reject(new Error('Upload request failed (network error or blocked by CORS)'));
        };
        xhr.onabort = () => {
          cleanup();
          resolve(); // stage time is up or the user cancelled; handled by caller
        };
        xhr.send(payload);
      });

    const worker = async () => {
      let failures = 0;
      while (!sc.signal.aborted) {
        try {
          await post();
          failures = 0;
        } catch (err) {
          if (sc.signal.aborted) return;
          if (++failures >= 2) {
            fatal = err;
            sc.abort();
            return;
          }
        }
      }
    };

    const ticker = setInterval(() => {
      const t = performance.now() - start;
      samples.push({ t, bytes: total });
      const ref = samples.find((s) => s.t >= t - 1000) || samples[0];
      if (t - ref.t > 200) live(toMbps(total - ref.bytes, t - ref.t));
      progress(t / cfg.durationMs);
      if (t >= cfg.durationMs && endMs == null) {
        endMs = t;
        endBytes = total;
        sc.abort();
      }
    }, 100);

    try {
      await Promise.all(Array.from({ length: cfg.streams }, worker));
    } finally {
      clearInterval(ticker);
      sc.dispose();
    }
    if (signal.aborted) throw new TestCancelled();
    if (endMs == null) {
      endMs = performance.now() - start;
      endBytes = total;
    }
    if (fatal && endMs < cfg.minMeasureMs) throw fatal;
    if (endBytes === 0) throw new Error('No data could be uploaded to the endpoint');
    if (endMs < cfg.minMeasureMs) throw new Error('Upload finished too quickly to measure reliably');
    result.upload = round(steadyMbps(samples, endBytes, endMs, cfg.warmupMs), 2);
    live(result.upload);
  }
}
