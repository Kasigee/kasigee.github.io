"""Write ../sapt-data.js for the amino acid scene: the M06-2X/aug-cc-pVDZ optimised anion-amino acid
complexes from the Supporting Information of Gregory, Webber, Wanless and Page, Electron. Struct. 5,
014007 (2023), doi:10.1088/2516-1075/acbe84 (CC BY 4.0), plus Table S1 of that SI.

usage: python3 sapt_data.py <folder of SI xyz files> ../sapt-data.js

For each complex this works out, from the geometry alone: the anion's hydrogen-bond contacts (anion
atom to amino acid H within 2.6 A), whether each H sits on the backbone amine, the backbone carboxylic
acid or the sidechain, and whether F- has taken a proton (an H within 1.1 A of F, i.e. HF formed)."""
import json, math, os, re, sys

COV = {'H': 0.31, 'C': 0.76, 'N': 0.71, 'O': 0.66, 'S': 1.05, 'F': 0.57, 'Cl': 1.02, 'P': 1.07}
ANIONS = {'F': ['F'], 'Cl': ['Cl'], 'SCN': ['S', 'C', 'N'], 'PF6': ['P', 'F', 'F', 'F', 'F', 'F', 'F']}
NAMES = {
    'glycine': 'Glycine', 'alanine': 'Alanine', 'valine': 'Valine', 'leucine': 'Leucine', 'isoleucine': 'Isoleucine',
    'methionine': 'Methionine', 'phenylalanine': 'Phenylalanine', 'tryptophan': 'Tryptophan', 'proline': 'Proline',
    'serine': 'Serine', 'threonine': 'Threonine', 'cysteine': 'Cysteine', 'tyrosine': 'Tyrosine', 'asparagine': 'Asparagine',
    'glutamine': 'Glutamine', 'asparticacidMINUS': 'Aspartate', 'glutamicacidMINUS': 'Glutamate', 'lysinePLUS': 'Lysine',
    'argininePLUS': 'Arginine', 'histidinePLUS': 'Histidine',
}
GROUP = {**{k: 'nonpolar' for k in ['glycine', 'alanine', 'valine', 'leucine', 'isoleucine', 'methionine', 'phenylalanine', 'tryptophan', 'proline']},
         **{k: 'polar' for k in ['serine', 'threonine', 'cysteine', 'tyrosine', 'asparagine', 'glutamine']},
         **{k: 'charged' for k in ['asparticacidMINUS', 'glutamicacidMINUS', 'lysinePLUS', 'argininePLUS', 'histidinePLUS']}}
CHARGE = {'asparticacidMINUS': '−', 'glutamicacidMINUS': '−', 'lysinePLUS': '+', 'argininePLUS': '+', 'histidinePLUS': '+'}
# Table S1: correlation of each SAPT component with the total interaction energy.
TABLE_S1 = {
    'glycine': [0.99, -0.798, 0.66, 0.86], 'alanine': [0.97, -0.80, 0.73, 0.61], 'valine': [0.99, -0.86, 0.82, 0.75],
    'leucine': [0.99, -0.90, 0.84, 0.65], 'isoleucine': [0.99, -0.86, 0.79, 0.64], 'methionine': [0.99, -0.93, 0.89, 0.83],
    'phenylalanine': [0.99, -0.90, 0.86, 0.71], 'tryptophan': [0.99, -0.91, 0.87, 0.78], 'proline': [0.99, -0.91, 0.80, 0.78],
    'serine': [1.00, -0.98, 0.97, 0.83], 'threonine': [1.00, -0.97, 0.95, 0.85], 'cysteine': [0.98, -0.87, 0.86, 0.70],
    'tyrosine': [0.98, -0.80, 0.78, 0.55], 'asparagine': [1.00, -0.96, 0.94, 0.87], 'glutamine': [1.00, -0.97, 0.97, 0.83],
    'asparticacidMINUS': [0.99, -1.00, 1.00, 1.00], 'glutamicacidMINUS': [0.96, -0.60, 0.47, 0.73],
    'lysinePLUS': [0.98, -0.97, 0.92, 0.52], 'argininePLUS': [0.99, -0.96, 0.97, 0.15], 'histidinePLUS': [1.00, -0.92, 0.89, 0.69],
}

def read(path):
    lines = open(path).read().split('\n')
    n = int(lines[0])
    atoms = []
    for l in lines[2:2 + n]:
        el, x, y, z = l.split()[:4]
        atoms.append([el, float(x), float(y), float(z)])
    return atoms

def dist(a, b):
    return math.dist(a[1:], b[1:])

def bonds(atoms):
    out = []
    for i in range(len(atoms)):
        for j in range(i + 1, len(atoms)):
            if dist(atoms[i], atoms[j]) < 1.2 * (COV[atoms[i][0]] + COV[atoms[j][0]]):
                out.append((i, j))
    return out

def backbone(aa, bl):
    """Indices of the backbone amine N and carboxylic acid O atoms: the carboxyl C is a C bonded to two
    O; the alpha C is bonded to it and to an N."""
    nb = {i: set() for i in range(len(aa))}
    for i, j in bl:
        nb[i].add(j); nb[j].add(i)
    for c, ns in nb.items():
        if aa[c][0] != 'C':
            continue
        os_ = [k for k in ns if aa[k][0] == 'O']
        if len(os_) != 2:
            continue
        for ca in ns:
            if aa[ca][0] == 'C' and any(aa[k][0] == 'N' for k in nb[ca]):
                n = next(k for k in nb[ca] if aa[k][0] == 'N')
                return n, set(os_), nb
    raise ValueError('no backbone found')

def split_anion(atoms, anion):
    """Find the anion as its own bonded fragment (files list its atoms first or last). If F- has taken
    a proton, the HF it forms is the fragment, and the H goes with it."""
    bl = bonds(atoms)
    parent = list(range(len(atoms)))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i, j in bl:
        parent[find(i)] = find(j)
    frags = {}
    for i in range(len(atoms)):
        frags.setdefault(find(i), []).append(i)
    key = {'F': 'F', 'Cl': 'Cl', 'SCN': 'S', 'PF6': 'P'}[anion]
    want = sorted(ANIONS[anion])
    for idx in frags.values():
        els = sorted(atoms[i][0] for i in idx)
        heavy = sorted(e for e in els if e != 'H')
        if key in els and heavy == want and len(idx) <= len(want) + 1:
            rest = [i for i in range(len(atoms)) if i not in idx]
            return rest, idx
    raise ValueError('anion fragment not found')

def analyse(atoms, anion):
    rest, an_idx = split_anion(atoms, anion)
    aa = [atoms[i] for i in rest]
    an = [atoms[i] for i in an_idx]
    hf = anion == 'F' and len(an) == 2
    bl = bonds(aa)
    n, os_, nb = backbone(aa, bl)
    contacts = []
    for ai, a in enumerate(an):
        if a[0] not in ('F', 'Cl', 'S', 'N'):
            continue
        for hi, h in enumerate(aa):
            if h[0] != 'H':
                continue
            d = dist(a, h)
            if d <= 2.6:
                heavy = next(iter(nb[hi])) if nb[hi] else None
                if heavy == n:
                    site = 'backbone NH'
                elif heavy in os_:
                    site = 'backbone OH'
                else:
                    site = f'sidechain {aa[heavy][0]}H' if heavy is not None else 'H'
                contacts.append({'a': an_idx[ai], 'h': rest[hi], 'd': round(d, 2), 'site': site})
    contacts.sort(key=lambda c: c['d'])
    # The closest anion-H approach, even when nothing is within 2.6 A.
    near = min(dist(a, h) for a in an if a[0] != 'H' for h in aa if h[0] == 'H')
    sites = sorted({c['site'].split(' ')[0] if c['site'].startswith('sidechain') else c['site'] for c in contacts},
                   key=['backbone OH', 'backbone NH', 'sidechain'].index)
    return an_idx, contacts, sites, hf, round(near, 2)

def main(folder, out):
    complexes = []
    skipped = []
    for f in sorted(os.listdir(folder)):
        m = re.match(r'([a-zA-Z]+?)(F|Cl|SCN|PF6|BF4?)(\d+)_m062x_aug-cc-pvdz\.xyz$', f)
        if not m:
            skipped.append(f); continue
        aa, anion, seed = m.groups()
        if anion not in ANIONS or aa not in NAMES:
            skipped.append(f); continue
        atoms = read(os.path.join(folder, f))
        try:
            an_idx, contacts, sites, abst, near = analyse(atoms, anion)
        except ValueError as e:
            skipped.append(f'{f} ({e})'); continue
        complexes.append({'aa': aa, 'anion': anion, 'kick': int(seed), 'an': an_idx,
                          'el': ' '.join(a[0] for a in atoms),
                          'xyz': [round(v, 3) for a in atoms for v in a[1:]],
                          'contacts': contacts, 'sites': sites, 'hf': abst, 'near': near})
    meta = {k: {'name': NAMES[k], 'group': GROUP[k], 'charge': CHARGE.get(k, ''), 's1': TABLE_S1[k]} for k in NAMES}
    with open(out, 'w') as fh:
        fh.write('// Data for the amino acid scene in paper-visuals.js. Generated by build/sapt_data.py; do not edit by hand.\n')
        fh.write('// M06-2X/aug-cc-pVDZ optimised anion-amino acid complexes and Table S1 from the Supporting Information of\n')
        fh.write('// Gregory, Webber, Wanless and Page, Electron. Struct. 2023, 5, 014007, doi:10.1088/2516-1075/acbe84 (CC BY 4.0).\n')
        fh.write('// Contacts, binding sites and HF formation are worked out from each geometry by the build script.\n')
        fh.write('export const AMINO = ' + json.dumps(meta, ensure_ascii=False, separators=(',', ':')) + ';\n')
        fh.write('export const COMPLEXES = ' + json.dumps(complexes, separators=(',', ':')) + ';\n')
    print(len(complexes), 'complexes;', len(skipped), 'skipped:', skipped)

if __name__ == '__main__':
    main(*sys.argv[1:])
