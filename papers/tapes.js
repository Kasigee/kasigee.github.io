// Papers on disc: every paper as a disc case on a rotating shelf. Each case is a real box (cover,
// back, two spines, top and bottom) on a CSS 3D ring, with its disc inside; the disc slides out of the
// case at the front of the shelf. Turn the ring by dragging, scrolling or with the arrow keys; flip a
// case to read its back; press play to open the paper. The shelf holds all the papers or only the
// first-author ones, and the catalogue jumps to any of them. Three discs play an interactive
// Three.js scene, mounted the first time they play. (The code still calls each case a tape: the shelf
// began as a row of video tapes, and the file names date from then.)
import { START, TAPES } from './tapes-data.js';
import { schematic } from './schematics.js';

const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.documentElement;
root.classList.add('js');

const shelf = document.querySelector('.shelf');
const ring = shelf.querySelector('.ring');
const play = document.querySelector('.play');
const stopButton = document.querySelector('.stop');
const catalogue = document.querySelector('.catalogue');
const ui = {
  meta: document.querySelector('.now-meta'),
  title: document.querySelector('.now-title'),
  desc: document.querySelector('.now-desc'),
  index: document.querySelector('.now-i'),
  count: document.querySelector('.now-n'),
  flip: document.querySelector('.flip'),
  osdTitle: document.querySelector('.osd-title'),
  filters: [...document.querySelectorAll('.filter')],
  catalogueButton: document.querySelector('.catalogue-open'),
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const mod = (a, n) => ((a % n) + n) % n;
const roleOf = (t) => t.role || (t.first ? 'first author' : `led by ${t.lead}`);

/* Playback pages: six are written out in index.html; the rest are built here from tapes-data.js. */
function genericBody(t) {
  const b = t.body;
  const article = document.createElement('article');
  article.className = 'tape-body';
  article.id = `body-${t.id}`;
  article.dataset.id = t.id;
  article.setAttribute('aria-labelledby', `${t.id}-title`);
  const tiles = b.tiles
    ? `<div class="tiles">${b.tiles.map(([big, small]) => `<div class="tile"><b>${esc(big)}</b><span>${esc(small)}</span></div>`).join('')}</div>`
    : '';
  article.innerHTML = `
    <div class="wrap paper-grid">
      <div class="stage-col">
        <div class="stage art-stage">${schematic(t.schematic, t.color)}</div>
        <p class="stage-note">A schematic drawing of the paper's subject, not data from the paper.</p>
      </div>
      <div class="panel">
        <p class="eyebrow">${esc(b.journal)} · ${t.year} · ${esc(roleOf(t))}</p>
        <h2 id="${t.id}-title">${esc(b.title)}</h2>
        ${b.text.map((p) => `<p>${esc(p)}</p>`).join('')}
        ${tiles}
        ${b.after ? `<p>${b.after}</p>` : ''}
        <p class="authors">${esc(t.credits).replace('K. P. Gregory', '<strong>K. P. Gregory</strong>')}</p>
        <p class="source"><a href="https://doi.org/${t.doi}" target="_blank" rel="noopener">${esc(b.cite)}</a></p>
      </div>
    </div>`;
  return article;
}
const staticFoot = play.querySelector('.static-foot');
for (const t of TAPES) {
  if (!document.getElementById(`body-${t.id}`) && t.body) play.insertBefore(genericBody(t), staticFoot);
}
const bodies = new Map([...play.querySelectorAll('.tape-body')].map((b) => [b.dataset.id, b]));

/* Sleeves */
// A barcode drawn from the DOI's characters: decorative, but each paper gets its own.
function barcode(text) {
  let x = 0;
  const bars = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    for (let k = 0; k < 3; k++) {
      const w = 1 + ((code >> (k * 2)) & 3) * 0.6;
      if (k !== 1) bars.push(`<rect x="${x.toFixed(1)}" width="${w.toFixed(1)}" height="24"/>`);
      x += w + 0.8;
    }
  }
  return `<svg viewBox="0 0 ${x.toFixed(1)} 24" preserveAspectRatio="none" aria-hidden="true">${bars.join('')}</svg>`;
}

// A cover reuses its playback drawing, with ids renamed so the page never holds two copies of one
// id, and hidden from screen readers (the tape's own label names the paper).
function coverDrawing(t) {
  const source = bodies.get(t.id)?.querySelector('.art-stage svg');
  const markup = source ? source.outerHTML : schematic(t.schematic, t.color);
  return markup
    .replace(/ role="img"/, ' aria-hidden="true"')
    .replace(/ aria-label="[^"]*"/, '')
    .replace(/id="([^"]+)"/g, 'id="$1-cover"')
    .replace(/url\(#([^)]+)\)/g, 'url(#$1-cover)');
}

function sleeve(t) {
  const title = esc(t.title);
  const art = t.art
    ? `<div class="art" style="background-image:url('${t.art}')"></div>`
    : `<div class="art drawn">${coverDrawing(t)}</div>`;
  const stills = t.stills.map(([big, small]) => `<span><b>${esc(big)}</b>${esc(small)}</span>`).join('');
  const badges = t.badges.map((b) => `<span>${esc(b)}</span>`).join('');
  const side = `<span class="side-title">${title}</span><span class="side-year">${t.year}</span><i>KG</i>`;
  return `
    <div class="face front">
      <div class="studio"><span>${esc(t.studio)}</span><span>${t.year}</span></div>
      <p class="sleeve-title${t.title.length > 15 ? ' long' : ''}">${title}</p>
      ${art}
      <p class="tagline">${esc(t.tagline)}</p>
      <div class="meta"><span>Papers on disc</span><i>KG</i></div>
      <span class="hinge" aria-hidden="true"></span>
    </div>
    <div class="face back">
      <p class="back-title">${title}</p>
      <p class="synopsis">${esc(t.synopsis)}</p>
      <div class="stills">${stills}</div>
      <p class="credits"><small>Authors</small>${esc(t.credits)}</p>
      <div class="badges">${badges}</div>
      <div class="barcode">${barcode(t.doi)}<small>DOI ${esc(t.doi)}</small></div>
      <span class="hinge" aria-hidden="true"></span>
    </div>
    <div class="face side left">${side}</div>
    <div class="face side right">${side}</div>
    <div class="face lid top"></div>
    <div class="face lid bottom"></div>
    <div class="face disc"><i></i></div>`;
}

let suppressClick = false;
const slots = new Map();
for (const t of TAPES) {
  const slot = document.createElement('div');
  slot.className = 'slot';
  const tape = document.createElement('div');
  tape.className = 'tape';
  tape.id = `tape-${t.id}`;
  tape.setAttribute('role', 'option');
  tape.setAttribute('aria-selected', 'false');
  tape.setAttribute('aria-label', `${t.title}, ${t.studio} ${t.year}`);
  tape.style.setProperty('--c', t.color);
  tape.innerHTML = sleeve(t);
  tape.addEventListener('click', () => {
    if (suppressClick || state.playing) return;
    const i = list.indexOf(t);
    if (i === index) playTape();
    else if (i >= 0) turnTo(i);
  });
  slot.append(tape);
  slots.set(t.id, slot);
}

/* The ring holds either every tape or only the first-author ones. */
const FIRST = TAPES.filter((t) => t.first);
let list = TAPES;
let tapes = [];
let N = 1;
let STEP = 360;
let flips = [];
let flipTargets = [];
let index = 0;
const state = { p: 0, target: 0, tx: 0, ty: 0, tiltX: 0, tiltY: 0, playing: false };
const big = () => N > 10;

// Tape width from the viewport, ring radius from the tape width. A big ring spaces the tapes more
// tightly and gets a perspective scaled to the tape, so the far side of the arc recedes.
const size = { w: 220, R: 300 };
function measure() {
  const narrow = window.innerWidth < 640;
  const byWidth = narrow ? window.innerWidth * 0.5 : Math.min(Math.max(window.innerWidth * 0.19, 170), 310);
  const byHeight = (shelf.clientHeight * 0.74) / 1.41;
  size.w = Math.max(110, Math.min(byWidth, byHeight));
  const spacing = big() ? (narrow ? 1.18 : 1.3) : (narrow ? 1.5 : 1.62);
  size.R = (size.w * spacing) / (2 * Math.tan(Math.PI / N));
  root.style.setProperty('--w', `${size.w.toFixed(1)}px`);
  root.style.setProperty('--R', `${size.R.toFixed(1)}px`);
  root.style.setProperty('--step', `${STEP}deg`);
  shelf.style.perspective = `${Math.round(big() ? Math.max(900, size.w * 7) : Math.max(900, size.R * 5.2))}px`;
}

function setList(next, keepId) {
  list = next;
  N = list.length;
  STEP = 360 / N;
  ring.replaceChildren(...list.map((t, i) => {
    const slot = slots.get(t.id);
    slot.style.setProperty('--i', i);
    return slot;
  }));
  tapes = list.map((t) => slots.get(t.id).firstElementChild);
  flips = new Array(N).fill(0);
  flipTargets = new Array(N).fill(0);
  index = Math.max(0, list.findIndex((t) => t.id === keepId));
  state.p = state.target = index;
  ui.count.textContent = String(N).padStart(2, '0');
  ui.filters.forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.filter === 'first') === (list === FIRST))));
  measure();
  updateCaption();
  render();
}

function render() {
  ring.style.transform = `rotateY(${(-state.p * STEP).toFixed(3)}deg)`;
  const reach = big() ? 5 : N; // tapes further round than this are hidden
  tapes.forEach((tape, i) => {
    let d = i - state.p;
    d -= N * Math.round(d / N); // shortest way round, in tapes
    const near = Math.max(0, 1 - Math.abs(d) * 2.5); // how close to the front slot
    const shade = big()
      ? Math.min(0.88, Math.abs(d) * 0.16)
      : 0.6 * (1 - (Math.cos((d * STEP * Math.PI) / 180) + 1) / 2);
    tape.style.visibility = Math.abs(d) > reach ? 'hidden' : '';
    tape.style.setProperty('--shade', shade.toFixed(3));
    tape.style.setProperty('--gloss', `${(50 - d * 60).toFixed(1)}%`);
    const tilt = i === index ? near : 0;
    // The disc slides out of the front case, and back in while the case flips over.
    const out = i === index ? near * Math.max(0, 1 - flips[i] / 60) : 0;
    tape.style.setProperty('--out', out.toFixed(3));
    tape.style.setProperty('--spin', out > 0.6 && !REDUCE ? 'running' : 'paused');
    tape.style.transform = `translateZ(${(near * size.w * 0.16).toFixed(1)}px) rotateY(${(flips[i] + state.tiltY * tilt).toFixed(2)}deg) rotateX(${(state.tiltX * tilt).toFixed(2)}deg)`;
  });
}

let raf = 0;
let last = 0;
function kick() {
  if (raf) return;
  last = performance.now();
  raf = requestAnimationFrame(tick);
}
function tick(now) {
  raf = 0;
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const ease = (rate) => (REDUCE ? 1 : 1 - Math.exp(-dt * rate));
  if (!drag.active) state.p += (state.target - state.p) * ease(7);
  for (let i = 0; i < N; i++) flips[i] += (flipTargets[i] - flips[i]) * ease(7);
  state.tiltX += (state.tx - state.tiltX) * ease(6);
  state.tiltY += (state.ty - state.tiltY) * ease(6);
  render();
  const settled = Math.abs(state.target - state.p) < 0.0005
    && flips.every((f, i) => Math.abs(flipTargets[i] - f) < 0.05)
    && Math.abs(state.tx - state.tiltX) < 0.02 && Math.abs(state.ty - state.tiltY) < 0.02;
  if (!settled || drag.active) raf = requestAnimationFrame(tick);
}

function updateCaption() {
  const t = list[index];
  root.style.setProperty('--cur', t.color);
  ui.meta.textContent = `${t.studio} · ${t.year} · ${roleOf(t)}`;
  ui.title.textContent = t.title;
  ui.desc.textContent = `${t.tagline} ${t.scene ? 'Press play to explore it in 3D.' : 'Press play to read about it.'}`;
  ui.index.textContent = String(index + 1).padStart(2, '0');
  ui.flip.setAttribute('aria-pressed', String(flipTargets[index] > 90));
  tapes.forEach((tape, i) => tape.setAttribute('aria-selected', String(i === index)));
  shelf.setAttribute('aria-activedescendant', tapes[index].id);
}
function syncIndex() {
  const next = mod(Math.round(state.target), N);
  if (next === index) return;
  index = next;
  updateCaption();
}
function unflipAll() {
  flipTargets.fill(0);
  ui.flip.setAttribute('aria-pressed', 'false');
}
function turnBy(step) {
  state.target = Math.round(state.target) + step;
  unflipAll();
  syncIndex();
  kick();
}
function turnTo(i, instant = false) {
  let d = i - mod(Math.round(state.target), N);
  if (d > N / 2) d -= N;
  if (d < -N / 2) d += N;
  state.target = Math.round(state.target) + d;
  if (instant) state.p = state.target;
  unflipAll();
  syncIndex();
  kick();
}
function flip() {
  flipTargets[index] = flipTargets[index] > 90 ? 0 : 180;
  ui.flip.setAttribute('aria-pressed', String(flipTargets[index] > 90));
  kick();
}
// Turn to any paper, putting every tape back on the shelf first if it was filtered out.
function show(id, { instant = false } = {}) {
  if (!list.some((t) => t.id === id)) setList(TAPES, list[index]?.id);
  const i = list.findIndex((t) => t.id === id);
  if (i >= 0) turnTo(i, instant);
}

/* Playback */
const mounted = new Set();
let playStart = 0;
async function playTape() {
  const t = list[index];
  state.playing = true;
  root.classList.add('is-playing');
  bodies.forEach((body, id) => body.classList.toggle('is-current', id === t.id));
  play.classList.add('on');
  play.scrollTop = 0;
  ui.osdTitle.textContent = t.title;
  playStart = performance.now();
  history.replaceState(null, '', `#${t.id}`);
  stopButton.focus({ preventScroll: true });
  requestAnimationFrame(timecode);
  if (t.scene && !mounted.has(t.id)) {
    mounted.add(t.id);
    try {
      const { mountScene } = await import('./paper-visuals.js');
      mountScene(t.id);
    } catch (err) {
      console.error(err);
    }
  }
}
function stopTape() {
  state.playing = false;
  root.classList.remove('is-playing');
  play.classList.remove('on');
  history.replaceState(null, '', window.location.pathname + window.location.search);
  shelf.focus({ preventScroll: true });
}

/* Catalogue: every paper, newest first, grouped by year. */
const catalogueList = catalogue.querySelector('.catalogue-list');
const years = [...new Set(TAPES.map((t) => t.year))].sort((a, b) => b - a);
catalogueList.innerHTML = years.map((year) => `
  <section>
    <h3>${year}</h3>
    <ul>${TAPES.filter((t) => t.year === year).reverse().map((t) => `
      <li><button type="button" data-id="${t.id}" style="--c:${t.color}"><b>${esc(t.title)}</b><span>${esc(t.studio)} · ${esc(roleOf(t))}</span></button></li>`).join('')}
    </ul>
  </section>`).join('');
const openCatalogue = () => {
  catalogue.hidden = false;
  ui.catalogueButton.setAttribute('aria-expanded', 'true');
  (catalogueList.querySelector(`[data-id="${list[index].id}"]`) || catalogueList.querySelector('button'))?.focus();
};
// Closing returns focus to the Catalogue button, or to the shelf after a pick, so that Enter then
// plays the chosen tape.
const closeCatalogue = (focus = ui.catalogueButton) => {
  catalogue.hidden = true;
  ui.catalogueButton.setAttribute('aria-expanded', 'false');
  focus.focus({ preventScroll: true });
};
ui.catalogueButton.addEventListener('click', openCatalogue);
catalogue.querySelector('.catalogue-close').addEventListener('click', () => closeCatalogue());
catalogue.addEventListener('click', (event) => {
  if (event.target === catalogue) closeCatalogue();
  const pick = event.target.closest('[data-id]');
  if (!pick) return;
  closeCatalogue(shelf);
  show(pick.dataset.id);
});

/* Input */
document.querySelector('.prev').addEventListener('click', () => turnBy(-1));
document.querySelector('.next').addEventListener('click', () => turnBy(1));
document.querySelector('.open').addEventListener('click', playTape);
ui.flip.addEventListener('click', flip);
stopButton.addEventListener('click', stopTape);
ui.filters.forEach((button) => button.addEventListener('click', () => {
  const next = button.dataset.filter === 'first' ? FIRST : TAPES;
  if (next === list) return;
  const current = list[index].id;
  setList(next, next.some((t) => t.id === current) ? current : START);
  if (!REDUCE) state.p = state.target - 1; // a short turn into place
  kick();
}));

window.addEventListener('keydown', (event) => {
  if (!catalogue.hidden) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCatalogue();
    }
    return;
  }
  if (state.playing) {
    if (event.key === 'Escape') {
      event.preventDefault();
      stopTape();
    }
    return;
  }
  const onControl = event.target.closest?.('a, button');
  if (onControl && (event.key === 'Enter' || event.key === ' ')) return;
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      turnBy(1);
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      turnBy(-1);
      break;
    case 'PageDown':
      turnBy(5);
      break;
    case 'PageUp':
      turnBy(-5);
      break;
    case 'Home':
      turnTo(0);
      break;
    case 'End':
      turnTo(N - 1);
      break;
    case 'Enter':
    case ' ':
      playTape();
      break;
    case 'f':
    case 'F':
      flip();
      break;
    case 'Escape':
      if (flipTargets[index] > 90) flip();
      else return;
      break;
    default:
      return;
  }
  event.preventDefault();
});

// Drag to turn the ring, with a little momentum; a short tap still counts as a click.
const drag = { pending: false, active: false, id: 0, x: 0, p0: 0, lastX: 0, lastT: 0, v: 0 };
shelf.addEventListener('pointerdown', (event) => {
  if (state.playing || event.button !== 0) return;
  Object.assign(drag, { pending: true, active: false, id: event.pointerId, x: event.clientX, p0: state.p, lastX: event.clientX, lastT: performance.now(), v: 0 });
});
shelf.addEventListener('pointermove', (event) => {
  if (drag.pending && !drag.active && Math.abs(event.clientX - drag.x) > 6) {
    drag.active = true;
    shelf.setPointerCapture(drag.id);
    shelf.classList.add('dragging');
  }
  if (drag.active) {
    const perTape = size.w * 1.25;
    const now = performance.now();
    state.p = drag.p0 - (event.clientX - drag.x) / perTape;
    drag.v = (-(event.clientX - drag.lastX) / perTape) / (Math.max(1, now - drag.lastT) / 1000);
    drag.lastX = event.clientX;
    drag.lastT = now;
    state.target = state.p;
    syncIndex();
    kick();
    return;
  }
  if (event.pointerType === 'mouse' && !state.playing) {
    const rect = shelf.getBoundingClientRect();
    state.ty = ((event.clientX - rect.left) / rect.width - 0.5) * 24;
    state.tx = -((event.clientY - rect.top) / rect.height - 0.5) * 12;
    kick();
  }
});
const endDrag = () => {
  if (drag.active) {
    drag.active = false;
    shelf.classList.remove('dragging');
    const fling = big() ? 5 : 1.5;
    state.target = Math.round(state.p + Math.max(-fling, Math.min(fling, drag.v * 0.18)));
    unflipAll();
    syncIndex();
    kick();
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
  }
  drag.pending = false;
};
shelf.addEventListener('pointerup', endDrag);
shelf.addEventListener('pointercancel', endDrag);
shelf.addEventListener('pointerleave', () => {
  state.tx = 0;
  state.ty = 0;
  kick();
});

let wheel = 0;
let wheelLock = 0;
shelf.addEventListener('wheel', (event) => {
  event.preventDefault();
  if (state.playing) return;
  const now = performance.now();
  wheel += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (now < wheelLock || Math.abs(wheel) < 40) return;
  turnBy(Math.sign(wheel));
  wheel = 0;
  wheelLock = now + 220;
}, { passive: false });

window.addEventListener('resize', () => {
  measure();
  render();
});

/* Deep links: papers/#pahaps turns to that tape and plays it, and so do links between tapes. */
const hashId = () => {
  const id = decodeURIComponent(window.location.hash.slice(1));
  return TAPES.some((t) => t.id === id) ? id : null;
};
window.addEventListener('hashchange', () => {
  const id = hashId();
  if (!id) return;
  show(id, { instant: true });
  playTape();
});

/* Clocks: time on the page, the time since play was pressed and the time in Armidale. */
const pad = (n) => String(Math.floor(n)).padStart(2, '0');
const hms = (s) => `${pad(s / 3600)}:${pad((s / 60) % 60)}:${pad(s % 60)}`;
const opened = performance.now();
const clock = document.querySelector('.clock');
const local = document.querySelector('.local');
const tc = document.querySelector('.tc');
const armidale = new Intl.DateTimeFormat('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Australia/Sydney', timeZoneName: 'short' });
const tickClocks = () => {
  clock.textContent = hms((performance.now() - opened) / 1000);
  local.textContent = armidale.format(new Date());
};
tickClocks();
setInterval(tickClocks, 500);
function timecode() {
  if (!state.playing) return;
  const s = (performance.now() - playStart) / 1000;
  tc.textContent = hms(s);
  requestAnimationFrame(timecode);
}

/* Start: the disc reads for a moment, then the ring turns into place (or a linked paper plays). */
document.querySelector('.n-all').textContent = TAPES.length;
document.querySelector('.n-first').textContent = FIRST.length;
const linked = hashId();
setList(TAPES, linked || START);
if (!linked && !REDUCE) state.p = state.target - 1.4;
render();
const loading = document.querySelector('.loading');
const finish = () => {
  loading.classList.add('done');
  kick();
  if (linked) playTape();
};
if (REDUCE) finish();
else setTimeout(finish, 550);
