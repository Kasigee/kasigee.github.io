"""Build GFN2-xTB geometries for three COMPAS-3x' isomers and compute Kas's sum of dihedral deviations."""
import json, sys
import numpy as np, pandas as pd
from rdkit import Chem
from rdkit.Chem import AllChem
from ase import Atoms
from ase.optimize import LBFGS
from tblite.ase import TBLite

CSV = sys.argv[1]
OUT = sys.argv[2]

df = pd.read_csv(CSV, usecols=[0, 1, 2])
df.columns = ["file", "smiles", "E"]
df["formula"] = df.file.str.extract(r"hc_(c\d+h\d+)_")[0].str.upper()
sub = df[df.formula == "C44H24"]
mean = sub.E.mean()
picks = {
    "most_stable": sub.loc[sub.E.idxmin()],
    "typical": sub.iloc[(sub.E - mean).abs().argsort().iloc[0]],
    "least_stable": sub.loc[sub.E.idxmax()],
}

def dihedral(p1, p2, p3, p4):
    # Same construction as Kas's PAH_Analysis calculate_dihedral (0 to 180 degrees)
    b1, b2, b3 = p2 - p1, p3 - p2, p4 - p3
    n1, n2 = np.cross(b1, b2), np.cross(b2, b3)
    n1 /= np.linalg.norm(n1); n2 /= np.linalg.norm(n2)
    return np.degrees(np.arccos(np.clip(np.dot(n1, n2), -1, 1)))

def sum_dihedral_dev(mol, pos):
    cc = {}
    for b in mol.GetBonds():
        a, c = b.GetBeginAtomIdx(), b.GetEndAtomIdx()
        if mol.GetAtomWithIdx(a).GetAtomicNum() == 6 and mol.GetAtomWithIdx(c).GetAtomicNum() == 6:
            cc.setdefault(a, []).append(c); cc.setdefault(c, []).append(a)
    seen, total, per_bond = set(), 0.0, {}
    for a1 in cc:
        for a2 in cc[a1]:
            for a3 in cc[a2]:
                if a3 == a1:
                    continue
                for a4 in cc[a3]:
                    if a4 in (a2, a1):
                        continue
                    t = (a1, a2, a3, a4)
                    if t in seen or t[::-1] in seen:
                        continue
                    seen.add(t)
                    ang = dihedral(pos[a1], pos[a2], pos[a3], pos[a4])
                    dev = ang if ang < 90 else 180 - ang
                    total += dev
                    key = tuple(sorted((a2, a3)))
                    per_bond[key] = per_bond.get(key, 0.0) + dev
    return total, per_bond

def gfn2_opt(mol, seed):
    m = Chem.Mol(mol)
    if AllChem.EmbedMolecule(m, randomSeed=seed) != 0:
        return None
    AllChem.MMFFOptimizeMolecule(m, maxIters=2000)
    pos = m.GetConformer().GetPositions()
    atoms = Atoms([a.GetSymbol() for a in m.GetAtoms()], positions=pos)
    atoms.calc = TBLite(method="GFN2-xTB", verbosity=0)
    LBFGS(atoms, logfile=None).run(fmax=0.02, steps=800)
    return atoms.get_potential_energy(), atoms.get_positions()

result = {}
for key, row in picks.items():
    mol = Chem.AddHs(Chem.MolFromSmiles(row.smiles))
    best = None
    for seed in (7, 11, 23, 42, 101):
        out = gfn2_opt(mol, seed)
        if out is None:
            continue
        e, pos = out
        sigma, _ = sum_dihedral_dev(mol, pos)
        print(f"{key} seed {seed}: GFN2 E {e:.4f} eV, sigma {sigma:.1f}", flush=True)
        if best is None or e < best[0] - 1e-4:
            best = (e, pos)
    e, pos = best
    pos = pos - pos.mean(axis=0)
    sigma, per_bond = sum_dihedral_dev(mol, pos)
    # Kas's dihedral-only fit from PAH_Analysis (MAD 3.618 kcal/mol, matching the paper's 3.62)
    pred = 0.01498026 * sigma + 5.01448849
    z = pos[:, 2]
    # Paper's delta-z: put the molecule on the xy plane via its best-fit plane, then max-min z
    carbons = np.array([a.GetAtomicNum() == 6 for a in mol.GetAtoms()])
    c = pos[carbons] - pos[carbons].mean(axis=0)
    normal = np.linalg.svd(c)[2][2]
    dz = float((c @ normal).max() - (c @ normal).min())
    result[key] = {
        "file": row.file.replace(".log", ""),
        "smiles": row.smiles,
        "E_ref": round(float(row.E), 2),
        "sigma": round(sigma, 1),
        "E_pred": round(pred, 2),
        "dz": round(dz, 2),
        "symbols": [a.GetSymbol() for a in mol.GetAtoms()],
        "xyz": [round(float(v), 3) for v in pos.flatten()],
        "bonds": [[b.GetBeginAtomIdx(), b.GetEndAtomIdx()] for b in mol.GetBonds()],
        "bond_dev": {f"{a}-{b}": round(v, 1) for (a, b), v in per_bond.items()},
    }
    print(f"== {key}: {row.file} E_ref {row.E:.2f} sigma {sigma:.1f} pred {pred:.2f} dz {dz:.2f}", flush=True)

json.dump(result, open(OUT, "w"))
print("wrote", OUT)
