"""Pack the 38,264 PBE0-D4 isomerization energies, sorted within each formula subset, as base64 uint16 (kcal/mol x 100)."""
import base64, json, sys
import numpy as np, pandas as pd
df = pd.read_csv(sys.argv[1], usecols=[0, 2])
df.columns = ["file", "E"]
df["formula"] = df.file.str.extract(r"hc_(c\d+h\d+)_")[0].str.upper()
order = ["C36H20", "C38H20", "C40H20", "C40H22", "C42H22", "C44H24"]
subsets = []
for f in order:
    e = np.sort(df.loc[df.formula == f, "E"].to_numpy())
    q = np.round(e * 100).astype("<u2")
    subsets.append({"formula": f, "count": int(len(e)), "mean": round(float(e.mean()), 2),
                    "max": round(float(e.max()), 2), "b64": base64.b64encode(q.tobytes()).decode()})
out = {"total": int(len(df)), "mean": round(float(df.E.mean()), 2), "subsets": subsets}
json.dump(out, open(sys.argv[2], "w"))
print(out["total"], out["mean"], [ (s["formula"], s["count"], s["mean"], s["max"]) for s in subsets])
