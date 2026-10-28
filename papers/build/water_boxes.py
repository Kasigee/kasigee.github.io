"""Random NaCl + water starting configurations at the four IonSolvR box sizes (Sci Data 2022 text).
Illustration of a packed starting box, in the spirit of the packmol starting ensembles; not IonSolvR trajectory data."""
import json, sys
import numpy as np
rng = np.random.default_rng(2022)
BOXES = [(32, 10.20, 1.72), (64, 12.60, 0.87), (100, 14.60, 0.55), (300, 20.90, 0.19)]
OH, HOH = 0.9572, np.radians(104.52)

def pbc_dist(a, b, L):
    d = a - b
    d -= L * np.round(d / L)
    return np.linalg.norm(d, axis=-1)

def rand_rot():
    q = rng.normal(size=4); q /= np.linalg.norm(q)
    w, x, y, z = q
    return np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                     [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                     [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])

local = np.array([[0, 0, 0],
                  [OH*np.sin(HOH/2), OH*np.cos(HOH/2), 0],
                  [-OH*np.sin(HOH/2), OH*np.cos(HOH/2), 0]])
out = []
for n, L, conc in BOXES:
    na = np.array([0.30, 0.30, 0.30]) * L
    cl = np.array([0.70, 0.70, 0.70]) * L
    oxy = []
    tries = 0
    while len(oxy) < n:
        tries += 1
        p = rng.uniform(0, L, 3)
        if pbc_dist(p, na, L) < 2.3 or pbc_dist(p, cl, L) < 2.9:
            continue
        if oxy and pbc_dist(np.array(oxy), p, L).min() < 2.45:
            continue
        oxy.append(p)
    waters = []
    for o in oxy:
        R = rand_rot()
        waters.append((local @ R.T + o).round(3).flatten().tolist())
    out.append({"n": n, "L": L, "conc": conc, "na": na.round(3).tolist(), "cl": cl.round(3).tolist(), "waters": waters})
    print(n, L, conc, "placed after", tries, "tries")
json.dump(out, open(sys.argv[1], "w"))
