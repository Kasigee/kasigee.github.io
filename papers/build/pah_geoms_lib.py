import numpy as np
def dihedral(p1, p2, p3, p4):
    b1, b2, b3 = p2 - p1, p3 - p2, p4 - p3
    n1, n2 = np.cross(b1, b2), np.cross(b2, b3)
    n1 /= np.linalg.norm(n1); n2 /= np.linalg.norm(n2)
    return np.degrees(np.arccos(np.clip(np.dot(n1, n2), -1, 1)))
def sum_dihedral_dev(mol, pos):
    pos = np.asarray(pos)
    cc = {}
    for b in mol.GetBonds():
        a, c = b.GetBeginAtomIdx(), b.GetEndAtomIdx()
        if mol.GetAtomWithIdx(a).GetAtomicNum() == 6 and mol.GetAtomWithIdx(c).GetAtomicNum() == 6:
            cc.setdefault(a, []).append(c); cc.setdefault(c, []).append(a)
    seen, total, per_bond = set(), 0.0, {}
    for a1 in cc:
        for a2 in cc[a1]:
            for a3 in cc[a2]:
                if a3 == a1: continue
                for a4 in cc[a3]:
                    if a4 in (a2, a1): continue
                    t = (a1, a2, a3, a4)
                    if t in seen or t[::-1] in seen: continue
                    seen.add(t)
                    ang = dihedral(pos[a1], pos[a2], pos[a3], pos[a4])
                    dev = ang if ang < 90 else 180 - ang
                    total += dev
                    key = tuple(sorted((a2, a3)))
                    per_bond[key] = per_bond.get(key, 0.0) + dev
    return total, per_bond
def delta_z(mol, pos):
    pos = np.asarray(pos)
    carbons = np.array([a.GetAtomicNum() == 6 for a in mol.GetAtoms()])
    c = pos[carbons] - pos[carbons].mean(axis=0)
    n = np.linalg.svd(c)[2][2]
    h = c @ n
    return float(h.max() - h.min())
