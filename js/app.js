import { CONFIG } from './config.js';
import { SpeedTest, TestCancelled } from './speed-test.js';
import { initTheme, currentTheme } from './theme.js';
import { Gauge, formatSpeed, valueToFraction } from './gauge.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// ---------------------------------------------------------------- config -> DOM
$$('[data-github]').forEach((a) => (a.href = CONFIG.repoUrl));
$$('[data-provider]').forEach((el) => (el.textContent = CONFIG.endpoints.provider));

// ---------------------------------------------------------------- theme
initTheme($('#themeToggle'));

// ---------------------------------------------------------------- mobile nav
const nav = $('#nav');
const menuBtn = $('#menuBtn');
function setMenu(open) {
  nav.classList.toggle('open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
  menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
}
menuBtn.addEventListener('click', () => setMenu(!nav.classList.contains('open')));
nav.addEventListener('click', (e) => e.target.closest('a') && setMenu(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && nav.classList.contains('open')) {
    setMenu(false);
    menuBtn.focus();
  }
});

// ---------------------------------------------------------------- toast
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------------------------------------------------------------- 3D scene (optional)
let scene = null;
const stageEl = $('#stage');
(async () => {
  try {
    const { createScene } = await import('./3d-scene.js');
    scene = await createScene(stageEl, { theme: currentTheme(), reducedMotion });
    scene.setStage(state.running ? state.stage : 'idle');
  } catch (err) {
    console.warn('3D scene unavailable, using CSS fallback:', err.message);
    scene = null;
  }
})();
document.addEventListener('themechange', (e) => scene?.setTheme(e.detail.theme));

// ---------------------------------------------------------------- gauge
const gauge = new Gauge({
  svg: $('#gauge'),
  valueEls: [$('#gaugeValue'), $('#hudValue')],
  unitEls: [$('#gaugeUnit'), $('#hudUnit')],
  reducedMotion,
});
const gaugeWrap = $('#gaugeWrap');
if (!reducedMotion && window.matchMedia?.('(pointer: fine)').matches) {
  gaugeWrap.addEventListener('pointermove', (e) => {
    const r = gaugeWrap.getBoundingClientRect();
    gaugeWrap.style.setProperty('--ty', `${((e.clientX - r.left) / r.width - 0.5) * 10}deg`);
    gaugeWrap.style.setProperty('--tx', `${-((e.clientY - r.top) / r.height - 0.5) * 10}deg`);
  });
  gaugeWrap.addEventListener('pointerleave', () => {
    gaugeWrap.style.setProperty('--ty', '0deg');
    gaugeWrap.style.setProperty('--tx', '0deg');
  });
}

// ---------------------------------------------------------------- UI helpers
const STAGE_LABEL = { ping: 'Latency', download: 'Download', upload: 'Upload', done: 'Complete', idle: 'Ready' };
const STAGE_STATUS = {
  ping: 'Measuring latency and jitter…',
  download: 'Measuring download speed…',
  upload: 'Measuring upload speed…',
};
const fmtMs = (v) => (v == null ? '—' : v < 10 ? v.toFixed(1) : String(Math.round(v)));

const ui = {
  startBtns: $$('[data-start]'),
  status: $('#status'),
  banner: $('#banner'),
  progress: $('#progress'),
  bar: $('#progressBar'),
  hudBar: $('#hudBar'),
  hudStage: $('#hudStage'),
  gaugeLabel: $('#gaugeLabel'),
  card: $('#gaugeCard'),
  copy: $('#copyBtn'),
  share: $('#shareBtn'),
};

const state = { running: false, stage: 'idle', last: null };
const test = new SpeedTest(CONFIG);

function setStatus(text) {
  ui.status.textContent = text;
}
function showBanner(text, kind = 'error') {
  ui.banner.hidden = !text;
  ui.banner.textContent = text || '';
  ui.banner.classList.toggle('warn', kind === 'warn');
}
function setProgress(p) {
  const v = Math.round(p);
  ui.bar.style.width = `${p}%`;
  ui.hudBar.style.width = `${p}%`;
  ui.progress.setAttribute('aria-valuenow', String(v));
}
function setStartButtons(label, cancel) {
  ui.startBtns.forEach((b) => {
    b.textContent = label;
    b.classList.toggle('is-cancel', cancel);
  });
}
function setStageUI(stage, errors = {}) {
  $$('#stages li').forEach((li) => {
    const name = li.dataset.stage;
    const order = ['ping', 'download', 'upload'];
    li.classList.remove('active', 'done', 'error');
    if (errors[name]) li.classList.add('error');
    else if (stage === 'done' || order.indexOf(name) < order.indexOf(stage)) li.classList.add('done');
    else if (name === stage) li.classList.add('active');
  });
  const label = STAGE_LABEL[stage] || 'Ready';
  ui.gaugeLabel.textContent = label;
  ui.hudStage.textContent = label;
}

const metricEl = (n) => $(`[data-metric="${n}"]`);
function setMetric(name, value, { live = false, error = null } = {}) {
  const card = metricEl(name);
  const fmt = name === 'download' || name === 'upload' ? formatSpeed : fmtMs;
  $(`#m-${name}`).textContent = error ? '—' : fmt(value);
  card.classList.toggle('is-live', live);
  card.classList.toggle('is-unavailable', !!error);
  $(`#n-${name}`).textContent = error ? `Unavailable: ${error}` : live ? 'Measuring…' : value == null ? 'Not measured yet' : 'Measured';
}
function resetMetrics() {
  ['download', 'upload', 'ping', 'jitter'].forEach((n) => setMetric(n, null));
}

// ---------------------------------------------------------------- run / cancel
async function startTest() {
  if (state.running) return;
  state.running = true;
  state.last = null;
  ui.copy.disabled = ui.share.disabled = true;
  ui.card.classList.remove('is-complete');
  showBanner('');
  resetMetrics();
  gauge.reset();
  setProgress(0);
  setStartButtons('CANCEL TEST', true);
  scene?.setStage('ping');

  const setStage = (s) => {
    state.stage = s;
    setStageUI(s, state.errors);
    scene?.setStage(s);
    if (STAGE_STATUS[s]) setStatus(STAGE_STATUS[s]);
    if (s === 'ping') gauge.setText('—', 'ms');
    if (s === 'download' || s === 'upload') {
      gauge.setValue(0, { instant: true });
    }
  };
  state.errors = {};

  try {
    const result = await test.run({
      onStage: setStage,
      onProgress: setProgress,
      onLive: ({ stage, value }) => {
        if (stage === 'ping') {
          gauge.setText(fmtMs(value), 'ms');
          setMetric('ping', value, { live: true });
        } else {
          gauge.setValue(value);
          scene?.setLevel(valueToFraction(value));
          setMetric(stage, value, { live: true });
        }
      },
      onStageResult: (stage, r, error) => {
        if (error) {
          state.errors[stage] = error;
          setStageUI(state.stage, state.errors);
        }
        if (stage === 'ping') {
          setMetric('ping', r.ping, { error: error });
          setMetric('jitter', r.jitter, { error: error });
        } else {
          setMetric(stage, r[stage], { error });
        }
      },
    });
    finish(result);
  } catch (err) {
    if (err instanceof TestCancelled) {
      setStatus('Test cancelled.');
      showBanner('');
      resetMetrics();
      gauge.reset();
      setProgress(0);
    } else {
      setStatus('Test failed.');
      showBanner(`${err.message.replace(/\.?$/, '.')} Check your connection and the endpoints in js/config.js, then try again.`);
      resetMetrics();
      gauge.reset();
    }
    setStageUI('idle');
    scene?.setStage('idle');
    setStartButtons(err instanceof TestCancelled ? 'START TEST' : 'TRY AGAIN', false);
  } finally {
    state.running = false;
  }
}

function finish(result) {
  state.stage = 'done';
  state.last = { ...result, ts: Date.now() };
  setProgress(100);
  setStageUI('done', result.errors);
  const headline = result.download ?? result.upload;
  if (headline != null) gauge.setValue(headline);
  else gauge.setText('—', 'Mbps');
  ui.gaugeLabel.textContent = result.download != null ? 'Download' : result.upload != null ? 'Upload' : 'Complete';
  ui.card.classList.add('is-complete');
  scene?.setStage('done');
  scene?.pulse();

  const failed = Object.keys(result.errors);
  if (failed.length) {
    setStatus('Test finished with some measurements unavailable.');
    showBanner(failed.map((k) => `${k[0].toUpperCase() + k.slice(1)}: ${result.errors[k]}`).join(' · '), 'warn');
  } else {
    setStatus(`Done. Measured against ${CONFIG.endpoints.provider}${result.server ? ` (${result.server})` : ''}.`);
  }
  setStartButtons('TEST AGAIN', false);
  ui.copy.disabled = ui.share.disabled = false;
  saveHistory(state.last);
}

function onStartClick() {
  if (state.running) {
    test.cancel();
    setStatus('Cancelling…');
  } else startTest();
}
ui.startBtns.forEach((b) => b.addEventListener('click', onStartClick));

// Stop network activity if the page is being closed.
window.addEventListener('pagehide', () => test.cancel());

// ---------------------------------------------------------------- copy / share
function summary(r) {
  const d = new Date(r.ts).toLocaleString();
  const v = (x, u) => (x == null ? 'unavailable' : `${x} ${u}`);
  return [
    `${CONFIG.brand} speed test — ${d}`,
    `Download: ${v(r.download, 'Mbps')}`,
    `Upload: ${v(r.upload, 'Mbps')}`,
    `Ping: ${v(r.ping, 'ms')}`,
    `Jitter: ${v(r.jitter, 'ms')}`,
    `(Browser-based estimate via ${CONFIG.endpoints.provider})`,
  ].join('\n');
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (_) {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
ui.copy.addEventListener('click', async () => {
  if (!state.last) return;
  toast((await copyText(summary(state.last))) ? 'Results copied to clipboard' : 'Copy failed — select and copy manually');
});
ui.share.addEventListener('click', async () => {
  if (!state.last) return;
  const text = summary(state.last);
  if (navigator.share) {
    try {
      await navigator.share({ title: `${CONFIG.brand} speed test`, text });
    } catch (err) {
      if (err.name !== 'AbortError') toast('Sharing failed');
    }
  } else {
    toast((await copyText(text)) ? 'Sharing not supported here — copied to clipboard instead' : 'Sharing is not supported in this browser');
  }
});

// ---------------------------------------------------------------- history
const histEls = {
  empty: $('#historyEmpty'),
  table: $('#historyTable'),
  body: $('#historyBody'),
  chart: $('#historyChart'),
  clear: $('#clearBtn'),
};
function loadHistory() {
  try {
    const v = JSON.parse(localStorage.getItem(CONFIG.historyKey) || '[]');
    return Array.isArray(v) ? v : [];
  } catch (_) {
    return [];
  }
}
function storeHistory(list) {
  try {
    localStorage.setItem(CONFIG.historyKey, JSON.stringify(list));
  } catch (_) {
    toast('Could not save history (storage unavailable)');
  }
}
function saveHistory(r) {
  const list = loadHistory();
  list.unshift({ ts: r.ts, download: r.download, upload: r.upload, ping: r.ping, jitter: r.jitter });
  storeHistory(list.slice(0, CONFIG.maxHistory));
  renderHistory();
}
function renderHistory() {
  const list = loadHistory();
  const has = list.length > 0;
  histEls.empty.hidden = has;
  histEls.table.hidden = !has;
  histEls.chart.hidden = !has;
  histEls.clear.disabled = !has;
  histEls.body.textContent = '';
  const cell = (tr, text, na) => {
    const td = document.createElement('td');
    td.textContent = text;
    if (na) td.className = 'na';
    tr.append(td);
  };
  list.forEach((e) => {
    const tr = document.createElement('tr');
    cell(tr, new Date(e.ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }));
    cell(tr, e.download == null ? 'n/a' : `${formatSpeed(e.download)} Mbps`, e.download == null);
    cell(tr, e.upload == null ? 'n/a' : `${formatSpeed(e.upload)} Mbps`, e.upload == null);
    cell(tr, e.ping == null ? 'n/a' : `${fmtMs(e.ping)} ms`, e.ping == null);
    cell(tr, e.jitter == null ? 'n/a' : `${fmtMs(e.jitter)} ms`, e.jitter == null);
    histEls.body.append(tr);
  });
  if (has) drawChart([...list].reverse());
}
function drawChart(items) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = histEls.chart;
  svg.textContent = '';
  const max = Math.max(1, ...items.flatMap((e) => [e.download || 0, e.upload || 0]));
  const slot = 320 / Math.max(items.length, 6);
  const bw = Math.min(14, slot / 2.6);
  const mk = (n, a) => {
    const el = document.createElementNS(NS, n);
    for (const k in a) el.setAttribute(k, a[k]);
    return el;
  };
  svg.append(mk('line', { x1: 0, y1: 78, x2: 320, y2: 78, class: 'axis' }));
  items.forEach((e, i) => {
    const x = i * slot + slot / 2;
    [['download', 'bar-d', -bw], ['upload', 'bar-u', 0]].forEach(([k, cls, dx]) => {
      const v = e[k];
      if (v == null) return;
      const h = Math.max(1.5, (v / max) * 66);
      const rect = mk('rect', { x: x + dx, y: 78 - h, width: bw - 1, height: h, rx: 2, class: cls });
      const t = document.createElementNS(NS, 'title');
      t.textContent = `${k}: ${formatSpeed(v)} Mbps`;
      rect.append(t);
      svg.append(rect);
    });
  });
  const lg = (x, cls, label) => {
    svg.append(mk('rect', { x, y: 84, width: 6, height: 6, rx: 1.5, class: cls }));
    const t = mk('text', { x: x + 9, y: 90, class: 'legend' });
    t.textContent = label;
    svg.append(t);
  };
  lg(0, 'bar-d', 'Download');
  lg(60, 'bar-u', `Upload (max ${formatSpeed(max)} Mbps)`);
}
histEls.clear.addEventListener('click', () => {
  if (!loadHistory().length) return;
  try {
    localStorage.removeItem(CONFIG.historyKey);
  } catch (_) {
    /* ignore */
  }
  renderHistory();
  toast('History cleared');
});

// ---------------------------------------------------------------- init
renderHistory();
setStageUI('idle');
