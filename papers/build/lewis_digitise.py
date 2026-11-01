"""Digitise Figure 4 of Gregory, Webber, Wanless and Page, J. Phys. Chem. A 123, 6420 (2019),
doi:10.1021/acs.jpca.9b04004: ion-NIPAM interaction free energies in five solvent environments.

The figure is only published as a 300 ppi raster (no data table in the paper or its SI), so each
point is the median height of that series' coloured pixels in a narrow column at the marker. That
median includes the marker, the symmetric error bar and the line through it, so it lands on the
marker centre. One pixel is about 0.15 kcal/mol in every panel.

usage: python3 lewis_digitise.py figure4.png out.json [overlay.png]"""
import json, sys
import numpy as np
from PIL import Image, ImageDraw

SERIES = {  # matplotlib colours used in the figure
    'water': (0, 0, 0), 'MeOH': (255, 165, 0), 'MeCN': (128, 128, 128), 'DMSO': (220, 20, 60), 'none': (70, 130, 180),
}
# Panel geometry, in pixels of the embedded image: frame left/right, the rows of two y values.
# Panel geometry, in pixels of the embedded image: the frame's top and bottom rows with their values,
# and two x-axis ticks with theirs. Ions sit at their Lewis strengths (Marcus), as in the figure.
LEWIS = {'SCN': 0.35, 'Cl': 1.67, 'F': 2.88, 'K': 0.85, 'Na': 0.89, 'Li': 1.24}
PANELS = {
    'a': dict(y=((40.5, 0.0), (454.0, -60.0)), x=((183.5, 0.5), (754.0, 3.0)), ions=['SCN', 'Cl', 'F'], kind='anion', desolv=False),
    'b': dict(y=((38.5, 0.0), (456.0, -60.0)), x=((893.0, 0.9), (1339.5, 1.2)), ions=['K', 'Na', 'Li'], kind='cation', desolv=False),
    'c': dict(y=((520.5, 20.0), (935.0, -20.0)), x=((183.5, 0.5), (754.0, 3.0)), ions=['SCN', 'Cl', 'F'], kind='anion', desolv=True),
    'd': dict(y=((520.5, 20.0), (935.0, -20.0)), x=((894.0, 0.9), (1341.0, 1.2)), ions=['K', 'Na', 'Li'], kind='cation', desolv=True),
}

# Legends and inset structures, which share the series' colours, are left out (x0, y0, x1, y1).
SKIP = [(125, 290, 255, 445), (310, 290, 560, 420), (1030, 60, 1270, 190), (255, 560, 585, 655),
        (645, 528, 750, 635), (985, 520, 1325, 640)]

def mask(a, rgb):
    r, g, b = (a[..., i] for i in range(3))
    if rgb == (0, 0, 0):
        return (a.sum(2) < 110)
    if rgb == (128, 128, 128):
        return (abs(r - g) < 14) & (abs(g - b) < 14) & (r > 105) & (r < 165)
    d = np.sqrt(((a - np.array(rgb)) ** 2).sum(2))
    return d < 70

def main(src, out, overlay=None):
    a = np.asarray(Image.open(src).convert('RGB')).astype(int)
    masks = {k: mask(a, v) for k, v in SERIES.items()}
    for x0, y0, x1, y1 in SKIP:
        for m in masks.values():
            m[y0:y1, x0:x1] = False
    result = {}
    img = Image.open(src).convert('RGB') if overlay else None
    dr = ImageDraw.Draw(img) if overlay else None
    for name, p in PANELS.items():
        (r0, v0), (r1, v1) = p['y']
        val = lambda row: v0 + (row - r0) * (v1 - v0) / (r1 - r0)
        (c0, u0), (c1, u1) = p['x']
        peaks = [round(c0 + (LEWIS[ion] - u0) * (c1 - c0) / (u1 - u0)) for ion in p['ions']]
        result[name] = {'kind': p['kind'], 'desolvation': p['desolv'], 'points': {}}
        for ion, cx in zip(p['ions'], peaks):
            for s, m in masks.items():
                if s == 'none' and p['desolv']:
                    continue
                win = m[int(r0) + 3:int(r1) - 3, cx - 5:cx + 6]
                ys = np.nonzero(win)[0] + int(r0) + 3
                if len(ys) < 6:
                    continue
                # Keep the biggest vertical run of this colour (marker plus error bar), not stray
                # pixels of the same colour elsewhere in the column.
                runs, cur = [], [ys[0]]
                for y in ys[1:]:
                    if y - cur[-1] <= 4:
                        cur.append(y)
                    else:
                        runs.append(cur)
                        cur = [y]
                runs.append(cur)
                best = max(runs, key=len)
                ys = np.array(best)
                y = float(np.median(ys))
                result[name]['points'][f'{ion}|{s}'] = {'G': round(val(y), 1), 'px': [cx, y], 'n': int(len(ys))}
                if dr:
                    dr.ellipse((cx - 4, y - 4, cx + 4, y + 4), outline=(0, 200, 0), width=2)
    json.dump(result, open(out, 'w'), indent=1)
    if overlay:
        img.save(overlay)

if __name__ == '__main__':
    main(*sys.argv[1:])
