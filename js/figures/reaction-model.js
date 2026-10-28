// A schematic model of the identity SN2 reaction Cl⁻ + CH₃Cl → ClCH₃ + Cl⁻ along the reaction
// coordinate ξ = r(C–Clᵃ) − r(C–Clᵇ), in Å. The energies are drawn to approximate published
// gas-phase values (ion–dipole complexes near −44 kJ/mol, transition state near +11 kJ/mol);
// they are not computed here.
export const COMPLEX_XI = 1.37; // ξ of the two ion–dipole complexes
export const BOND = 1.785; // C–Cl length in chloromethane, Å
export const SWITCH = 0.78; // how quickly the bond order passes from one Cl to the other
export const CH = 1.085; // C–H length, Å
export const UMBRELLA = 18.5; // swing of the H–C axis angle either side of 90°, degrees
export const COMPLEX_ENERGY = -43.5;
export const TS_ENERGY = 11.3;

const BARRIER = 15.39;
const BARRIER_WIDTH = 0.34;
const INNER_WIDTH = 0.62; // well width on the transition-state side
const OUTER_WIDTH = 1.25; // well width on the separated-ions side

const sech2 = (x) => {
  const c = Math.cosh(x);
  return 1 / (c * c);
};
const well = (x) => sech2(x / (x > 0 ? OUTER_WIDTH : INNER_WIDTH));

// Energy in kJ/mol at reaction coordinate xi.
export function energy(xi) {
  return -43.48 * (well(xi - COMPLEX_XI) + well(-xi - COMPLEX_XI))
    + BARRIER * Math.exp(-(xi * xi) / (2 * BARRIER_WIDTH * BARRIER_WIDTH));
}

// Geometry at xi: bond orders to each Cl (a, b), both C–Cl distances, and the umbrella angle.
export function geometry(xi) {
  const b = 1 / (1 + Math.exp(-xi / SWITCH));
  const a = 1 - b;
  const rA = BOND - SWITCH * Math.log(Math.max(a, 1e-6));
  const rB = BOND - SWITCH * Math.log(Math.max(b, 1e-6));
  const theta = 90 - UMBRELLA * (a - b); // angle of each C–H from the +x axis
  return { a, b, rA, rB, theta, hcclA: 180 - theta, ch: CH };
}

export function stage(xi) {
  if (Math.abs(xi) < 0.3) return 'Transition state';
  if (xi < -2.6) return 'Reactants';
  if (xi > 2.6) return 'Products';
  return xi < 0 ? 'Ion–dipole complex' : 'Product complex';
}
