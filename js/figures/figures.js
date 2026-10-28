// Controllers for the two live figures on the home page: Fig. 1, the SN2 reaction with its energy
// profile, and Fig. 2, the Lennard-Jones fluid with its thermostat and speed distribution. Each one
// renders only while it is on screen.
import * as THREE from 'three';
import { createFluid, maxwellBoltzmann } from './lj-engine.js';
import { createLiquidScene } from './liquid-scene.js';
import { COMPLEX_ENERGY, COMPLEX_XI, TS_ENERGY, energy, geometry, stage } from './reaction-model.js';
import { createReactionScene } from './reaction-scene.js';

const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const MINUS = '−';
const SVG = 'http://www.w3.org/2000/svg';

const signed = (v, digits) => `${v < 0 ? MINUS : '+'}${Math.abs(v).toFixed(digits)}`;
const plain = (v, digits) => `${v < 0 ? MINUS : ''}${Math.abs(v).toFixed(digits)}`;
const cssColor = (el, name, fallback) => getComputedStyle(el).getPropertyValue(name).trim() || fallback;
const byAttribute = (root, attr) => Object.fromEntries([...root.querySelectorAll(`[${attr}]`)].map((el) => [el.getAttribute(attr), el]));

function svg(parent, tag, attrs = {}, text) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  parent.append(el);
  return el;
}

// Runs `draw` on every animation frame while `el` is on screen and the tab is visible, and calls
// `onShow` whenever it scrolls into or out of view.
function whileVisible(el, draw, onShow) {
  let visible = false;
  let last = performance.now();
  const loop = (now) => {
    requestAnimationFrame(loop);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (visible && !document.hidden) draw(dt, now);
  };
  requestAnimationFrame(loop);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    onShow();
  }).observe(el);
}

/* Fig. 1: Cl⁻ + CH₃Cl → ClCH₃ + Cl⁻ */
const PLOT = { width: 360, height: 214, left: 44, right: 14, top: 26, bottom: 40, eMax: 20, eMin: -50 };
const plotX = (xi) => PLOT.left + ((xi + 4) / 8) * (PLOT.width - PLOT.left - PLOT.right);
const plotY = (e) => PLOT.top + ((PLOT.eMax - e) / (PLOT.eMax - PLOT.eMin)) * (PLOT.height - PLOT.top - PLOT.bottom);
const chlorine = (order) => (order > 0.8 ? 'Cl' : order < 0.2 ? 'Cl⁻' : 'Clᵟ⁻');

function drawEnergyPlot(plot) {
  for (const e of [20, 0, -20, -40]) {
    const g = svg(plot, 'g', { class: 'plot-grid' });
    svg(g, 'line', { x1: PLOT.left, x2: PLOT.width - PLOT.right, y1: plotY(e), y2: plotY(e) });
    svg(g, 'text', { x: PLOT.left - 7, y: plotY(e) + 3, 'text-anchor': 'end' }, e > 0 ? `+${e}` : plain(e, 0));
  }
  for (const xi of [-4, -2, 0, 2, 4]) {
    svg(plot, 'text', { class: 'plot-tick', x: plotX(xi), y: PLOT.height - PLOT.bottom + 15, 'text-anchor': 'middle' }, plain(xi, 0));
  }
  svg(plot, 'text', { class: 'plot-axis', x: PLOT.width - PLOT.right, y: PLOT.height - 6, 'text-anchor': 'end' }, 'ξ = r(C–Clᵃ) − r(C–Clᵇ) / Å');
  svg(plot, 'text', { class: 'plot-axis', x: PLOT.left - 36, y: PLOT.top - 12 }, 'E / kJ mol⁻¹');
  const d = Array.from({ length: 161 }, (_, i) => {
    const xi = -4 + (8 * i) / 160;
    return `${i ? 'L' : 'M'}${plotX(xi).toFixed(1)},${plotY(energy(xi)).toFixed(1)}`;
  }).join('');
  svg(plot, 'path', { class: 'plot-curve', d });
  svg(plot, 'text', { class: 'plot-note', x: plotX(0), y: plotY(TS_ENERGY) - 9, 'text-anchor': 'middle' }, 'TS‡ ≈ +11');
  svg(plot, 'text', { class: 'plot-note', x: plotX(-COMPLEX_XI), y: plotY(COMPLEX_ENERGY) + 16, 'text-anchor': 'middle' }, 'complex ≈ −44');
  svg(plot, 'text', { class: 'plot-note', x: plotX(COMPLEX_XI), y: plotY(COMPLEX_ENERGY) + 16, 'text-anchor': 'middle' }, 'complex');
  const cursor = svg(plot, 'line', { class: 'plot-cursor', y1: PLOT.top, y2: PLOT.height - PLOT.bottom });
  const marker = svg(plot, 'circle', { class: 'plot-marker', r: 5.5 });
  return { cursor, marker };
}

function mountReaction(figure) {
  const view = figure.querySelector('.reaction-view');
  const canvas = view.querySelector('canvas');
  const plot = figure.querySelector('.energy-plot');
  const playButton = figure.querySelector('.play-toggle');
  const readouts = byAttribute(figure, 'data-readout');
  const labels = byAttribute(figure, 'data-label');
  const { cursor, marker } = drawEnergyPlot(plot);
  const state = { playing: !REDUCE, scrubbing: false, xi: REDUCE ? 0 : -3.2, direction: 1, dirty: true };

  let shownA = '';
  let shownB = '';
  const update = (xi) => {
    const g = geometry(xi);
    const e = energy(xi);
    marker.setAttribute('cx', plotX(xi).toFixed(1));
    marker.setAttribute('cy', plotY(e).toFixed(1));
    cursor.setAttribute('x1', plotX(xi).toFixed(1));
    cursor.setAttribute('x2', plotX(xi).toFixed(1));
    readouts.xi.textContent = `${signed(xi, 2)} Å`;
    readouts.rA.textContent = `${g.rA.toFixed(2)} Å`;
    readouts.rB.textContent = `${g.rB.toFixed(2)} Å`;
    readouts.angle.textContent = `${g.hcclA.toFixed(1)}°`;
    readouts.energy.textContent = signed(e, 1);
    readouts.stage.textContent = stage(xi);
    plot.setAttribute('aria-valuenow', xi.toFixed(2));
    plot.setAttribute('aria-valuetext', `${stage(xi)}, ξ ${xi.toFixed(2)} ångström`);
    const a = chlorine(g.a);
    const b = chlorine(g.b);
    if (a !== shownA) labels.a.textContent = shownA = a;
    if (b !== shownB) labels.b.textContent = shownB = b;
    labels.dA.textContent = `${g.rA.toFixed(2)} Å`;
    labels.dB.textContent = `${g.rB.toFixed(2)} Å`;
    labels.ts.classList.toggle('is-on', Math.abs(xi) < 0.32);
  };

  // Autoplay moves along ξ faster where the energy is low, and pauses at each end.
  let pause = 0;
  const advance = (dt) => {
    if (pause > 0) {
      pause -= dt;
      return;
    }
    const kinetic = Math.max(14 - energy(state.xi), 1.4);
    state.xi += state.direction * 0.25 * Math.sqrt(kinetic) * dt;
    if (state.xi >= 4 || state.xi <= -4) {
      state.xi = Math.min(4, Math.max(-4, state.xi));
      state.direction *= -1;
      pause = 0.9;
    }
  };

  let scene = null;
  try {
    scene = createReactionScene(THREE, {
      canvas,
      labels,
      colors: {
        ink: cssColor(figure, '--ink', '#17201f'),
        carbon: cssColor(figure, '--atom-carbon', '#3a4443'),
        hydrogen: cssColor(figure, '--atom-hydrogen', '#f7f4ee'),
        bond: cssColor(figure, '--atom-bond', '#a9aeaa'),
        a: cssColor(figure, '--signal-a', '#13968d'),
        b: cssColor(figure, '--signal-b', '#e2525c'),
        partial: cssColor(figure, '--signal-ab', '#7a4fcf'),
      },
    });
    view.dataset.ready = 'true';
  } catch (err) {
    view.dataset.fallback = 'true';
  }

  let time = 0;
  let settle = 0;
  whileVisible(view, (dt) => {
    const running = state.playing && !state.scrubbing;
    if (running) {
      time += dt;
      advance(dt);
    }
    if (state.dirty) {
      state.dirty = false;
      settle = 45; // let the camera ease into place after a jump
    }
    if (!running && settle <= 0) return;
    settle -= 1;
    update(state.xi);
    scene?.frame(state.xi, time, running ? 0.05 : 0.18);
  }, () => { state.dirty = true; });

  const resize = () => {
    const { width, height } = view.getBoundingClientRect();
    scene?.resize(width, height);
    state.dirty = true;
  };
  new ResizeObserver(resize).observe(view);
  update(state.xi);

  const setPlaying = (playing) => {
    state.playing = playing;
    state.dirty = true;
    playButton.textContent = playing ? 'Pause' : 'Play';
    playButton.setAttribute('aria-pressed', String(!playing));
  };
  setPlaying(state.playing);
  playButton.addEventListener('click', () => setPlaying(!state.playing));

  view.addEventListener('pointermove', (event) => {
    const rect = view.getBoundingClientRect();
    scene?.sway(((event.clientX - rect.left) / rect.width) * 2 - 1);
    state.dirty = true;
  });
  view.addEventListener('pointerleave', () => scene?.sway(0));

  // Drag along the energy profile, or use the keyboard, to scrub through the reaction.
  const scrubTo = (event) => {
    const rect = plot.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / rect.width) * PLOT.width;
    const xi = Math.min(4, Math.max(-4, -4 + ((svgX - PLOT.left) / (PLOT.width - PLOT.left - PLOT.right)) * 8));
    if (xi !== state.xi) state.direction = xi > state.xi ? 1 : -1;
    state.xi = xi;
    state.dirty = true;
  };
  plot.addEventListener('pointerdown', (event) => {
    state.scrubbing = true;
    plot.setPointerCapture(event.pointerId);
    scrubTo(event);
  });
  plot.addEventListener('pointermove', (event) => {
    if (state.scrubbing) scrubTo(event);
  });
  const endScrub = () => {
    state.scrubbing = false;
    state.dirty = true;
  };
  plot.addEventListener('pointerup', endScrub);
  plot.addEventListener('pointercancel', endScrub);
  plot.addEventListener('keydown', (event) => {
    const steps = { ArrowLeft: -0.1, ArrowDown: -0.1, ArrowRight: 0.1, ArrowUp: 0.1, PageDown: -1, PageUp: 1 };
    if (event.key === 'Home' || event.key === 'End' || steps[event.key] !== undefined) {
      event.preventDefault();
      if (state.playing) setPlaying(false);
      const next = event.key === 'Home' ? -4 : event.key === 'End' ? 4 : state.xi + steps[event.key];
      state.xi = Math.min(4, Math.max(-4, next));
      state.dirty = true;
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      setPlaying(!state.playing);
    }
  });
}

/* Fig. 2: a Lennard-Jones fluid with a thermostat */
const FLUID = { count: 216, density: 0.4, start: 1.6, target: 0.75, dt: 0.005, stepsPerFrame: 4 };
const HIST = { width: 300, height: 128, left: 10, right: 10, top: 10, bottom: 24, bins: 24, vMax: 4.8, yMax: 1.05 };
const histX = (v) => HIST.left + (v / HIST.vMax) * (HIST.width - HIST.left - HIST.right);
const histY = (p) => HIST.top + (1 - Math.min(p, HIST.yMax) / HIST.yMax) * (HIST.height - HIST.top - HIST.bottom);

function mountLiquid(figure) {
  const view = figure.querySelector('.liquid-view');
  const canvas = view.querySelector('canvas');
  const readouts = byAttribute(figure, 'data-readout');
  const presets = [...figure.querySelectorAll('[data-preset]')];
  const range = figure.querySelector('input[type="range"]');
  const output = figure.querySelector('.range output');
  const playButton = figure.querySelector('[data-action="play"]');
  const resetButton = figure.querySelector('[data-action="reset"]');

  const chart = figure.querySelector('.speed-plot svg');
  svg(chart, 'line', { class: 'plot-base', x1: HIST.left, x2: HIST.width - HIST.right, y1: histY(0), y2: histY(0) });
  const bars = svg(chart, 'path', { class: 'hist-bars' });
  const curve = svg(chart, 'path', { class: 'hist-curve' });
  for (const v of [0, 1, 2, 3]) svg(chart, 'text', { class: 'plot-tick', x: histX(v), y: HIST.height - 8, 'text-anchor': 'middle' }, v);
  svg(chart, 'text', { class: 'plot-axis', x: HIST.width - HIST.right, y: HIST.height - 8, 'text-anchor': 'end' }, '|v| / σ τ⁻¹');

  const state = { playing: !REDUCE, target: FLUID.target, reset: false, dirty: true };
  const fresh = (seed) => createFluid({ count: FLUID.count, density: FLUID.density, temperature: FLUID.start, seed });
  let sim = fresh(11);
  sim.setTarget(state.target);
  if (REDUCE) for (let i = 0; i < 400; i++) sim.step(FLUID.dt);

  const plotStats = () => {
    const width = HIST.vMax / HIST.bins;
    const counts = new Array(HIST.bins).fill(0);
    for (let i = 0; i < FLUID.count; i++) {
      const bin = Math.floor(sim.speed(i) / width);
      if (bin < HIST.bins) counts[bin] += 1;
    }
    const base = histY(0).toFixed(1);
    bars.setAttribute('d', counts.map((n, i) => {
      const x = histX(i * width);
      const w = histX((i + 1) * width) - x - 1;
      return `M${x.toFixed(1)},${base}V${histY(n / FLUID.count / width).toFixed(1)}h${w.toFixed(1)}V${base}`;
    }).join(''));
    const T = sim.temperature();
    curve.setAttribute('d', Array.from({ length: 61 }, (_, i) => {
      const v = (HIST.vMax * i) / 60;
      return `${i ? 'L' : 'M'}${histX(v).toFixed(1)},${histY(maxwellBoltzmann(v, T)).toFixed(1)}`;
    }).join(''));
    readouts.step.textContent = sim.state.steps.toLocaleString('en-AU');
    readouts.time.textContent = sim.state.time.toFixed(1);
    readouts.temperature.textContent = T.toFixed(2);
    readouts.potential.textContent = plain(sim.state.potential / FLUID.count, 2);
  };

  let scene = null;
  try {
    scene = createLiquidScene(THREE, {
      canvas,
      count: FLUID.count,
      box: sim.state.box,
      colors: {
        ink: cssColor(figure, '--ink', '#17201f'),
        a: cssColor(figure, '--signal-a', '#13968d'),
        ab: cssColor(figure, '--signal-ab', '#7a4fcf'),
        b: cssColor(figure, '--signal-b', '#e2525c'),
      },
    });
    view.dataset.ready = 'true';
  } catch (err) {
    view.dataset.fallback = 'true';
  }

  const drag = { active: false, x: 0, y: 0 };
  let frames = 0;
  whileVisible(view, (dt, now) => {
    if (state.reset) {
      state.reset = false;
      sim = fresh(Math.floor(now));
      state.dirty = true;
    }
    sim.setTarget(state.target);
    if (state.playing) for (let i = 0; i < FLUID.stepsPerFrame; i++) sim.step(FLUID.dt);
    if (state.playing || state.dirty || drag.active) {
      state.dirty = false;
      scene?.frame(sim, dt, state.playing && !drag.active);
      if (frames++ % 8 === 0 || !state.playing) plotStats();
    }
  }, () => { state.dirty = true; });
  plotStats();

  const resize = () => {
    const { width, height } = view.getBoundingClientRect();
    scene?.resize(width, height);
    state.dirty = true;
  };
  new ResizeObserver(resize).observe(view);

  const setTarget = (value) => {
    state.target = value;
    state.dirty = true;
    range.value = String(value);
    output.textContent = value.toFixed(2);
    presets.forEach((b) => b.setAttribute('aria-pressed', String(Math.abs(Number(b.dataset.preset) - value) < 0.001)));
  };
  setTarget(state.target);
  presets.forEach((b) => b.addEventListener('click', () => setTarget(Number(b.dataset.preset))));
  range.addEventListener('input', () => setTarget(Number(range.value)));

  const setPlaying = (playing) => {
    state.playing = playing;
    state.dirty = true;
    playButton.textContent = playing ? 'Pause' : 'Play';
    playButton.setAttribute('aria-pressed', String(!playing));
  };
  setPlaying(state.playing);
  playButton.addEventListener('click', () => setPlaying(!state.playing));
  resetButton.addEventListener('click', () => {
    state.reset = true;
    state.dirty = true;
  });

  // Drag to turn the box.
  view.addEventListener('pointerdown', (event) => {
    drag.active = true;
    drag.x = event.clientX;
    drag.y = event.clientY;
    view.setPointerCapture(event.pointerId);
  });
  view.addEventListener('pointermove', (event) => {
    if (!drag.active || !scene) return;
    scene.view.yaw += (event.clientX - drag.x) * 0.008;
    scene.view.pitch = Math.max(-1.2, Math.min(1.2, scene.view.pitch + (event.clientY - drag.y) * 0.008));
    drag.x = event.clientX;
    drag.y = event.clientY;
    state.dirty = true;
  });
  const endDrag = () => { drag.active = false; };
  view.addEventListener('pointerup', endDrag);
  view.addEventListener('pointercancel', endDrag);
}

export function mountFigures() {
  for (const figure of document.querySelectorAll('[data-figure]')) {
    try {
      if (figure.dataset.figure === 'reaction') mountReaction(figure);
      if (figure.dataset.figure === 'liquid') mountLiquid(figure);
    } catch (err) {
      console.error(err);
    }
  }
}
