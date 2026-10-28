# Papers on tape

All 24 of Kas's papers (23 refereed articles and a preprint) as VHS sleeves on a rotating shelf (`index.html`, `tapes.css`, `tapes.js`, `tapes-data.js`). Pressing play on a tape opens its paper. A filter narrows the shelf to the eight papers where Kas is first or joint first author, and the catalogue lists every tape, newest first. A tape led by someone else says so on its sleeve and in its caption, naming the first author.

Three tapes play an interactive Three.js scene drawn from the paper's own numbers; those scenes are described below. Every other tape shows a schematic drawing of the paper's subject, captioned as a schematic on the page. Three of those drawings (the 2022 specific-ion-effects review, the 2025 inductive-effect paper and the malaria transporter preprint) are SVGs in `index.html`, made by `build/schematic_art.py`. The other 18 are drawn in the browser by `schematics.js`.

| Paper | What the scene shows | Data |
|---|---|---|
| Hofmeister series, Chem. Sci. 2021 ([10.1039/d1sc03568a](https://doi.org/10.1039/d1sc03568a)) | The surface ϸ = q/r over site charge and effective radius, with 23 anions placed at their computed q and r. Click an anion, or pick it from the ranked list, to read its values. | Site-specific rows of ESI Table S2. Every row shown passes the check ϸ = 16.0218·q/r. |
| PAHAPS, J. Comput. Chem. 2025 ([10.1002/jcc.70198](https://doi.org/10.1002/jcc.70198)) | All 38,264 PBE0-D4 isomer energies, one histogram row per formula and one dot per isomer. Three C₄₄H₂₄ isomers (the most stable, a typical one and the least stable) open as 3D molecules, with their C–C bonds coloured by dihedral deviation. | `COMPAS_XTB_MS_WEBAPP_DATA.csv` from the PAHAPS web app. The counts, means and maxima match Table 1. The MAD bars come from Tables 2 and 3. |
| IonSolvR, Sci. Data 2022 ([10.1038/s41597-022-01527-8](https://doi.org/10.1038/s41597-022-01527-8)) | The four NaCl–water cells (32, 64, 100 and 300 waters) drawn to scale. Pick one cell to see the periodic copies of its ions. | Cell edges and concentrations from the Technical Validation section. |

## What is not paper data (the captions on the page also say this)

- **IonSolvR water positions** are a random packing (seed 2022, no overlaps closer than 2.45 Å O–O). They are not frames from the repository.
- **The three PAH molecules** were re-optimised with GFN2-xTB (tblite, from RDKit starting structures), because the COMPAS-3x coordinates aren't in the app data.
  - The most stable isomer has Σ<sub>dihedral</sub> = 0°.
  - The typical isomer has Σ<sub>dihedral</sub> = 1,108°, and its prediction is 2.9 kcal/mol off, within the paper's 3.6 MAD.
  - The least stable isomer has Σ<sub>dihedral</sub> = 1,511° here, but the paper reports 1,770° for the COMPAS-3x structure. A 22-start conformer search found nothing near 1,770°, so the page labels it as a different conformer.
- **In the PAH histograms,** the dots in each 0.5 kcal/mol bin are spread evenly up their column, using a golden-ratio sequence. Each column's height is that formula's share of isomers in the bin. A dot's x position is its exact energy.

## Files

- `index.html`: the page. The six tapes with a scene or a handwritten page play an `<article id="body-…">` in it, so their text is readable without JavaScript. Without JavaScript the page points to the full publication list on the home page for the rest.
- `tapes-data.js`: every tape, oldest first. Each entry holds what is printed on the sleeve (title, tagline, synopsis, credits, badges, DOI), `first: true` or the first author's name in `lead` (`role` overrides the role shown), and either `art` (an image), `schematic` (a key in `schematics.js`) or `scene: true`. The 18 tapes without a handwritten page also carry a `body`, which `tapes.js` turns into the page that plays.
- `schematics.js`: the 18 schematic drawings, as SVG strings. None of them shows data.
- `tapes.js`, `tapes.css`: the shelf, the sleeves and playback.
- `paper-visuals.js`: the three scenes. Each one mounts the first time its tape plays.
- `paper-data.js`: the extracted data, about 150 KB.
- `../vendor/three/`: Three.js r186 (MIT licence), shared with the home page.
- `build/`: the scripts that produced `paper-data.js` (each takes its input and output paths as arguments), and `schematic_art.py`, which draws the three schematics in `index.html`.

## Preview

Serve the site root (`python3 -m http.server 8000`) and open http://localhost:8000/papers/. Tested in Chromium at 1440 px and 390 px wide with no console errors.

## Place in the site

Each Research feature on the home page shows a still of one scene (`../img/*.webp`) that links to `papers/#hofmeister`, `papers/#pahaps` or `papers/#ionsolvr`, which turns to that tape and plays it. The same stills are the cover art of those three sleeves. If a scene changes, retake its still: with the site served locally, screenshot the scene's `.stage` at 2× in a 1360 px wide window, and save it as WebP at 1120 px wide in `../img/`.

## Still to confirm with Kas

- The PAHAPS web app and code links (`pahaps.streamlit.app` and `github.com/Kasigee/PAH_Analysis`).
