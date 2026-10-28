// Draws the SN2 reaction as an inked ball-and-stick model: partial bonds become dotted lines,
// a free chloride carries a halo, and dimension lines track both C–Cl distances.
import { geometry } from './reaction-model.js';
import { mulberry32 } from './lj-engine.js';

const RADII = { c: 0.34, h: 0.22, cl: 0.48 };
const OUTLINE = 0.045;
const DIM_Y = -1.6; // height of the dimension line under the molecule

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function createReactionScene(THREE, { canvas, colors, labels }) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  scene.add(new THREE.AmbientLight(0xffffff, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-3, 5, 6);
  scene.add(key);

  const gradient = new THREE.DataTexture(new Uint8Array([70, 150, 255]), 3, 1, THREE.RedFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  const disposables = [gradient];
  const keep = (x) => {
    disposables.push(x);
    return x;
  };
  const sphere = keep(new THREE.SphereGeometry(1, 48, 32));
  const cylinder = keep(new THREE.CylinderGeometry(1, 1, 1, 24, 1));
  const toon = (color) => keep(new THREE.MeshToonMaterial({ color, gradientMap: gradient }));
  const ink = keep(new THREE.MeshBasicMaterial({ color: colors.ink, side: THREE.BackSide }));

  const root = new THREE.Group();
  root.rotation.set(0.06, -0.16, 0);
  scene.add(root);
  const molecule = new THREE.Group();
  root.add(molecule);

  function atom(color, radius) {
    const mesh = new THREE.Mesh(sphere, toon(color));
    mesh.scale.setScalar(radius);
    const rim = new THREE.Mesh(sphere, ink);
    rim.scale.setScalar(1 + OUTLINE / radius);
    mesh.add(rim);
    molecule.add(mesh);
    return mesh;
  }
  function stick(color) {
    const mesh = new THREE.Mesh(cylinder, toon(color));
    const rim = new THREE.Mesh(cylinder, ink);
    mesh.add(rim);
    molecule.add(mesh);
    return { mesh, outline: rim };
  }

  const carbon = atom(colors.carbon, RADII.c);
  const hydrogens = [0, 1, 2].map(() => atom(colors.hydrogen, RADII.h));
  const clA = atom(colors.a, RADII.cl);
  const clB = atom(colors.b, RADII.cl);
  const chBonds = hydrogens.map(() => stick(colors.bond));
  const clBonds = [stick(colors.a), stick(colors.b)];
  const glow = (color) => keep(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false }));
  const halos = [colors.a, colors.b].map((color) => {
    const mesh = new THREE.Mesh(sphere, glow(color));
    molecule.add(mesh);
    return mesh;
  });
  // A forming or breaking bond is drawn as a row of nine dots.
  const partials = [0, 1].map(() => {
    const dots = new THREE.InstancedMesh(sphere, toon(colors.partial), 9);
    const rims = new THREE.InstancedMesh(sphere, ink, 9);
    molecule.add(rims, dots);
    return { dots, rims };
  });

  const dimGeometry = keep(new THREE.BufferGeometry());
  const dimPositions = new Float32Array(48);
  dimGeometry.setAttribute('position', new THREE.BufferAttribute(dimPositions, 3));
  root.add(new THREE.LineSegments(dimGeometry, keep(new THREE.LineBasicMaterial({ color: colors.ink, transparent: true, opacity: 0.55 }))));

  // Thermal jiggle: three seeded sinusoids per atom (C, three H, two Cl).
  const random = mulberry32(27);
  const jiggle = [0.03, 0.07, 0.07, 0.07, 0.025, 0.025].map((amplitude) => [0, 1, 2].map(() => ({
    dir: new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(),
    amplitude: amplitude * (0.6 + 0.4 * random()),
    speed: 5 + 6 * random(),
    phase: random() * Math.PI * 2,
  })));
  const shake = (index, time, v) => {
    for (const w of jiggle[index]) v.addScaledVector(w.dir, w.amplitude * Math.sin(w.speed * time + w.phase));
    return v;
  };

  const UP = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const still = new THREE.Quaternion();
  const size = new THREE.Vector3();
  const point = new THREE.Vector3();

  function placeStick(bond, a, b, radius, trimA = 0, trimB = 0) {
    dir.subVectors(b, a);
    const length = dir.length();
    dir.normalize();
    from.copy(a).addScaledVector(dir, trimA * 0.6);
    to.copy(b).addScaledVector(dir, -trimB * 0.6);
    bond.mesh.visible = radius > 0.004;
    if (bond.mesh.visible) {
      bond.mesh.position.addVectors(from, to).multiplyScalar(0.5);
      bond.mesh.quaternion.setFromUnitVectors(UP, dir);
      bond.mesh.scale.set(radius, from.distanceTo(to), radius);
      bond.outline.scale.set(1 + 0.035 / radius, 1, 1 + 0.035 / radius);
    }
    return length;
  }

  function placePartial(partial, a, b, radius) {
    partial.dots.visible = partial.rims.visible = radius > 0.006;
    if (!partial.dots.visible) return;
    dir.subVectors(b, a);
    const start = RADII.c + 0.08;
    const span = dir.length() - start - RADII.cl - 0.08;
    dir.normalize();
    for (let i = 0; i < 9; i++) {
      point.copy(a).addScaledVector(dir, start + (span * (i + 0.5)) / 9);
      matrix.compose(point, still, size.setScalar(radius));
      partial.dots.setMatrixAt(i, matrix);
      matrix.compose(point, still, size.setScalar(radius + 0.03));
      partial.rims.setMatrixAt(i, matrix);
    }
    partial.dots.instanceMatrix.needsUpdate = true;
    partial.rims.instanceMatrix.needsUpdate = true;
  }

  let width = 1;
  let height = 1;
  const cam = { centre: 0, distance: 10, sway: 0, swayTarget: 0 };

  function frame(xi, time, ease) {
    const g = geometry(xi);
    molecule.rotation.x = time * 0.32;
    const c = shake(0, time, carbon.position.set(0, 0, 0));
    const theta = THREE.MathUtils.degToRad(g.theta);
    hydrogens.forEach((h, i) => {
      const phi = (i * Math.PI * 2) / 3;
      h.position.set(g.ch * Math.cos(theta), g.ch * Math.sin(theta) * Math.cos(phi), g.ch * Math.sin(theta) * Math.sin(phi));
      shake(1 + i, time, h.position);
      placeStick(chBonds[i], c, h.position, 0.075);
    });
    shake(4, time, clA.position.set(-g.rA, 0, 0));
    shake(5, time, clB.position.set(g.rB, 0, 0));
    const order = [g.a, g.b];
    [clA, clB].forEach((cl, i) => {
      const n = order[i];
      placeStick(clBonds[i], c, cl.position, 0.1 * smoothstep(0.55, 0.95, n), RADII.c, RADII.cl);
      placePartial(partials[i], c, cl.position, 0.058 * (1 - smoothstep(0.72, 0.93, n)) * smoothstep(0.03, 0.12, n));
      const free = 1 - n;
      halos[i].position.copy(cl.position);
      halos[i].scale.setScalar(RADII.cl + 0.12 + 0.42 * free);
      halos[i].material.opacity = 0.16 * free;
    });

    // Dimension lines: two spans, end ticks, and leaders down from each atom.
    const low = DIM_Y - 0.14;
    const high = DIM_Y + 0.14;
    [
      [-g.rA, DIM_Y, 0, 0, DIM_Y, 0],
      [0, DIM_Y, 0, g.rB, DIM_Y, 0],
      [-g.rA, low, 0, -g.rA, high, 0],
      [0, low, 0, 0, high, 0],
      [g.rB, low, 0, g.rB, high, 0],
      [-g.rA, -RADII.cl - 0.15, 0, -g.rA, -1.4, 0],
      [0, -RADII.c - 0.6, 0, 0, -1.4, 0],
      [g.rB, -RADII.cl - 0.15, 0, g.rB, -1.4, 0],
    ].flat().forEach((v, i) => { dimPositions[i] = v; });
    dimGeometry.attributes.position.needsUpdate = true;

    // Keep both chlorines in frame as they separate, and drift with the pointer.
    const centre = (g.rB - g.rA) / 2;
    const reach = (g.rA + g.rB) / 2 + 0.8;
    const aspect = width / height;
    const distance = Math.max(reach / (tanHalfFov * aspect), 2.45 / tanHalfFov) * 1.06;
    cam.centre += (centre - cam.centre) * ease;
    cam.distance += (distance - cam.distance) * ease;
    cam.sway += (cam.swayTarget - cam.sway) * 0.05;
    camera.position.set(cam.centre + cam.sway * 1.4, 1, cam.distance);
    camera.lookAt(cam.centre, -0.3, 0);
    renderer.render(scene, camera);

    if (labels) {
      place(labels.a, clA.position, 0, 0.95);
      place(labels.b, clB.position, 0, 0.95);
      place(labels.dA, point.set(-g.rA / 2, DIM_Y, 0), 0, -0.32, root);
      place(labels.dB, point.set(g.rB / 2, DIM_Y, 0), 0, -0.32, root);
      place(labels.ts, point.set(0, 0, 0), 0, 1.75, root);
    }
    return g;
  }

  // Pins an HTML label to a point in the molecule (or root) frame.
  const projected = new THREE.Vector3();
  function place(el, position, dx, dy, space = molecule) {
    if (!el) return;
    projected.copy(position);
    if (space === molecule) {
      molecule.localToWorld(projected);
      root.worldToLocal(projected);
    }
    projected.x += dx;
    projected.y += dy;
    root.localToWorld(projected).project(camera);
    el.style.transform = `translate(${((projected.x + 1) / 2) * width}px, ${((1 - projected.y) / 2) * height}px) translate(-50%, -50%)`;
  }

  return {
    frame,
    resize(w, h) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    sway(x) {
      cam.swayTarget = x;
    },
    dispose() {
      disposables.forEach((x) => x.dispose());
      partials.forEach((p) => {
        p.dots.dispose();
        p.rims.dispose();
      });
      renderer.dispose();
    },
  };
}
