// "Dr Kas" spelled in iridescent atoms. The atoms tilt with the
// pointer and scatter as the page scrolls. Capitals stay legible at this atom spacing, where the
// small counters of a lowercase a and s fill in. On a tall, narrow screen the words stack.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const FONT = '800 250px Unbounded, "Arial Black", sans-serif';
const PX_PER_UNIT = 100; // raster pixels per world unit
const GRID = 13; // raster pixels between atoms

// Rasterises the text and returns one jittered point per filled grid cell, centred on the origin.
function rasterise(lines) {
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = FONT;
  const lineHeight = 250;
  const width = Math.ceil(Math.max(...lines.map((line) => probe.measureText(line).width)) + 80);
  const height = lineHeight * lines.length + 80;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.font = FONT;
  g.fillStyle = '#000';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((line, i) => g.fillText(line, width / 2, 40 + lineHeight * (i + 0.5)));
  const alpha = g.getImageData(0, 0, width, height).data;
  const points = [];
  for (let y = 0; y < height; y += GRID) {
    for (let x = 0; x < width; x += GRID) {
      if (alpha[(y * width + x) * 4 + 3] <= 140) continue;
      points.push([x + (Math.random() - 0.5) * 4, y + (Math.random() - 0.5) * 4]);
    }
  }
  // Centre on the inked area rather than the canvas, since glyphs sit unevenly in their boxes.
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return {
    points: points.map(([x, y]) => [(x - cx) / PX_PER_UNIT, -(y - cy) / PX_PER_UNIT]),
    halfWidth: (Math.max(...xs) - Math.min(...xs)) / 2 / PX_PER_UNIT,
    halfHeight: (Math.max(...ys) - Math.min(...ys)) / 2 / PX_PER_UNIT,
  };
}

const fontReady = () => Promise.race([
  document.fonts.load(FONT.replace('250px', '200px')).catch(() => {}),
  new Promise((resolve) => setTimeout(resolve, 2500)),
]);

export async function mountHero(hero) {
  const canvas = hero.querySelector('canvas');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (err) {
    hero.classList.add('no-webgl');
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 4, 6);
  scene.add(key);

  await fontReady();

  const geometry = new THREE.SphereGeometry(1, 28, 18);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xfffbf2,
    roughness: 0.16,
    metalness: 0.05,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    iridescence: 1,
    iridescenceIOR: 1.5,
    iridescenceThicknessRange: [180, 620],
    sheen: 0.6,
    sheenColor: new THREE.Color(0xfff0f5),
  });
  const accents = [0x13968d, 0xe2525c, 0xf4c430].map((c) => new THREE.Color(c));
  const white = new THREE.Color(0xffffff);

  let mesh = null;
  let word = null;
  let layout = '';
  let base = [];
  let scatter = [];
  let radius = [];
  let phase = [];
  const build = (lines) => {
    if (mesh) {
      scene.remove(mesh);
      mesh.dispose();
    }
    word = rasterise(lines);
    mesh = new THREE.InstancedMesh(geometry, material, word.points.length);
    base = [];
    scatter = [];
    radius = [];
    phase = [];
    word.points.forEach(([x, y], i) => {
      base.push(new THREE.Vector3(x, y, (Math.random() - 0.5) * 0.18));
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      scatter.push(dir.multiplyScalar(2.5 + Math.random() * 5));
      radius.push(0.05 + Math.random() * 0.035);
      phase.push(Math.random() * Math.PI * 2);
      mesh.setColorAt(i, Math.random() < 0.06 ? accents[i % 3] : white);
    });
    scene.add(mesh);
  };

  // Fit the word, with a margin, to the hero at any aspect ratio, and lift it clear of the text
  // block at the bottom of the hero.
  const resize = () => {
    const { width, height } = hero.getBoundingClientRect();
    if (!width || !height) return;
    const next = width / height < 0.8 ? 'stacked' : 'line';
    if (next !== layout) {
      layout = next;
      build(layout === 'stacked' ? ['DR', 'KAS'] : ['DR KAS']);
    }
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const stacked = layout === 'stacked';
    const fitWidth = (word.halfWidth + (stacked ? 0.55 : 1.3)) / (tanHalf * camera.aspect);
    const fitHeight = (word.halfHeight + (stacked ? 1.2 : 1.4)) / tanHalf;
    const distance = Math.max(fitWidth, fitHeight, stacked ? 7 : 10.5);
    camera.position.set(0, -0.12 * distance * tanHalf, distance);
    camera.updateProjectionMatrix();
  };
  resize();
  new ResizeObserver(resize).observe(hero);

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener('pointermove', (event) => {
    pointer.tx = event.clientX / window.innerWidth - 0.5;
    pointer.ty = event.clientY / window.innerHeight - 0.5;
  }, { passive: true });

  let visible = true;
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(hero);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const size = new THREE.Vector3();
  const frame = (t) => {
    requestAnimationFrame(frame);
    if (!visible || document.hidden) return;
    const time = t / 1000;
    const spread = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.9)));
    const ease = spread * spread * (3 - 2 * spread);
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    mesh.rotation.y = pointer.x * 0.5 + (REDUCE ? 0 : Math.sin(time * 0.3) * 0.08);
    mesh.rotation.x = pointer.y * 0.3;
    const wobble = REDUCE ? 0 : 0.025;
    for (let i = 0; i < base.length; i++) {
      position.copy(base[i]).addScaledVector(scatter[i], ease);
      position.x += Math.sin(time * 2.1 + phase[i]) * wobble;
      position.y += Math.cos(time * 1.7 + phase[i]) * wobble;
      size.setScalar(radius[i] * (1 + ease * 0.6));
      matrix.compose(position, turn, size);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    renderer.render(scene, camera);
  };
  requestAnimationFrame(frame);
  hero.classList.add('is-ready');
}
