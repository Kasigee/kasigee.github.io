# Draws the three schematic pictures on the papers page (the specific-ion-effects review, the
# inductive-effect papers and the malaria transporter) and prints them as JSON, keyed by tape id.
# The SVG markup is pasted into each tape's .art-stage in papers/index.html; the covers reuse it.
# These are drawings, not data: each caption on the page says so.
def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

def hexc(c):
    return '#%02x%02x%02x' % c

def ramp(t):
    stops = [(0x2f, 0xc4, 0xb8), (0xf4, 0xc5, 0x1f), (0xef, 0x4b, 0x55)]
    if t <= 0.5:
        return hexc(lerp(stops[0], stops[1], t / 0.5))
    return hexc(lerp(stops[1], stops[2], (t - 0.5) / 0.5))

def review():
    ions = ['CO₃²⁻', 'SO₄²⁻', 'H₂PO₄⁻', 'F⁻', 'Cl⁻', 'Br⁻', 'NO₃⁻', 'I⁻', 'ClO₄⁻', 'SCN⁻']
    out = ['<svg class="art-svg" viewBox="0 0 320 220" role="img" aria-label="The classic Hofmeister series of anions, from carbonate and sulfate to perchlorate and thiocyanate.">',
           '<defs><linearGradient id="hs-ramp" gradientUnits="userSpaceOnUse" x1="24" y1="0" x2="296" y2="0"><stop offset="0" stop-color="#2fc4b8"/><stop offset="0.5" stop-color="#f4c51f"/><stop offset="1" stop-color="#ef4b55"/></linearGradient></defs>',
           '<g fill="none" stroke="rgba(219,228,240,0.18)" stroke-dasharray="2 4">']
    pts = []
    for i, ion in enumerate(ions):
        x = 26 + i * 29.8
        y = 64 + i * 8.6
        pts.append((x, y))
    out.append('<path d="M' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in pts) + '"/></g>')
    for i, (ion, (x, y)) in enumerate(zip(ions, pts)):
        c = ramp(i / (len(ions) - 1))
        ly = y - 17 if i % 2 == 0 else y + 26
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="10" fill="{c}" stroke="#0b1018" stroke-width="1.5"/>')
        out.append(f'<circle cx="{x - 3:.1f}" cy="{y - 3:.1f}" r="3" fill="rgba(255,255,255,0.55)"/>')
        out.append(f'<text x="{x:.1f}" y="{ly:.1f}" text-anchor="middle" fill="#dbe4f0" font-family="IBM Plex Mono, monospace" font-size="10">{ion}</text>')
    out.append('<path d="M24 182 H296" stroke="url(#hs-ramp)" stroke-width="3" stroke-linecap="round"/>')
    out.append('<path d="M30 176 L22 182 L30 188 M290 176 L298 182 L290 188" fill="none" stroke="#dbe4f0" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>')
    out.append('<text x="24" y="204" fill="#93a0b2" font-family="IBM Plex Mono, monospace" font-size="9.5">kosmotropic</text>')
    out.append('<text x="296" y="204" text-anchor="end" fill="#93a0b2" font-family="IBM Plex Mono, monospace" font-size="9.5">chaotropic</text>')
    out.append('</svg>')
    return ''.join(out)

def inductive():
    ink = '#e8ecf3'
    vio = '#a78bfa'
    X, C1, C2, Om, Od = (64, 138), (120, 106), (176, 138), (232, 106), (176, 196)
    s = ['<svg class="art-svg" viewBox="0 0 320 220" role="img" aria-label="A haloacetate drawn as a skeletal formula, X–CH₂–CO₂⁻, with the textbook inductive pull drawn on the C–X bond and a large question mark.">']
    s.append(f'<g stroke="{ink}" stroke-width="3" stroke-linecap="round" fill="none">')
    s.append(f'<path d="M{X[0]+14} {X[1]-8} L{C1[0]} {C1[1]} L{C2[0]} {C2[1]} L{Om[0]-10} {Om[1]+6}"/>')
    s.append(f'<path d="M{C2[0]-5} {C2[1]+4} L{Od[0]-5} {Od[1]-12} M{C2[0]+5} {C2[1]+4} L{Od[0]+5} {Od[1]-12}"/>')
    s.append('</g>')
    # inductive "pull" arrow drawn along the C–X bond
    s.append(f'<path d="M110 98 L82 114" stroke="#ef4b55" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M86 106 L80 115 L91 114" stroke="#ef4b55" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" fill="none"/>')
    s.append(f'<text x="{X[0]}" y="{X[1]+10}" text-anchor="middle" fill="{vio}" font-family="Anton, Impact, sans-serif" font-size="30">X</text>')
    s.append(f'<text x="{X[0]-18}" y="{X[1]-18}" fill="#ef4b55" font-family="IBM Plex Mono, monospace" font-size="12">δ−</text>')
    s.append(f'<text x="{C1[0]-14}" y="{C1[1]-16}" fill="#2fc4b8" font-family="IBM Plex Mono, monospace" font-size="12">δ+</text>')
    s.append(f'<text x="{C1[0]+10}" y="{C1[1]-8}" fill="#93a0b2" font-family="IBM Plex Mono, monospace" font-size="10">CH₂</text>')
    s.append(f'<text x="{Om[0]+4}" y="{Om[1]+4}" fill="{ink}" font-family="IBM Plex Sans, sans-serif" font-size="17">O⁻</text>')
    s.append(f'<text x="{Od[0]}" y="{Od[1]+6}" text-anchor="middle" fill="{ink}" font-family="IBM Plex Sans, sans-serif" font-size="17">O</text>')
    s.append(f'<text x="290" y="92" text-anchor="middle" fill="{vio}" font-family="Anton, Impact, sans-serif" font-size="78" opacity="0.92">?</text>')
    s.append('<text x="24" y="204" fill="#93a0b2" font-family="IBM Plex Mono, monospace" font-size="9.5">X = F, Cl, Br, I</text>')
    s.append('<text x="24" y="30" fill="#93a0b2" font-family="IBM Plex Mono, monospace" font-size="9.5">the textbook picture</text>')
    s.append('</svg>')
    return ''.join(s)

def malaria():
    s = ['<svg class="art-svg" viewBox="0 0 320 220" role="img" aria-label="Schematic of a membrane transporter: lactate and a proton pass together from inside the parasite, through a channel-like pore, to the outside.">']
    # lipid bilayer
    heads = []
    tails = []
    for i in range(26):
        x = 8 + i * 12.2
        if 120 < x < 200:
            continue
        heads.append(f'<circle cx="{x:.1f}" cy="88" r="5"/><circle cx="{x:.1f}" cy="150" r="5"/>')
        tails.append(f'<path d="M{x-2:.1f} 93 V112 M{x+2:.1f} 93 V112 M{x-2:.1f} 145 V126 M{x+2:.1f} 145 V126"/>')
    s.append('<g stroke="rgba(219,228,240,0.35)" stroke-width="1.4" fill="none">' + ''.join(tails) + '</g>')
    s.append('<g fill="#3b4b63" stroke="#7f93b0" stroke-width="1">' + ''.join(heads) + '</g>')
    # transporter: two halves around a pore
    s.append('<g fill="#7bd389" stroke="#0b1018" stroke-width="2">')
    s.append('<rect x="124" y="66" width="30" height="106" rx="12"/><rect x="166" y="66" width="30" height="106" rx="12"/></g>')
    s.append('<g fill="rgba(11,16,24,0.25)"><rect x="130" y="76" width="8" height="86" rx="4"/><rect x="182" y="76" width="8" height="86" rx="4"/></g>')
    # path through the pore
    s.append('<path d="M160 206 V20" stroke="#dbe4f0" stroke-width="1.5" stroke-dasharray="4 4" fill="none"/>')
    s.append('<path d="M153 28 L160 18 L167 28" stroke="#dbe4f0" stroke-width="1.5" fill="none" stroke-linejoin="round"/>')
    def proton(x, y):
        return f'<circle cx="{x}" cy="{y}" r="9" fill="#ef4b55" stroke="#0b1018" stroke-width="1.5"/><text x="{x}" y="{y+3.5}" text-anchor="middle" fill="#fff" font-family="IBM Plex Mono, monospace" font-size="9">H⁺</text>'
    def lactate(x, y):
        return f'<circle cx="{x}" cy="{y}" r="12" fill="#f4c51f" stroke="#0b1018" stroke-width="1.5"/><text x="{x}" y="{y+3.5}" text-anchor="middle" fill="#0b1018" font-family="IBM Plex Mono, monospace" font-size="8.5">lac⁻</text>'
    s.append(lactate(134, 196) + proton(186, 198))
    s.append(proton(160, 120))
    s.append(lactate(192, 36) + proton(130, 40))
    s.append('<text x="12" y="24" fill="#93a0b2" font-family="IBM Plex Mono, monospace" font-size="9.5">outside</text>')
    s.append('<text x="12" y="212" fill="#93a0b2" font-family="IBM Plex Mono, monospace" font-size="9.5">inside the parasite</text>')
    s.append('<text x="308" y="124" text-anchor="end" fill="#93a0b2" font-family="IBM Plex Mono, monospace" font-size="9.5">membrane</text>')
    s.append('</svg>')
    return ''.join(s)

if __name__ == '__main__':
    import json, sys
    json.dump({'review': review(), 'inductive': inductive(), 'malaria': malaria()}, sys.stdout, ensure_ascii=False)
