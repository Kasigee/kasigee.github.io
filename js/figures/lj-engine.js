// A small Lennard-Jones fluid in reduced units (σ = ε = m = 1): velocity Verlet, periodic
// boundaries, a potential cut and shifted at 2.5 σ, and a Berendsen thermostat.
const CUTOFF = 2.5;
const CUTOFF2 = CUTOFF * CUTOFF;
const SHIFT = 4 * (CUTOFF ** -12 - CUTOFF ** -6);
const TAU_T = 0.4; // thermostat coupling time, in τ

// Seeded random numbers (mulberry32), so a reset gives a fresh but repeatable start.
export function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function createFluid({ count = 216, density = 0.4, temperature = 1.4, seed = 11 } = {}) {
  const random = mulberry32(seed);
  const gaussian = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  const box = Math.cbrt(count / density);
  const half = box / 2;
  const position = new Float64Array(count * 3);
  const velocity = new Float64Array(count * 3);
  const force = new Float64Array(count * 3);
  const dof = 3 * count - 3;
  const state = { box, count, steps: 0, time: 0, potential: 0, target: temperature };

  // Start on a simple cubic lattice with Gaussian velocities and no net momentum.
  const perSide = Math.ceil(Math.cbrt(count));
  const spacing = box / perSide;
  for (let i = 0; i < count; i++) {
    position[i * 3] = ((i % perSide) + 0.5) * spacing;
    position[i * 3 + 1] = ((Math.floor(i / perSide) % perSide) + 0.5) * spacing;
    position[i * 3 + 2] = (Math.floor(i / (perSide * perSide)) + 0.5) * spacing;
    for (let k = 0; k < 3; k++) velocity[i * 3 + k] = gaussian();
  }
  for (let k = 0; k < 3; k++) {
    let mean = 0;
    for (let i = 0; i < count; i++) mean += velocity[i * 3 + k];
    mean /= count;
    for (let i = 0; i < count; i++) velocity[i * 3 + k] -= mean;
  }
  scale(temperature / measuredTemperature());

  function kinetic() {
    let sum = 0;
    for (let k = 0; k < velocity.length; k++) sum += velocity[k] * velocity[k];
    return sum / 2;
  }
  function measuredTemperature() {
    return (2 * kinetic()) / dof;
  }
  // Multiplies every velocity by the square root of `factor`, so `factor` scales the temperature.
  function scale(factor) {
    const s = Math.sqrt(factor);
    for (let k = 0; k < velocity.length; k++) velocity[k] *= s;
  }
  // Minimum-image convention for a periodic cubic box.
  function wrap(d) {
    return d > half ? d - box : d < -half ? d + box : d;
  }

  function computeForces() {
    force.fill(0);
    let potential = 0;
    for (let i = 0; i < count; i++) {
      const xi = position[i * 3];
      const yi = position[i * 3 + 1];
      const zi = position[i * 3 + 2];
      for (let j = i + 1; j < count; j++) {
        const dx = wrap(xi - position[j * 3]);
        const dy = wrap(yi - position[j * 3 + 1]);
        const dz = wrap(zi - position[j * 3 + 2]);
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 >= CUTOFF2) continue;
        // The floor at r = 0.8 σ keeps a hot start from blowing up.
        const inv2 = 1 / Math.max(r2, 0.64);
        const inv6 = inv2 * inv2 * inv2;
        potential += 4 * inv6 * (inv6 - 1) - SHIFT;
        const f = 24 * inv2 * inv6 * (2 * inv6 - 1);
        force[i * 3] += f * dx;
        force[i * 3 + 1] += f * dy;
        force[i * 3 + 2] += f * dz;
        force[j * 3] -= f * dx;
        force[j * 3 + 1] -= f * dy;
        force[j * 3 + 2] -= f * dz;
      }
    }
    state.potential = potential;
  }
  computeForces();

  function step(dt) {
    for (let k = 0; k < position.length; k++) {
      velocity[k] += 0.5 * dt * force[k];
      let x = position[k] + dt * velocity[k];
      if (x >= box) x -= box;
      else if (x < 0) x += box;
      position[k] = x;
    }
    computeForces();
    for (let k = 0; k < velocity.length; k++) velocity[k] += 0.5 * dt * force[k];
    const lambda2 = 1 + (dt / TAU_T) * (state.target / Math.max(measuredTemperature(), 1e-6) - 1);
    scale(Math.min(1.25, Math.max(0.8, lambda2)));
    state.steps += 1;
    state.time += dt;
  }

  return {
    state,
    position,
    velocity,
    step,
    temperature: measuredTemperature,
    setTarget(t) { state.target = t; },
    speed(i) {
      const vx = velocity[i * 3];
      const vy = velocity[i * 3 + 1];
      const vz = velocity[i * 3 + 2];
      return Math.sqrt(vx * vx + vy * vy + vz * vz);
    },
  };
}

// Maxwell–Boltzmann speed distribution at reduced temperature T (m = k_B = 1).
export function maxwellBoltzmann(v, T) {
  return 4 * Math.PI * (1 / (2 * Math.PI * T)) ** 1.5 * v * v * Math.exp((-v * v) / (2 * T));
}
