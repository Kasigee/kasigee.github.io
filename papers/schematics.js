// Schematic cover drawings for the tapes that have no 3D scene of their own. Each one is a picture of
// the paper's subject, not of its results: no sizes, energies or counts are implied, and the page
// labels every one as a schematic. All share a 320 × 220 frame drawn on the dark stage colour.
const INK = '#dbe4f0';
const DIM = '#93a0b2';
const FAINT = 'rgba(219, 228, 240, 0.35)';
const RED = '#ef4b55';
const AMBER = '#f4c51f';
const TEAL = '#2fc4b8';
const VIOLET = '#a78bfa';
const MONO = 'IBM Plex Mono, monospace';

const svg = (label, body) => `<svg class="art-svg" viewBox="0 0 320 220" role="img" aria-label="${label}">${body}</svg>`;
const text = (x, y, s, { size = 9.5, fill = DIM, anchor = 'start', family = MONO, weight = 400 } = {}) =>
  `<text x="${x}" y="${y}" fill="${fill}" font-family="${family}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${s}</text>`;
const ball = (x, y, r, fill, label = '', labelFill = '#0b1018') =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="#0b1018" stroke-width="1.5"/>`
  + `<circle cx="${(x - r * 0.35).toFixed(1)}" cy="${(y - r * 0.35).toFixed(1)}" r="${(r * 0.3).toFixed(1)}" fill="rgba(255,255,255,0.45)"/>`
  + (label ? text(x, y + r * 0.38, label, { size: Math.max(7.5, r * 0.95), fill: labelFill, anchor: 'middle', weight: 600 }) : '');
const line = (d, stroke = INK, width = 2.5, extra = '') => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
// A regular hexagon's corners, for ring drawings.
const hexagon = (cx, cy, r, turn = 0) => Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 3) * i + turn;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
});
const poly = (pts) => `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')} Z`;
// Deterministic wiggle so a drawing looks the same on every visit.
const wave = (i, k) => Math.sin(i * 1.7 + k * 0.9) * 0.6 + Math.sin(i * 0.6 + k * 2.3) * 0.4;

function brush(color, { tails = false, solvent = false } = {}) {
  let body = `<rect x="16" y="186" width="288" height="10" rx="2" fill="#3b4b63"/>`;
  for (let c = 0; c < 9; c++) {
    const x0 = 34 + c * 31;
    const pts = [];
    for (let k = 0; k <= 10; k++) pts.push([x0 + wave(c, k) * 9, 186 - k * 12.5]);
    body += line(`M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')}`, color, 2.6);
  }
  const ions = [[58, 122], [122, 80], [186, 140], [244, 96], [282, 150], [92, 166]];
  ions.forEach(([x, y], i) => {
    if (tails) body += line(`M${x + 6} ${y} l8 -6 l8 6 l8 -6`, AMBER, 2);
    body += ball(x, y, 7, i % 2 ? RED : AMBER, '−');
  });
  if (solvent) {
    [[40, 40], [110, 28], [176, 46], [250, 30], [292, 58]].forEach(([x, y]) => {
      body += line(`M${x - 8} ${y + 4} L${x} ${y - 3} L${x + 8} ${y + 4}`, FAINT, 2) + `<circle cx="${x}" cy="${y - 3}" r="4" fill="${TEAL}"/>`;
    });
  }
  body += text(18, 212, tails ? 'polymer brush' : 'grafted polymer chains');
  body += text(302, 212, tails ? 'anions with hydrocarbon tails' : 'anions', { anchor: 'end' });
  return body;
}

const DRAW = {
  brush: (c) => svg('Schematic of a polymer brush: chains grafted to a surface, with anions among them.', brush(c)),
  brushTails: (c) => svg('Schematic of a polymer brush with anions that carry hydrocarbon tails of different lengths.', brush(c, { tails: true })),
  brushSolvent: (c) => svg('Schematic of a polymer brush in a non-aqueous solvent, with anions among the chains.', brush(c, { solvent: true })),

  pore: (c) => svg('Schematic of a solid-state nanopore: ions passing through a narrow pore in a membrane.',
    `<path d="M16 86 H136 L150 112 L136 138 H16 Z" fill="#3b4b63" stroke="#7f93b0"/>`
    + `<path d="M304 86 H184 L170 112 L184 138 H304 Z" fill="#3b4b63" stroke="#7f93b0"/>`
    + line('M160 200 V24', INK, 1.5, 'stroke-dasharray="4 4"') + line('M153 32 L160 22 L167 32', INK, 1.5)
    + ball(160, 112, 8, c, '+') + ball(126, 176, 9, RED, '−') + ball(196, 170, 8, c, '+') + ball(140, 44, 8, c, '+') + ball(190, 52, 9, RED, '−')
    + text(18, 78, 'solid-state membrane') + text(302, 152, 'nanopore', { anchor: 'end' }) + text(18, 212, 'electrolyte')),

  screening: (c) => svg('Schematic of two charged surfaces in a concentrated electrolyte, with an expected short screening decay and an observed longer one.',
    `<rect x="18" y="26" width="12" height="168" fill="#3b4b63" stroke="#7f93b0"/><rect x="290" y="26" width="12" height="168" fill="#3b4b63" stroke="#7f93b0"/>`
    + [[70, 60], [110, 150], [150, 90], [190, 168], [230, 70], [258, 128], [96, 104], [206, 116], [130, 40], [170, 136]]
      .map(([x, y], i) => ball(x, y, 8, i % 2 ? RED : c, i % 2 ? '−' : '+')).join('')
    + line(`M30 40 ${Array.from({ length: 30 }, (_, i) => `L${30 + i * 4} ${(40 + 140 * (1 - Math.exp(-i / 4))).toFixed(1)}`).join(' ')}`, AMBER, 2)
    + line(`M30 40 ${Array.from({ length: 64 }, (_, i) => `L${30 + i * 4} ${(40 + 140 * (1 - Math.exp(-i / 22))).toFixed(1)}`).join(' ')}`, VIOLET, 2, 'stroke-dasharray="5 4"')
    + text(40, 212, 'expected decay', { fill: AMBER }) + text(300, 212, 'observed: much longer', { fill: VIOLET, anchor: 'end' })),

  surface: (c) => svg('Schematic of ions near the surface of a liquid, with a depth axis and a concentration profile.',
    line(`M16 70 ${Array.from({ length: 29 }, (_, i) => `Q${26 + i * 10} ${i % 2 ? 66 : 74} ${36 + i * 10} 70`).join(' ')}`, INK, 2)
    + `<rect x="16" y="72" width="226" height="138" fill="rgba(47,196,184,0.08)"/>`
    + [[44, 82, c, '+'], [86, 78, RED, '−'], [128, 96, c, '+'], [170, 84, RED, '−'], [66, 134, RED, '−'], [150, 150, c, '+'], [206, 120, RED, '−'], [104, 186, c, '+'], [190, 190, RED, '−']]
      .map(([x, y, f, s]) => ball(x, y, 8, f, s)).join('')
    + line('M262 72 V200', DIM, 1.5) + line('M257 192 L262 202 L267 192', DIM, 1.5)
    + line('M262 80 C 300 86, 296 120, 282 140 S 276 186, 286 200', AMBER, 2)
    + text(18, 56, 'vapour') + text(18, 212, 'solvent') + text(304, 64, 'depth', { anchor: 'end' })),

  thermo: (c) => svg('Schematic of thermodiffusion: ions in water between a hot side and a cold side, drifting towards the cold side.',
    `<defs><linearGradient id="hotcold" gradientUnits="userSpaceOnUse" x1="20" y1="0" x2="300" y2="0"><stop offset="0" stop-color="${RED}"/><stop offset="1" stop-color="#3a76c4"/></linearGradient></defs>`
    + `<rect x="20" y="28" width="280" height="10" rx="5" fill="url(#hotcold)"/>`
    + text(20, 22, 'hot', { fill: RED }) + text(300, 22, 'cold', { fill: '#7fb0ff', anchor: 'end' })
    + [[60, 70], [118, 128], [176, 82], [226, 148], [250, 98], [80, 172], [176, 178]]
      .map(([x, y], i) => ball(x, y, 9, i % 2 ? RED : c, i % 2 ? '−' : '+') + line(`M${x + 14} ${y} h22`, INK, 1.8) + line(`M${x + 31} ${y - 5} l6 5 l-6 5`, INK, 1.8)).join('')
    + text(20, 212, 'dissolved ions drift with the temperature gradient')),

  perfluoro: (c) => {
    const rings = [[120, 92], [168, 92], [144, 133], [192, 133]];
    let body = '';
    const outer = [];
    rings.forEach(([x, y]) => {
      const pts = hexagon(x, y, 27.7, Math.PI / 6);
      body += line(poly(pts), INK, 2.5);
      outer.push(...pts);
    });
    [[92, 76], [92, 108], [120, 50], [168, 50], [210, 76], [118, 168], [166, 176], [220, 150], [228, 112], [196, 170]]
      .forEach(([x, y]) => { body += ball(x, y, 8, c, 'F'); });
    return svg('Schematic of a polycyclic aromatic hydrocarbon with its hydrogens replaced by fluorine atoms.', body + text(18, 212, 'every H replaced by F') + text(302, 212, 'isomers compared', { anchor: 'end' }));
  },

  solvent: (c) => {
    let body = '';
    [[60, 70], [150, 54], [246, 76], [96, 150], [196, 140], [272, 170], [40, 182]].forEach(([x, y], i) => {
      const a = i * 0.9;
      const dx = Math.cos(a) * 18;
      const dy = Math.sin(a) * 18;
      body += line(`M${x - dx} ${y - dy} L${x} ${y} L${x + dy} ${y - dx}`, FAINT, 3);
      body += ball(x - dx, y - dy, 6, '#7f93b0') + ball(x + dy, y - dx, 6, '#7f93b0') + ball(x, y, 10, c, 'δ−');
    });
    return svg('Schematic of solvent molecules, each with its most electron-rich atom highlighted.', body + text(18, 212, 'solvent molecules, described from first principles'));
  },

  ionicLiquid: (c) => svg('Schematic of a protic ionic liquid: polar and non-polar regions forming a sponge-like nanostructure, with added salt ions.',
    [[60, 60, 46, 30], [170, 50, 54, 26], [270, 70, 34, 40], [100, 140, 58, 34], [214, 150, 50, 36], [44, 182, 30, 14], [282, 178, 26, 16]]
      .map(([x, y, rx, ry], i) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${i % 2 ? 'rgba(127,147,176,0.35)' : 'rgba(47,196,184,0.28)'}" stroke="${i % 2 ? '#7f93b0' : c}" stroke-width="1.5"/>`).join('')
    + ball(150, 104, 8, AMBER, '+') + ball(250, 112, 8, RED, '−') + ball(76, 104, 8, RED, '−')
    + text(18, 212, 'polar and non-polar domains', { fill: DIM }) + text(302, 212, 'added salt', { anchor: 'end', fill: AMBER })),

  sapt: (c) => {
    const terms = [['electrostatics', c], ['exchange', VIOLET], ['induction', AMBER], ['dispersion', RED]];
    let body = text(24, 52, 'E<tspan baseline-shift="sub" font-size="9">int</tspan> =', { size: 18, fill: INK, family: 'IBM Plex Sans, sans-serif' });
    terms.forEach(([name, color], i) => {
      const y = 72 + i * 34;
      body += `<rect x="96" y="${y}" width="150" height="22" rx="4" fill="${color}" opacity="0.85"/>` + text(104, y + 15, name, { fill: '#0b1018', size: 11, weight: 600 });
      if (i < 3) body += text(258, y + 31, '+', { size: 16, fill: INK, anchor: 'middle' });
    });
    return svg('Schematic of symmetry-adapted perturbation theory: an interaction energy written as electrostatics, exchange, induction and dispersion.', body + ball(276, 52, 12, c, '−') + ball(298, 30, 9, '#7f93b0') + text(18, 212, 'one interaction, four physical terms'));
  },

  lewis: (c) => {
    let body = ball(160, 110, 22, c, '−');
    [[0, 'H'], [1.6, 'H'], [3.1, 'H'], [4.7, 'H']].forEach(([a]) => {
      const x = 160 + Math.cos(a) * 74;
      const y = 110 + Math.sin(a) * 62;
      const hx = 160 + Math.cos(a) * 44;
      const hy = 110 + Math.sin(a) * 38;
      body += line(`M${x} ${y} L${hx} ${hy}`, FAINT, 3) + ball(x, y, 11, '#7f93b0') + ball(hx, hy, 6, '#e9eef5');
      body += line(`M${160 + Math.cos(a) * 27} ${110 + Math.sin(a) * 25} L${160 + Math.cos(a) * 36} ${110 + Math.sin(a) * 32}`, AMBER, 2);
    });
    return svg('Schematic of an anion donating electron density to surrounding solvent molecules, as a Lewis base.', body + text(18, 212, 'ion as Lewis base') + text(302, 212, 'solvent as Lewis acid', { anchor: 'end' }));
  },

  carbonyl: (c) => {
    const one = (x, label, right) => line(`M${x - 44} 132 L${x} 108 L${x + 44} 132`, INK, 3) + line(`M${x - 4} 106 V66 M${x + 4} 106 V66`, INK, 3)
      + text(x, 58, 'O', { size: 17, fill: RED, anchor: 'middle', family: 'IBM Plex Sans, sans-serif' })
      + text(x - 52, 140, 'R', { size: 15, fill: INK, anchor: 'end', family: 'IBM Plex Sans, sans-serif' })
      + text(x + 52, 140, right, { size: 15, fill: right === 'H' ? c : INK, family: 'IBM Plex Sans, sans-serif' })
      + text(x, 186, label, { anchor: 'middle', size: 10.5, fill: right === 'H' ? c : DIM });
    return svg('Schematic of an aldehyde, R–CHO, beside a ketone, R–CO–R′.', one(90, 'aldehyde', 'H') + one(232, 'ketone', 'R′') + text(160, 116, 'vs', { anchor: 'middle', size: 12, fill: DIM }));
  },

  hyperconjugation: (c) => svg('Schematic of hyperconjugation: a neighbouring C–H bond donating electron density into the empty p orbital of a carbocation.',
    `<ellipse cx="190" cy="66" rx="16" ry="34" fill="rgba(167,139,250,0.18)" stroke="${VIOLET}" stroke-width="1.8"/><ellipse cx="190" cy="154" rx="16" ry="34" fill="rgba(167,139,250,0.18)" stroke="${VIOLET}" stroke-width="1.8"/>`
    + line('M190 110 L254 140 M190 110 L254 82', INK, 3) + line('M190 110 L120 110', INK, 3) + line('M120 110 L92 70 M120 110 L84 132', INK, 3)
    + ball(190, 110, 12, c, '+') + ball(120, 110, 10, '#7f93b0') + ball(92, 70, 7, '#e9eef5')
    + line('M100 64 C 130 30, 170 34, 182 52', AMBER, 2) + line('M174 48 L183 54 L176 60', AMBER, 2)
    + text(52, 62, 'C–H σ', { fill: AMBER }) + text(214, 34, 'empty p orbital', { fill: VIOLET }) + text(18, 212, 'charge stabilised by a neighbouring bond')),

  inductiveChain: (c) => {
    const xs = [56, 116, 176, 236, 296];
    let body = line(`M${xs.map((x, i) => `${x} ${i % 2 ? 92 : 128}`).join(' L')}`, INK, 3);
    body += text(42, 134, 'X', { size: 22, fill: c, family: 'Anton, Impact, sans-serif' });
    ['δ+', 'δδ+', 'δδδ+'].forEach((d, i) => { body += text(xs[i + 1], i % 2 ? 150 : 76, d, { anchor: 'middle', fill: TEAL, size: 12 - i }); });
    body += text(42, 160, 'δ−', { fill: RED, size: 12 });
    return svg('Schematic of the textbook inductive effect: partial charges that fade along a carbon chain away from an electronegative atom X.', body + text(18, 30, 'the textbook picture') + text(18, 212, 'fading partial charges along the chain'));
  },

  reply: (c) => svg('Schematic of a published exchange: a commentary and a reply.',
    `<rect x="54" y="30" width="120" height="140" rx="6" fill="#121a26" stroke="#7f93b0"/>`
    + [0, 1, 2, 3, 4, 5].map((i) => `<rect x="66" y="${52 + i * 16}" width="${i % 3 === 2 ? 60 : 92}" height="5" rx="2" fill="#3b4b63"/>`).join('')
    + `<rect x="146" y="50" width="120" height="140" rx="6" fill="#121a26" stroke="${c}" stroke-width="2"/>`
    + [0, 1, 2, 3, 4, 5].map((i) => `<rect x="158" y="${88 + i * 16}" width="${i % 3 === 1 ? 64 : 92}" height="5" rx="2" fill="rgba(219,228,240,0.45)"/>`).join('')
    + text(158, 74, 'Re:', { size: 14, fill: c, weight: 600 }) + text(18, 212, 'commentary') + text(302, 212, 'our reply', { anchor: 'end', fill: c })),

  sugar: (c) => {
    const ring = (cx, cy) => line(poly(hexagon(cx, cy, 30, 0)), INK, 2.5);
    let body = ring(104, 104) + ring(216, 104) + line('M134 104 L160 120 L186 104', INK, 2.5) + ball(160, 120, 8, RED, 'O');
    body += ball(134, 104 - 0.01, 0.01, 'none');
    [[74, 78], [74, 130], [246, 78], [246, 130]].forEach(([x, y]) => { body += line(`M${x} ${y} L${x + (x < 160 ? -24 : 24)} ${y + (y < 104 ? -16 : 16)}`, c, 2.5) + ball(x + (x < 160 ? -30 : 30), y + (y < 104 ? -20 : 20), 9, c, 'aa'); });
    return svg('Schematic of trehalose, two sugar rings joined through an oxygen atom, with amino acid groups attached.', body + text(18, 212, 'trehalose') + text(302, 212, 'amino acid groups (aa)', { anchor: 'end', fill: c }));
  },

  antenna: (c) => {
    let body = '';
    const pigment = (x, y, s) => line(poly(hexagon(x, y, 16 * s, Math.PI / 4).slice(0, 6)), c, 2.2) + `<circle cx="${x}" cy="${y}" r="${5 * s}" fill="${c}"/>`;
    body += line('M20 186 C 70 150, 110 196, 160 160 S 250 150, 300 176', '#7f93b0', 3);
    body += line('M40 150 C 90 110, 130 150, 170 116 S 250 104, 300 124', '#7f93b0', 3);
    [[70, 156], [138, 170], [212, 150], [96, 122], [176, 114], [262, 116]].forEach(([x, y]) => { body += pigment(x, y, 0.8); });
    body += line('M40 36 q10 -10 20 0 t20 0 t20 0 t20 0', AMBER, 2) + line('M116 30 l10 6 l-10 6', AMBER, 2);
    return svg('Schematic of light-harvesting antenna complexes: pigment molecules held along polymer chains, absorbing light.', body + text(146, 40, 'light', { fill: AMBER }) + text(18, 212, 'polymer chains') + text(302, 212, 'pigments', { anchor: 'end', fill: c }));
  },
};

export function schematic(key, color) {
  return (DRAW[key] || DRAW.solvent)(color);
}
