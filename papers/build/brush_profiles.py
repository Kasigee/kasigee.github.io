"""Rebuild the PNIPAM brush volume fraction profiles of Murdoch et al., Macromolecules 49, 6050 (2016)
from the fitted parameters in its Supporting Information (brush_tables.json), using the paper's model:
uniform interior slabs joined by Gaussian (error function) roughness, then a Gaussian, hyperbolic
tangent or parabola tail (Equations 1-3) discretised into 50 layers joined by a roughness of a third of
the layer thickness, as in the paper. Prints twice the first moment of each profile, which the paper
plots for D2O in the inset of Figure 2, and writes the profiles on a 4 A grid.

usage: python3 brush_profiles.py brush_tables.json out.json"""
import json, math, sys

def tail_fn(c):
    t, p0, H, x = c["tail"], c["phi0"], c["H"], c.get("z0a")
    if t == "G":
        return (lambda z: p0 * math.exp(-(z / H) ** 2)), 3 * H
    if t == "P":
        return (lambda z: p0 * max(0.0, 1 - (z / H) ** 2) ** x), H
    if t == "HT":
        return (lambda z: p0 / 2 * (1 + math.tanh(2 * (x - z) / H))), x + 2 * H
    raise ValueError(t)

def layers(c):
    """Return [(thickness, phi, roughness with the layer below)] including the discretised tail."""
    out = [tuple(s) for s in c["slabs"]]
    if c.get("tail") and c.get("phi0"):
        f, length = tail_fn(c)
        n = 50
        dz = length / n
        for k in range(n):
            out.append((dz, f((k + 0.5) * dz), c["rIE"] if k == 0 else dz / 3))
    return out

def profile(c, zmax, step):
    ls = layers(c)
    # interfaces: below layer i sits interface i with roughness ls[i][2]; after the last, solvent (phi 0)
    edges, z = [], 0.0
    phis = [0.0] + [l[1] for l in ls] + [0.0]  # substrate side treated as 0 for display; z starts at the oxide
    rough = [l[2] for l in ls] + [c["rES"]]
    for l in ls:
        edges.append(z)
        z += l[0]
    edges.append(z)
    def phi(x):
        v = 0.0
        for i, e in enumerate(edges):
            s = max(rough[i], 0.5)
            v += (phis[i + 1] - phis[i]) * 0.5 * (1 + math.erf((x - e) / (math.sqrt(2) * s)))
        return max(0.0, v)
    zs = [k * step for k in range(int(zmax / step) + 1)]
    return zs, [phi(x) for x in zs]

def moment(zs, ph):
    a = sum(ph)
    return 2 * sum(z * p for z, p in zip(zs, ph)) / a

if __name__ == "__main__":
    data = json.load(open(sys.argv[1]))
    out = {}
    for cond, temps in data.items():
        if cond.startswith("_"):
            continue
        out[cond] = {}
        for T, c in temps.items():
            zs, ph = profile(c, 1400, 4)
            out[cond][T] = [round(p, 4) for p in ph]
            print(f"{cond:8s} {T:>5s} C  2<z> = {moment(zs, ph):6.0f} A   tail {c.get('tail')}")
    out["_z_step_A"] = 4
    json.dump(out, open(sys.argv[2], "w"), separators=(",", ":"))
