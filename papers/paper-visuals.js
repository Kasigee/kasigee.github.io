// Three.js scenes for three of Kasimir Gregory's papers. Every number drawn here comes from the
// papers, their supplementary tables, or the PAHAPS dataset; see paper-data.js for sources.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { ANIONS, PAH_ENERGIES, PAH_ISOMERS, ION_BOXES } from './paper-data.js';

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const MINUS = '−';

// Data colours are tuned for the stage, which stays dark in both page themes.
const COLOR = {
  halide: '#f2b24f',
  oxygen: '#ff7f6e',
  other: '#b9a2ff',
  grid: '#7f93b0',
  carbon: '#a3aebd',
  hydrogen: '#e9eef5',
  chBond: '#6b7788',
  waterO: '#ef5b4f',
  waterH: '#e9eef5',
  sodium: '#ab6ef2',
  chloride: '#45c486',
  edge: '#c9d6e8',
};
const RAMP = ['#3a76c4', '#4bb0a6', '#e6c25b', '#e2574c'].map((c) => new THREE.Color(c));

function ramp(t, out = new THREE.Color()) {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  return out.copy(RAMP[i]).lerp(RAMP[i + 1], x - i);
}

const fmt = (v, digits = 2) => {
  const s = Math.abs(v).toLocaleString('en-AU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return v < 0 ? MINUS + s : s;
};

/* Shared stage: renderer, labels, orbit controls, render only while on screen. */
function createStage(el, { camera = [0, 3, 10], target = [0, 0, 0], fov = 38, minDistance = 3, maxDistance = 40 } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (err) {
    el.insertAdjacentHTML('beforeend', '<p class="stage-fallback">This 3D view needs WebGL, which is turned off or unavailable in this browser. The values are listed beside it.</p>');
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  el.append(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'stage-labels';
  el.append(labels.domElement);

  const tip = document.createElement('div');
  tip.className = 'stage-tip';
  tip.hidden = true;
  el.append(tip);

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(fov, 1, 0.05, 400);
  cam.position.set(...camera);
  const controls = new OrbitControls(cam, renderer.domElement);
  controls.target.set(...target);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = minDistance;
  controls.maxDistance = maxDistance;
  controls.autoRotate = !REDUCED_MOTION;
  controls.autoRotateSpeed = 0.4;
  let userMoved = false;
  controls.addEventListener('start', () => { controls.autoRotate = false; userMoved = true; });
  controls.update();
  controls.saveState();

  scene.add(new THREE.HemisphereLight(0xeef3ff, 0x1b2333, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(5, 9, 7);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9db8ff, 0.6);
  rim.position.set(-6, 3, -8);
  scene.add(rim);

  const render = () => {
    controls.update();
    renderer.render(scene, cam);
    labels.render(scene, cam);
  };
  // A view is a direction, an aim point and what must stay in frame at any aspect ratio: either a
  // bounding radius, or [half width, half height, depth allowance] for wide, flat scenes. Either can
  // be a function of the aspect ratio, since labels take more of a narrow stage.
  let framing = null;
  const frame = () => {
    if (!framing) return;
    const [position, aim, fit] = framing;
    const radius = typeof fit === 'function' ? fit(cam.aspect) : fit;
    const dir = new THREE.Vector3(...position).sub(new THREE.Vector3(...aim));
    if (radius) {
      const vfov = THREE.MathUtils.degToRad(cam.fov);
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * cam.aspect);
      dir.setLength(Array.isArray(radius)
        ? Math.max(radius[0] / Math.tan(hfov / 2), radius[1] / Math.tan(vfov / 2)) + (radius[2] || 0)
        : radius / Math.sin(Math.min(vfov, hfov) / 2));
      controls.maxDistance = Math.max(controls.maxDistance, dir.length() * 1.6);
    }
    controls.target.set(...aim);
    cam.position.copy(controls.target).add(dir);
    controls.update();
    controls.saveState();
  };
  const resize = () => {
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    labels.setSize(w, h);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    if (!userMoved) frame();
    render();
  };
  new ResizeObserver(resize).observe(el);
  new IntersectionObserver(([entry]) => {
    renderer.setAnimationLoop(entry.isIntersecting ? render : null);
  }, { rootMargin: '120px' }).observe(el);
  resize();

  const view = (position, aim, radius) => {
    framing = [position, aim, radius];
    userMoved = false;
    frame();
    render();
  };
  const reset = () => {
    userMoved = false;
    frame();
    render();
  };

  // Pointer picking: hover shows a tip, a click (not a drag) selects.
  const pick = ({ objects, hover, select }) => {
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down = null;
    const hit = (ev) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, cam);
      const found = ray.intersectObjects(objects().filter((o) => o.visible && o.parent && o.parent.visible), false)[0];
      return { found, x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    };
    renderer.domElement.addEventListener('pointermove', (ev) => {
      if (ev.pointerType !== 'mouse') return;
      const { found, x, y } = hit(ev);
      const text = found ? hover(found.object, found) : '';
      renderer.domElement.style.cursor = text ? 'pointer' : '';
      tip.hidden = !text;
      if (text) {
        tip.textContent = text;
        tip.style.left = `${Math.min(x + 14, el.clientWidth - tip.offsetWidth - 8)}px`;
        tip.style.top = `${Math.max(y - 34, 8)}px`;
      }
    });
    renderer.domElement.addEventListener('pointerleave', () => { tip.hidden = true; });
    renderer.domElement.addEventListener('pointerdown', (ev) => { down = [ev.clientX, ev.clientY]; });
    renderer.domElement.addEventListener('pointerup', (ev) => {
      if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 6) return;
      const { found } = hit(ev);
      if (found) select(found.object, found);
    });
  };

  return { el, renderer, scene, camera: cam, controls, render, view, reset, pick };
}

function label(text, className = 'tag') {
  const div = document.createElement('div');
  div.className = className;
  div.textContent = text;
  return new CSS2DObject(div);
}

function polyline(points, color, opacity = 1, dashed = false) {
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = dashed
    ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.06, gapSize: 0.05 })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const line = new THREE.Line(geo, mat);
  if (dashed) line.computeLineDistances();
  return line;
}

function pressed(buttons, active) {
  buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === active)));
}

/* 1. Hofmeister series: rho = q / r surface with every anion's active site on it. */
function mountHofmeister() {
  const el = document.getElementById('stage-hofmeister');
  if (!el) return;
  const st = createStage(el, { camera: [6.6, 5.4, 8.4], target: [0, 1.2, 0], minDistance: 5, maxDistance: 22 });
  const E_PER_A = 16.0218; // e per angstrom, in 1e-10 C m^-1
  const R0 = 1.4, R1 = 3.4, Q0 = 0.4, Q1 = 1.3, RHO_CUT = 10.6;
  const X = (r) => (r - 2.4) * 3;
  const Z = (q) => -(q - 0.85) * 5;
  const Y = (rho) => rho * 0.34;
  const rhoAt = (r, q) => (E_PER_A * q) / r;

  const ranked = [...ANIONS].sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
  const rankOf = new Map(ranked.map((a, i) => [a.id, i + 1]));

  const readout = document.getElementById('hof-readout');
  const list = document.getElementById('hof-rank');
  const rankButtons = new Map();
  ranked.forEach((a, i) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `rank-item fam-${a.family}`;
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = `<span class="rank-n">${i + 1}</span><span class="rank-name"></span><span class="rank-v">${fmt(Math.abs(a.rho))}</span>`;
    btn.querySelector('.rank-name').textContent = a.label;
    btn.addEventListener('click', () => select(a.id));
    li.append(btn);
    list.append(li);
    rankButtons.set(a.id, btn);
  });

  const tbody = document.querySelector('#hof-table tbody');
  if (tbody) {
    ranked.forEach((a) => {
      const tr = document.createElement('tr');
      [`${a.label} (${a.site})`, fmt(a.q), fmt(a.r), fmt(a.rho), fmt(a.ue, 0)].forEach((v, i) => {
        const cell = document.createElement(i ? 'td' : 'th');
        if (!i) cell.scope = 'row';
        cell.textContent = v;
        tr.append(cell);
      });
      tbody.append(tr);
    });
  }

  const describe = (a) => {
    readout.innerHTML = `
      <p class="readout-name"><span class="swatch fam-${a.family}"></span><span class="nm"></span><span class="site"></span></p>
      <dl class="readout-grid">
        <div><dt>Radial charge density, ϸ</dt><dd>${fmt(a.rho)} <small>× 10⁻¹⁰ C m⁻¹</small></dd></div>
        <div><dt>Site charge, q</dt><dd>${fmt(a.q)} <small>e</small></dd></div>
        <div><dt>Effective radius, r</dt><dd>${fmt(a.r)} <small>Å</small></dd></div>
        <div><dt>Ion–water energy, U<sub>E</sub></dt><dd>${fmt(a.ue, 0)} <small>kJ mol⁻¹</small></dd></div>
      </dl>
      <p class="readout-note">Rank ${rankOf.get(a.id)} of ${ANIONS.length} by charge density.</p>`;
    readout.querySelector('.nm').textContent = a.label;
    readout.querySelector('.site').textContent = a.site;
  };

  if (!st) {
    const fallback = ANIONS.find((a) => a.id === 'SO4') || ANIONS[0];
    describe(fallback);
    pressed([...rankButtons.values()], rankButtons.get(fallback.id));
    return;
  }
  const { scene } = st;

  // The surface rho = q / r. At small r each column of the grid stops at the rho = RHO_CUT contour,
  // above every anion in the data, so the top edge is a smooth curve rather than a jagged cut.
  const NR = 120;
  const NQ = 60;
  const pos = [];
  const col = [];
  const idx = [];
  const c = new THREE.Color();
  for (let i = 0; i <= NR; i++) {
    const r = R0 + ((R1 - R0) * i) / NR;
    const qTop = Math.min(Q1, (RHO_CUT * r) / E_PER_A);
    for (let j = 0; j <= NQ; j++) {
      const q = Q0 + ((qTop - Q0) * j) / NQ;
      const rho = rhoAt(r, q);
      pos.push(X(r), Y(rho), Z(q));
      ramp((rho - 2.5) / 8, c);
      col.push(c.r, c.g, c.b);
    }
  }
  const vid = (i, j) => i * (NQ + 1) + j;
  for (let i = 0; i < NR; i++) {
    for (let j = 0; j < NQ; j++) {
      idx.push(vid(i, j), vid(i + 1, j), vid(i, j + 1), vid(i + 1, j), vid(i + 1, j + 1), vid(i, j + 1));
    }
  }
  const surfGeo = new THREE.BufferGeometry();
  surfGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  surfGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  surfGeo.setIndex(idx);
  surfGeo.computeVertexNormals();
  scene.add(new THREE.Mesh(surfGeo, new THREE.MeshStandardMaterial({
    vertexColors: true, transparent: true, opacity: 0.5, side: THREE.DoubleSide, roughness: 0.85, depthWrite: false,
  })));

  // Lines of constant rho: rays q = rho r / e in the (r, q) plane.
  for (let level = 3; level <= 10; level++) {
    const pts = [];
    for (let k = 0; k <= 80; k++) {
      const r = R0 + ((R1 - R0) * k) / 80;
      const q = (level * r) / E_PER_A;
      if (q >= Q0 && q <= Q1) pts.push(new THREE.Vector3(X(r), Y(level) + 0.004, Z(q)));
    }
    if (pts.length < 2) continue;
    scene.add(polyline(pts, '#ffffff', 0.32));
    const tag = label(String(level), 'tag tag-iso');
    tag.position.copy(pts[0]).add(new THREE.Vector3(-0.16, 0.02, 0.12));
    tag.center.set(1, 0.5);
    scene.add(tag);
  }

  // Floor grid, ticks and axis titles.
  const grid = new THREE.Group();
  const floor = (r, q) => new THREE.Vector3(X(r), 0, Z(q));
  [1.5, 2, 2.5, 3].forEach((r) => {
    grid.add(polyline([floor(r, Q0), floor(r, Q1)], COLOR.grid, 0.35));
    const t = label(`${r.toFixed(1)}`, 'tag tag-tick');
    t.position.copy(floor(r, Q0)).add(new THREE.Vector3(0, 0, 0.38));
    grid.add(t);
  });
  [0.5, 0.75, 1, 1.25].forEach((q) => {
    grid.add(polyline([floor(R0, q), floor(R1, q)], COLOR.grid, 0.35));
    const t = label(q.toFixed(2), 'tag tag-tick');
    t.position.copy(floor(R1, q)).add(new THREE.Vector3(0.42, 0, 0));
    grid.add(t);
  });
  grid.add(polyline([floor(R0, Q0), floor(R1, Q0), floor(R1, Q1), floor(R0, Q1), floor(R0, Q0)], COLOR.grid, 0.6));
  const axisBase = floor(R1, Q1);
  grid.add(polyline([axisBase, axisBase.clone().setY(Y(10))], COLOR.grid, 0.7));
  [2, 4, 6, 8, 10].forEach((v) => {
    const t = label(String(v), 'tag tag-tick');
    t.position.copy(axisBase).add(new THREE.Vector3(0.28, Y(v), 0));
    grid.add(t);
  });
  // Axis titles give way to a caption under the stage on narrow screens (see .axis-wide in the page CSS).
  const titleR = label('effective radius r (Å)', 'tag tag-axis axis-wide');
  titleR.position.set(-0.4, 0, Z(Q0) + 1.25);
  const titleQ = label('site charge |q| (e)', 'tag tag-axis axis-wide');
  titleQ.position.set(X(R1) + 1.25, 0, 0);
  const titleRho = label('|ϸ| (10⁻¹⁰ C m⁻¹)', 'tag tag-axis axis-wide');
  titleRho.position.copy(axisBase).add(new THREE.Vector3(0, Y(10) + 0.42, 0));
  grid.add(titleR, titleQ, titleRho);
  scene.add(grid);

  // Anion active sites.
  const FAMILY = { halide: COLOR.halide, oxygen: COLOR.oxygen, other: COLOR.other };
  const DEFAULT_LABELS = new Set(['F', 'Cl', 'Br', 'I', 'OH', 'SO4', 'SCN_S', 'ClO4']);
  const sphereGeo = new THREE.SphereGeometry(1, 32, 20);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.06, 10, 48),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
  );
  scene.add(ring);
  const nodes = ANIONS.map((a) => {
    const color = new THREE.Color(FAMILY[a.family]);
    const mesh = new THREE.Mesh(sphereGeo, new THREE.MeshStandardMaterial({
      color, roughness: 0.35, metalness: 0.05, emissive: color.clone().multiplyScalar(0.22),
    }));
    const size = 0.075 * a.r;
    const p = new THREE.Vector3(X(a.r), Y(Math.abs(a.rho)), Z(Math.abs(a.q)));
    mesh.scale.setScalar(size);
    mesh.position.copy(p);
    mesh.userData.anion = a;
    scene.add(mesh);
    const drop = polyline([p, new THREE.Vector3(p.x, 0, p.z)], FAMILY[a.family], 0.45, true);
    scene.add(drop);
    const tag = label(a.label, `tag tag-anion fam-${a.family}`);
    tag.position.copy(p).add(new THREE.Vector3(0, size + 0.2, 0));
    scene.add(tag);
    return { a, mesh, drop, tag, size };
  });

  let showAll = false;
  let current = null;
  const syncLabels = () => {
    nodes.forEach((n) => { n.tag.visible = showAll || DEFAULT_LABELS.has(n.a.id) || n.a.id === current; });
  };
  function select(id) {
    const n = nodes.find((m) => m.a.id === id);
    if (!n) return;
    current = id;
    ring.position.copy(n.mesh.position);
    ring.scale.setScalar(n.size * 1.6);
    ring.lookAt(st.camera.position);
    nodes.forEach((m) => {
      m.drop.material.opacity = m === n ? 0.95 : 0.4;
      m.tag.element.classList.toggle('is-current', m === n);
    });
    describe(n.a);
    pressed([...rankButtons.values()], rankButtons.get(id));
    syncLabels();
    st.render();
  }
  st.controls.addEventListener('change', () => { ring.lookAt(st.camera.position); });

  st.pick({
    objects: () => nodes.map((n) => n.mesh),
    hover: (o) => `${o.userData.anion.label}  |ϸ| ${fmt(Math.abs(o.userData.anion.rho))}`,
    select: (o) => select(o.userData.anion.id),
  });

  const allBtn = document.getElementById('hof-labels');
  allBtn?.addEventListener('click', () => {
    showAll = !showAll;
    allBtn.setAttribute('aria-pressed', String(showAll));
    syncLabels();
    st.render();
  });
  document.getElementById('hof-reset')?.addEventListener('click', () => st.reset());

  st.view([6.6, 5.4, 8.4], [0.3, 1.2, 0.2], (aspect) => (aspect < 1.05 ? 4.9 : 4.25));
  select('SO4');
}

/* 2. PAHAPS: 38,264 isomerization energies, and three isomers in 3D. */
function decodeEnergies(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Uint16Array(bytes.buffer);
}

function mountPahaps() {
  const el = document.getElementById('stage-pahaps');
  if (!el) return;
  const readout = document.getElementById('pah-readout');
  const modeButtons = [...document.querySelectorAll('[data-pah-mode]')];
  const legend = document.getElementById('pah-bond-legend');
  const energyLegend = document.getElementById('pah-energy-legend');

  const describeAll = () => {
    readout.innerHTML = `
      <p class="readout-name">All ${PAH_ENERGIES.total.toLocaleString('en-AU')} isomers</p>
      <dl class="readout-grid">
        <div><dt>Formulas</dt><dd>${PAH_ENERGIES.subsets.length} <small>C₃₆H₂₀ to C₄₄H₂₄</small></dd></div>
        <div><dt>Mean energy</dt><dd>${fmt(PAH_ENERGIES.mean, 1)} <small>kcal mol⁻¹</small></dd></div>
        <div><dt>Highest energy</dt><dd>${fmt(Math.max(...PAH_ENERGIES.subsets.map((s) => s.max)), 1)} <small>kcal mol⁻¹</small></dd></div>
      </dl>
      <p class="readout-note">Each dot is one isomer, placed at its PBE0-D4 energy above the most stable isomer of the same formula. Dots in the same 0.5 kcal mol⁻¹ bin are stacked, so each row's height shows the share of that formula's isomers at that energy. White ticks mark each formula's mean.</p>`;
    if (legend) legend.hidden = true;
    if (energyLegend) energyLegend.hidden = false;
  };
  const describeIsomer = (iso) => {
    const err = iso.E_pred - iso.E_ref;
    readout.innerHTML = `
      <p class="readout-name"></p>
      <dl class="readout-grid">
        <div><dt>PBE0-D4 energy (paper data)</dt><dd>${fmt(iso.E_ref)} <small>kcal mol⁻¹</small></dd></div>
        <div><dt>Σ<sub>dihedral</sub>, deviation from planarity</dt><dd>${Math.round(iso.sigma).toLocaleString('en-AU')}<small>°</small></dd></div>
        <div><dt>Dihedral-only prediction</dt><dd>${fmt(iso.E_pred, 1)} <small>kcal mol⁻¹</small></dd></div>
        <div><dt>Prediction error</dt><dd>${err >= 0 ? '+' : MINUS}${fmt(Math.abs(err), 1)} <small>kcal mol⁻¹</small></dd></div>
      </dl>
      <p class="readout-note"></p>`;
    readout.querySelector('.readout-name').textContent = `${iso.title}: ${iso.formula} isomer ${iso.id}`;
    readout.querySelector('.readout-note').innerHTML = iso.note; // our own data; may hold <sub>
    if (legend) legend.hidden = false;
    if (energyLegend) energyLegend.hidden = true;
  };

  const st = createStage(el, { camera: [6.8, 4.6, 8.6], target: [0, 1.5, 0], minDistance: 3.5, maxDistance: 24 });
  if (!st) {
    describeAll();
    return;
  }
  const { scene } = st;

  // Landscape: each isomer is a dot at its energy (x) in its formula's row (z). The dots in each
  // 0.5 kcal/mol bin fill a column whose height is the share of that formula's isomers in the bin;
  // a golden-ratio sequence spreads them evenly up the column.
  const land = new THREE.Group();
  scene.add(land);
  const E_MAX = 55;
  const BIN = 0.5;
  const HEIGHT = 2.4;
  const ex = (kcal) => (kcal - E_MAX / 2) * 0.155;
  const laneZ = (i) => (i - (PAH_ENERGIES.subsets.length - 1) / 2) * 1.25;
  const nBins = Math.ceil(E_MAX / BIN) + 1;
  const binCounts = PAH_ENERGIES.subsets.map((s) => {
    const e = decodeEnergies(s.b64);
    const counts = new Uint32Array(nBins);
    e.forEach((v) => { counts[Math.floor(v / 100 / BIN)]++; });
    return { e, counts };
  });
  const yPerShare = HEIGHT / Math.max(...binCounts.map(({ e, counts }) => Math.max(...counts) / e.length));
  const pts = new Float32Array(PAH_ENERGIES.total * 3);
  const cols = new Float32Array(PAH_ENERGIES.total * 3);
  const c = new THREE.Color();
  let k = 0;
  const lanes = PAH_ENERGIES.subsets.map((s, i) => {
    const { e, counts } = binCounts[i];
    const z = laneZ(i);
    const stacked = new Uint32Array(nBins);
    for (let j = 0; j < e.length; j++) {
      const kcal = e[j] / 100;
      const b = Math.floor(kcal / BIN);
      const slot = ((stacked[b]++ * 0.6180339887 + 0.5) % 1);
      pts[k * 3] = ex(kcal);
      pts[k * 3 + 1] = slot * (counts[b] / e.length) * yPerShare;
      pts[k * 3 + 2] = z;
      ramp(kcal / 45, c);
      cols[k * 3] = c.r; cols[k * 3 + 1] = c.g; cols[k * 3 + 2] = c.b;
      k++;
    }
    land.add(polyline([new THREE.Vector3(ex(0), 0, z), new THREE.Vector3(ex(E_MAX), 0, z)], COLOR.grid, 0.3));
    const t = label(s.label, 'tag tag-lane');
    const n = document.createElement('span');
    n.className = 'lane-n';
    n.textContent = ` · ${s.count.toLocaleString('en-AU')}`;
    t.element.append(n);
    t.position.set(ex(E_MAX) + 0.2, 0, z);
    t.center.set(0, 0.5);
    land.add(t);
    // The formula's mean energy (Table 1 of the paper), as a white tick across the row.
    const mx = ex(s.mean);
    land.add(polyline([new THREE.Vector3(mx, 0.005, z - 0.34), new THREE.Vector3(mx, 0.005, z + 0.34)], '#ffffff', 0.95));
    return { s, e, counts, top: (b) => (counts[b] / e.length) * yPerShare };
  });
  const cloudGeo = new THREE.BufferGeometry();
  cloudGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  cloudGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  land.add(new THREE.Points(cloudGeo, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true })));

  // Energy axis along the front row, with faint guides running back through every row.
  const front = laneZ(lanes.length - 1) + 0.6;
  const back = laneZ(0) - 0.4;
  [0, 10, 20, 30, 40, 50].forEach((v) => {
    land.add(polyline([new THREE.Vector3(ex(v), 0, back), new THREE.Vector3(ex(v), 0, front)], COLOR.grid, v ? 0.16 : 0.4));
    const t = label(String(v), 'tag tag-tick');
    t.position.set(ex(v), 0, front + 0.3);
    land.add(t);
  });
  const xTitle = label('energy above the most stable isomer (kcal mol⁻¹)', 'tag tag-axis');
  xTitle.position.set(0, 0, front + 1.45);
  land.add(xTitle);

  // Markers for the three isomers drawn in 3D (all from the C44H24 row), on top of their bin.
  const lastLane = lanes.length - 1;
  const markerGeo = new THREE.SphereGeometry(0.09, 20, 12);
  const markers = Object.entries(PAH_ISOMERS).map(([key, iso]) => {
    const mesh = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    mesh.position.set(ex(iso.E_ref), lanes[lastLane].top(Math.floor(iso.E_ref / BIN)) + 0.14, laneZ(lastLane));
    mesh.userData.key = key;
    land.add(mesh);
    land.add(polyline([mesh.position.clone(), mesh.position.clone().setY(0)], '#ffffff', 0.5, true));
    const t = label(iso.title.toLowerCase(), 'tag tag-marker');
    t.position.copy(mesh.position).add(new THREE.Vector3(0, 0.34, 0));
    if (iso.E_ref < 5) t.center.set(0.15, 0.5); // keep the leftmost tag inside the stage
    land.add(t);
    return mesh;
  });

  // Molecules: ball and stick, C–C bonds coloured by summed dihedral deviation.
  const S = 0.34;
  const maxDev = Math.max(...Object.values(PAH_ISOMERS).flatMap((iso) => Object.values(iso.bond_dev)));
  document.getElementById('pah-legend-max')?.replaceChildren(`${Math.round(maxDev)}°`);
  const atomGeo = new THREE.SphereGeometry(1, 20, 14);
  const bondGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
  const up = new THREE.Vector3(0, 1, 0);
  const molecules = {};
  Object.entries(PAH_ISOMERS).forEach(([key, iso]) => {
    const g = new THREE.Group();
    g.visible = false;
    const n = iso.symbols.length;
    // Coordinates are aligned to their principal axes (z = smallest); lay the ring plane flat.
    const P = (i) => new THREE.Vector3(iso.xyz[3 * i], iso.xyz[3 * i + 2], -iso.xyz[3 * i + 1]).multiplyScalar(S);
    const atoms = new THREE.InstancedMesh(atomGeo, new THREE.MeshStandardMaterial({ roughness: 0.45 }), n);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const isC = iso.symbols[i] === 'C';
      const rad = (isC ? 0.3 : 0.2) * S;
      m.compose(P(i), new THREE.Quaternion(), new THREE.Vector3(rad, rad, rad));
      atoms.setMatrixAt(i, m);
      atoms.setColorAt(i, new THREE.Color(isC ? COLOR.carbon : COLOR.hydrogen));
    }
    g.add(atoms);
    const bonds = new THREE.InstancedMesh(bondGeo, new THREE.MeshStandardMaterial({ roughness: 0.5 }), iso.bonds.length);
    iso.bonds.forEach(([a, b], i) => {
      const pa = P(a);
      const pb = P(b);
      const dir = pb.clone().sub(pa);
      const len = dir.length();
      const q = new THREE.Quaternion().setFromUnitVectors(up, dir.normalize());
      const isCC = iso.symbols[a] === 'C' && iso.symbols[b] === 'C';
      const rad = (isCC ? 0.13 : 0.07) * S;
      m.compose(pa.clone().add(pb).multiplyScalar(0.5), q, new THREE.Vector3(rad, len, rad));
      bonds.setMatrixAt(i, m);
      const dev = iso.bond_dev[`${Math.min(a, b)}-${Math.max(a, b)}`] || 0;
      bonds.setColorAt(i, isCC ? ramp(dev / maxDev) : new THREE.Color(COLOR.chBond));
    });
    g.add(bonds);
    scene.add(g);
    molecules[key] = g;
  });

  const LAND_VIEW = [[2.0, 5.6, 8.8], [0.6, 0.5, 0.6], (aspect) => (aspect < 1.05 ? [6.4, 3.1, 1.2] : [5.6, 3.1, 1.2])];
  const MOL_VIEW = [[0, 4.6, 6.4], [0, 0, 0], 2.9];
  const setMode = (mode) => {
    land.visible = mode === 'all';
    land.traverse((o) => { if (o.isCSS2DObject) o.visible = mode === 'all'; });
    Object.entries(molecules).forEach(([key, g]) => { g.visible = key === mode; });
    pressed(modeButtons, modeButtons.find((b) => b.dataset.pahMode === mode));
    if (mode === 'all') {
      st.view(...LAND_VIEW);
      describeAll();
    } else {
      st.view(...MOL_VIEW);
      describeIsomer(PAH_ISOMERS[mode]);
    }
  };
  modeButtons.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.pahMode)));
  document.getElementById('pah-reset')?.addEventListener('click', () => st.reset());
  st.pick({
    objects: () => (land.visible ? markers : []),
    hover: (o) => `${PAH_ISOMERS[o.userData.key].title}: ${fmt(PAH_ISOMERS[o.userData.key].E_ref)} kcal mol⁻¹ (open in 3D)`,
    select: (o) => setMode(o.userData.key),
  });
  setMode('all');
}

/* 3. IonSolvR: the four NaCl–water cells at true relative size, and periodic images. */
function mountIonSolvR() {
  const el = document.getElementById('stage-ionsolvr');
  if (!el) return;
  const readout = document.getElementById('ion-readout');
  const boxButtons = [...document.querySelectorAll('[data-ion-box]')];
  const waterBtn = document.getElementById('ion-water');

  const describe = (mode) => {
    if (mode === 'all') {
      readout.innerHTML = `
        <p class="readout-name">Four cells, one ion pair</p>
        <dl class="readout-grid">
          <div><dt>Water molecules</dt><dd>32 to 300</dd></div>
          <div><dt>Cell edge</dt><dd>10.2 to 20.9 <small>Å</small></dd></div>
          <div><dt>Effective concentration</dt><dd>1.72 to 0.19 <small>mol L⁻¹</small></dd></div>
        </dl>
        <p class="readout-note">Pick one cell to see the copies of its ions that periodic boundaries create.</p>`;
      return;
    }
    const b = ION_BOXES[mode];
    readout.innerHTML = `
      <p class="readout-name">${b.n} water molecules</p>
      <dl class="readout-grid">
        <div><dt>Cell edge</dt><dd>${fmt(b.L, 1)} <small>Å</small></dd></div>
        <div><dt>Effective concentration</dt><dd>${fmt(b.conc)} <small>mol L⁻¹</small></dd></div>
        <div><dt>Nearest copy of each ion</dt><dd>${fmt(b.L, 1)} <small>Å away</small></dd></div>
      </dl>
      <p class="readout-note">The faint spheres are the periodic copies of Na⁺ and Cl⁻ in the 26 neighbouring cells. In a smaller cell they sit closer, which is why the paper checks how cell size affects each ion's solvation shell.</p>`;
  };

  const st = createStage(el, { camera: [1.2, 3.4, 9.6], target: [0, 1.0, 0], minDistance: 2.5, maxDistance: 26 });
  if (!st) {
    describe('all');
    return;
  }
  const { scene } = st;
  const S = 0.1;
  const GAP = 5;
  const totalWidth = ION_BOXES.reduce((sum, b) => sum + b.L, 0) + GAP * (ION_BOXES.length - 1);
  const oGeo = new THREE.SphereGeometry(0.62, 14, 10);
  const hGeo = new THREE.SphereGeometry(0.36, 10, 8);
  const oMat = new THREE.MeshStandardMaterial({ color: COLOR.waterO, roughness: 0.45 });
  const hMat = new THREE.MeshStandardMaterial({ color: COLOR.waterH, roughness: 0.45 });
  const naMat = new THREE.MeshStandardMaterial({ color: COLOR.sodium, roughness: 0.35, emissive: new THREE.Color(COLOR.sodium).multiplyScalar(0.2) });
  const clMat = new THREE.MeshStandardMaterial({ color: COLOR.chloride, roughness: 0.35, emissive: new THREE.Color(COLOR.chloride).multiplyScalar(0.2) });
  const ghostNa = new THREE.MeshStandardMaterial({ color: COLOR.sodium, transparent: true, opacity: 0.22, depthWrite: false });
  const ghostCl = new THREE.MeshStandardMaterial({ color: COLOR.chloride, transparent: true, opacity: 0.22, depthWrite: false });
  // Shannon ionic radii (6-coordinate): Na+ 1.02 A, Cl- 1.81 A, drawn at 0.7 scale so the water stays visible.
  const naGeo = new THREE.SphereGeometry(1.02 * 0.7, 24, 16);
  const clGeo = new THREE.SphereGeometry(1.81 * 0.7, 24, 16);
  const m = new THREE.Matrix4();

  let cursor = -totalWidth / 2;
  const cells = ION_BOXES.map((b, i) => {
    const half = b.L / 2;
    const g = new THREE.Group();
    g.scale.setScalar(S);
    const center = cursor + half;
    cursor += b.L + GAP;
    g.userData.home = new THREE.Vector3(center * S, half * S, 0);
    g.position.copy(g.userData.home);

    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(b.L, b.L, b.L)),
      new THREE.LineBasicMaterial({ color: COLOR.edge, transparent: true, opacity: 0.75 }));
    g.add(edges);
    const fill = new THREE.Mesh(new THREE.BoxGeometry(b.L, b.L, b.L),
      new THREE.MeshBasicMaterial({ color: 0x8fb4ff, transparent: true, opacity: 0.04, depthWrite: false }));
    g.add(fill);

    const water = new THREE.Group();
    const os = new THREE.InstancedMesh(oGeo, oMat, b.n);
    const hs = new THREE.InstancedMesh(hGeo, hMat, b.n * 2);
    b.waters.forEach((w, i) => {
      const at = (a) => new THREE.Vector3(w[a * 3] - half, w[a * 3 + 1] - half, w[a * 3 + 2] - half);
      os.setMatrixAt(i, m.makeTranslation(at(0)));
      hs.setMatrixAt(i * 2, m.makeTranslation(at(1)));
      hs.setMatrixAt(i * 2 + 1, m.makeTranslation(at(2)));
    });
    water.add(os, hs);
    g.add(water);

    const local = (p) => new THREE.Vector3(p[0] - half, p[1] - half, p[2] - half);
    const na = new THREE.Mesh(naGeo, naMat);
    na.position.copy(local(b.na));
    const cl = new THREE.Mesh(clGeo, clMat);
    cl.position.copy(local(b.cl));
    g.add(na, cl);

    const top = label(`${fmt(b.L, 1)} Å`, 'tag tag-tick');
    top.position.set(0, half + 2.6, 0);
    // Alternate caption heights so neighbouring captions never collide on a narrow screen.
    const bottom = label(`${b.n} H₂O\n${fmt(b.conc)} mol L⁻¹`, 'tag tag-lane tag-stack');
    bottom.position.set(0, -half - (i % 2 ? 9 : 2.6), half);
    g.add(top, bottom);

    // Periodic copies of the two ions, and the 26 neighbouring cell outlines.
    const images = new THREE.Group();
    images.visible = false;
    const outline = new THREE.EdgesGeometry(new THREE.BoxGeometry(b.L, b.L, b.L));
    const outlineMat = new THREE.LineBasicMaterial({ color: COLOR.edge, transparent: true, opacity: 0.14 });
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (let k = -1; k <= 1; k++) {
          if (!i && !j && !k) continue;
          const shift = new THREE.Vector3(i, j, k).multiplyScalar(b.L);
          const o = new THREE.LineSegments(outline, outlineMat);
          o.position.copy(shift);
          const ia = new THREE.Mesh(naGeo, ghostNa);
          ia.position.copy(na.position).add(shift);
          const ic = new THREE.Mesh(clGeo, ghostCl);
          ic.position.copy(cl.position).add(shift);
          images.add(o, ia, ic);
        }
      }
    }
    const reach = na.position.clone().add(new THREE.Vector3(b.L, 0, 0));
    images.add(polyline([na.position.clone(), reach], '#ffffff', 0.85));
    const dist = label(`${fmt(b.L, 1)} Å to its copy`, 'tag tag-marker');
    dist.position.copy(na.position).add(new THREE.Vector3(b.L / 2, 1.2, 0));
    images.add(dist);
    g.add(images);

    scene.add(g);
    return { b, g, water, images, labels: [top, bottom], imageLabels: [dist] };
  });

  let waterOn = true;
  let mode = 'all';
  const apply = () => {
    cells.forEach((cell, i) => {
      const solo = mode !== 'all';
      const shown = !solo || Number(mode) === i;
      cell.g.visible = shown;
      cell.g.position.copy(solo && shown ? new THREE.Vector3(0, 0, 0) : cell.g.userData.home);
      cell.images.visible = solo && shown;
      cell.water.visible = waterOn;
      cell.labels.forEach((t) => { t.visible = shown; });
      cell.imageLabels.forEach((t) => { t.visible = solo && shown; });
    });
    pressed(boxButtons, boxButtons.find((b) => b.dataset.ionBox === String(mode)));
    if (mode === 'all') {
      st.view([1.2, 3.4, 9.6], [0, 0.9, 0], [(totalWidth * S) / 2 + 0.3, 1.7, 1.2]);
    } else {
      const L = ION_BOXES[mode].L * S;
      st.view([1.9, 1.6, 3.6], [0, 0, 0], L * 1.05);
    }
    describe(mode);
  };
  boxButtons.forEach((btn) => btn.addEventListener('click', () => {
    mode = btn.dataset.ionBox === 'all' ? 'all' : Number(btn.dataset.ionBox);
    apply();
  }));
  waterBtn?.addEventListener('click', () => {
    waterOn = !waterOn;
    waterBtn.setAttribute('aria-pressed', String(!waterOn));
    apply();
  });
  document.getElementById('ion-reset')?.addEventListener('click', () => st.reset());
  apply();
}

// Each disc on the papers page mounts its scene the first time it plays.
const MOUNTS = { hofmeister: mountHofmeister, pahaps: mountPahaps, ionsolvr: mountIonSolvR };

export function mountScene(id) {
  try {
    MOUNTS[id]?.();
  } catch (err) {
    console.error(err);
  }
}

export function mountAll() {
  Object.keys(MOUNTS).forEach(mountScene);
}
