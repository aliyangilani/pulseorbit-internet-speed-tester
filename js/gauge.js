/**
 * Circular speedometer. Non-linear scale so both 5 Mbps and 900 Mbps
 * connections produce a readable needle position.
 */
const TICKS = [0, 5, 10, 25, 50, 100, 250, 500, 1000];
const SWEEP = 270; // degrees
const START = -135; // needle angle at 0 (0deg = straight up)
const NS = 'http://www.w3.org/2000/svg';

export function valueToFraction(v) {
  if (!(v > 0)) return 0;
  if (v >= TICKS[TICKS.length - 1]) return 1;
  for (let i = 0; i < TICKS.length - 1; i++) {
    if (v <= TICKS[i + 1]) return (i + (v - TICKS[i]) / (TICKS[i + 1] - TICKS[i])) / (TICKS.length - 1);
  }
  return 1;
}

export function formatSpeed(v) {
  if (v == null || Number.isNaN(v)) return '—';
  if (v < 10) return v.toFixed(2);
  if (v < 100) return v.toFixed(1);
  return String(Math.round(v));
}

export class Gauge {
  /**
   * @param {{svg: SVGElement, valueEls: HTMLElement[], unitEls: HTMLElement[], reducedMotion: boolean}} o
   */
  constructor({ svg, valueEls, unitEls, reducedMotion }) {
    this.arc = svg.querySelector('.g-arc');
    this.needle = svg.querySelector('.g-needle');
    this.ticks = svg.querySelector('.g-ticks');
    this.valueEls = valueEls;
    this.unitEls = unitEls;
    this.reduced = reducedMotion;
    this.target = 0;
    this.shown = 0;
    this.text = null; // override text (e.g. latency during the ping stage)
    this.raf = 0;
    this._buildTicks();
    this._paint(0);
  }

  _buildTicks() {
    const frag = document.createDocumentFragment();
    TICKS.forEach((t, i) => {
      const a = ((START + (i / (TICKS.length - 1)) * SWEEP - 90) * Math.PI) / 180;
      const mk = (name, attrs) => {
        const el = document.createElementNS(NS, name);
        for (const k in attrs) el.setAttribute(k, attrs[k]);
        return el;
      };
      frag.append(
        mk('line', {
          x1: 150 + 128 * Math.cos(a),
          y1: 150 + 128 * Math.sin(a),
          x2: 150 + 120 * Math.cos(a),
          y2: 150 + 120 * Math.sin(a),
          class: 'g-tick',
        })
      );
      const label = mk('text', {
        x: 150 + 104 * Math.cos(a),
        y: 150 + 104 * Math.sin(a) + 3,
        'text-anchor': 'middle',
        class: 'g-label',
      });
      label.textContent = t;
      frag.append(label);
    });
    this.ticks.append(frag);
  }

  _paint(v) {
    const f = valueToFraction(v);
    this.arc.style.strokeDasharray = `${(f * 100).toFixed(2)} 100`;
    this.needle.setAttribute('transform', `rotate(${(START + f * SWEEP).toFixed(2)} 150 150)`);
    const txt = this.text ?? formatSpeed(this.shown);
    this.valueEls.forEach((el) => (el.textContent = txt));
  }

  /** Show a Mbps value (eased). */
  setValue(v, { instant = false } = {}) {
    this.text = null;
    this.unitEls.forEach((el) => (el.textContent = 'Mbps'));
    this.target = Math.max(0, v || 0);
    if (instant || this.reduced) {
      this.shown = this.target;
      this._paint(this.shown);
    } else this._animate();
  }

  /** Show arbitrary text (e.g. "18 ms") with the needle parked at zero. */
  setText(text, unit) {
    this.text = text;
    this.unitEls.forEach((el) => (el.textContent = unit));
    this.target = 0;
    this._animate();
  }

  reset() {
    this.text = null;
    this.target = 0;
    this.shown = 0;
    this.unitEls.forEach((el) => (el.textContent = 'Mbps'));
    this._paint(0);
    this.valueEls.forEach((el) => (el.textContent = '0'));
  }

  _animate() {
    if (this.raf) return;
    const step = () => {
      this.shown += (this.target - this.shown) * 0.16;
      if (Math.abs(this.target - this.shown) < 0.005 * Math.max(1, this.target)) this.shown = this.target;
      this._paint(this.shown);
      this.raf = this.shown === this.target ? 0 : requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
