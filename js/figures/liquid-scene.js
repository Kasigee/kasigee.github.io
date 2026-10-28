// Draws the Lennard-Jones fluid: toon-shaded atoms with ink outlines in a ruled periodic box,
// coloured by speed relative to the current temperature.
const RADIUS = 0.34; // σ units; the outline sphere is 0.4

export function createLiquidScene(THREE, { canvas, colors, count, box }) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  scene.add(new THREE.AmbientLight(0xffffff, 1.3));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(-4, 6, 8);
  scene.add(key);

  // A three-step ramp gives the flat, inked look.
  const gradient = new THREE.DataTexture(new Uint8Array([80, 160, 255]), 3, 1, THREE.RedFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  const sphere = new THREE.SphereGeometry(1, 20, 14);
  const body = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradient });
  const ink = new THREE.MeshBasicMaterial({ color: colors.ink, side: THREE.BackSide });
  const atoms = new THREE.InstancedMesh(sphere, body, count);
  const rims = new THREE.InstancedMesh(sphere, ink, count);
  atoms.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rims.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const group = new THREE.Group();
  group.rotation.set(0.42, -0.6, 0);
  group.add(rims, atoms);
  scene.add(group);

  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(box, box, box));
  const lines = new THREE.LineBasicMaterial({ color: colors.ink, transparent: true, opacity: 0.6 });
  group.add(new THREE.LineSegments(edges, lines));
  // Ruler ticks along one edge: one per σ, longer every 5 σ.
  const half = box / 2;
  const ticks = [];
  for (let i = 0; i <= Math.floor(box); i++) {
    const length = i % 5 === 0 ? 0.42 : 0.2;
    ticks.push(-half + i, -half, half, -half + i, -half - length, half);
  }
  const tickGeometry = new THREE.BufferGeometry();
  tickGeometry.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3));
  group.add(new THREE.LineSegments(tickGeometry, lines));

  const slow = new THREE.Color(colors.a);
  const middle = new THREE.Color(colors.ab);
  const fast = new THREE.Color(colors.b);
  const color = new THREE.Color();
  const matrix = new THREE.Matrix4();
  const rimMatrix = new THREE.Matrix4();
  const view = { yaw: -0.6, pitch: 0.42, spin: 0.08 };
  let width = 1;
  let height = 1;

  function frame(sim, dt, spinning) {
    const { position } = sim;
    const thermal = 3 * Math.max(sim.temperature(), 0.05);
    for (let i = 0; i < count; i++) {
      const x = position[i * 3] - half;
      const y = position[i * 3 + 1] - half;
      const z = position[i * 3 + 2] - half;
      matrix.makeScale(RADIUS, RADIUS, RADIUS).setPosition(x, y, z);
      rimMatrix.makeScale(0.4, 0.4, 0.4).setPosition(x, y, z);
      atoms.setMatrixAt(i, matrix);
      rims.setMatrixAt(i, rimMatrix);
      const v = sim.speed(i);
      const t = Math.min(1, (v * v) / thermal / 2.4);
      if (t < 0.42) color.copy(slow).lerp(middle, t / 0.42);
      else color.copy(middle).lerp(fast, (t - 0.42) / 0.58);
      atoms.setColorAt(i, color);
    }
    atoms.instanceMatrix.needsUpdate = true;
    rims.instanceMatrix.needsUpdate = true;
    if (atoms.instanceColor) atoms.instanceColor.needsUpdate = true;
    if (spinning) view.yaw += view.spin * dt;
    group.rotation.set(view.pitch, view.yaw, 0);
    renderer.render(scene, camera);
  }

  return {
    frame,
    view,
    resize(w, h) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      const distance = (box * 0.9) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      camera.position.set(0, 0, distance / Math.min(1, camera.aspect));
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    },
    dispose() {
      [gradient, sphere, body, ink, edges, lines, tickGeometry].forEach((x) => x.dispose());
      atoms.dispose();
      rims.dispose();
      renderer.dispose();
    },
  };
}
