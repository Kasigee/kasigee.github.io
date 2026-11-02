# Papers on disc

All 24 of Kas's papers (23 refereed articles and a preprint) as glass disc cases on a rotating shelf (`index.html`, `tapes.css`, `tapes.js`, `tapes-data.js`). The disc slides out of the case at the front of the shelf, and pressing play opens its paper. The file and class names still say tape: the shelf began as VHS tapes, and that version is on the `archive/papers-vhs` branch. A filter narrows the shelf to the eight papers where Kas is first or joint first author, and the catalogue lists every paper, newest first. A paper led by someone else says so on its case and in its caption, naming the first author.

Six discs play an interactive Three.js scene drawn from the paper's own numbers; those scenes are described below. Every other disc shows a schematic drawing of the paper's subject, captioned as a schematic on the page. Three of those drawings (the 2022 specific-ion-effects review, the 2025 inductive-effect paper and the malaria transporter preprint) are SVGs in `index.html`, made by `build/schematic_art.py`. The other 18 are drawn in the browser by `schematics.js`.

| Paper | What the scene shows | Data |
|---|---|---|
| Hofmeister series, Chem. Sci. 2021 ([10.1039/d1sc03568a](https://doi.org/10.1039/d1sc03568a)) | The surface ϸ = q/r over site charge and effective radius, with 23 anions placed at their computed q and r. Click an anion, or pick it from the ranked list, to read its values. | Site-specific rows of ESI Table S2. Every row shown passes the check ϸ = 16.0218·q/r. |
| PAHAPS, J. Comput. Chem. 2025 ([10.1002/jcc.70198](https://doi.org/10.1002/jcc.70198)) | All 38,264 PBE0-D4 isomer energies, one histogram row per formula and one dot per isomer. Three C₄₄H₂₄ isomers (the most stable, a typical one and the least stable) open as 3D molecules, with their C–C bonds coloured by dihedral deviation. | `COMPAS_XTB_MS_WEBAPP_DATA.csv` from the PAHAPS web app. The counts, means and maxima match Table 1. The MAD bars come from Tables 2 and 3. |
| IonSolvR, Sci. Data 2022 ([10.1038/s41597-022-01527-8](https://doi.org/10.1038/s41597-022-01527-8)) | The four NaCl–water cells (32, 64, 100 and 300 waters) drawn to scale. Pick one cell to see the periodic copies of its ions. | Cell edges and concentrations from the Technical Validation section. |
| PNIPAM brush, Macromolecules 2016 ([10.1021/acs.macromol.6b01001](https://doi.org/10.1021/acs.macromol.6b01001)) | Polymer volume fraction against distance from the surface, one ribbon per measured temperature, in D₂O and in 100 and 250 mM potassium acetate and thiocyanate. | The fitted neutron reflectometry parameters in SI Tables S1–S5 (`build/brush_tables.json`), turned into profiles with the paper's model (Equations 1–3: Gaussian-rough slabs, then a Gaussian, tanh or power-law parabola tail in 50 layers) by `build/brush_profiles.py` and `build/brush_data.py`. |
| Lewis strength, J. Phys. Chem. A 2019 ([10.1021/acs.jpca.9b04004](https://doi.org/10.1021/acs.jpca.9b04004)) | A grid of bars: the free energy of interaction between a NIPAM monomer and SCN⁻, Cl⁻, F⁻, K⁺, Na⁺ and Li⁺ (ordered by Lewis strength) in water, methanol, acetonitrile, DMSO and no solvent. A toggle adds the desolvation penalty, which reverses the cation series in DMSO. A NIPAM model above shows the chosen ion at its binding site. | Figure 4 of the paper (`build/lewis_figure4.json`), with Lewis strengths and cation–O distances from its text. `build/lewis_data.py` writes `lewis-data.js`. |
| Amino acids, Electron. Struct. 2023 ([10.1088/2516-1075/acbe84](https://doi.org/10.1088/2516-1075/acbe84)) | Every optimised anion–amino acid complex in 3D: pick F⁻, Cl⁻, SCN⁻ or PF₆⁻ and one of the 20 amino acids, then step through each binding configuration. The anion's contacts with hydrogens within 2.6 Å are drawn and measured, and each is classed as backbone acid OH, backbone amine NH or sidechain. The readout adds the amino acid's Table S1 correlations and the anion's ϸ. | The 345 M06-2X/aug-cc-pVDZ geometries in the paper's SI ZIP (CC BY 4.0, from the article's Supplementary data page on IOPscience) and Table S1. `build/sapt_data.py` reads the unzipped `.xyz` folder and writes `sapt-data.js`; one file, for BF₄⁻ with alanine, isn't in the paper and is left out. |

## What is not paper data (the captions on the page also say this)

- **Amino acid contacts and binding sites** are measured from each SI geometry by `build/sapt_data.py`: anion atoms (F, Cl, S, N) within 2.6 Å of an amino acid hydrogen, with each H assigned to the backbone acid OH, the backbone amine NH or the sidechain from the bonds. The paper's own site labels come from its figures, so a few borderline contacts may be classed differently. In one complex (isoleucine with F⁻, Kick seed 674), F⁻ has taken the carboxylic acid proton (F–H 1.00 Å), and the page says so. The per-complex interaction energies are only in the paper's plots, so the scene doesn't show them.

- **Lewis strength energies** are read from Figure 4, because the paper and its SI give them only as plots, and the figure is a raster image. Each value was read by eye from magnified crops with a 1 kcal/mol grid (`build/lewis_digitise.py` holds the axis calibration and a first automatic pass, which overlapping markers defeat). They are good to about ±0.5 kcal/mol where markers overlap. If the original numbers turn up, replace `build/lewis_figure4.json` and rerun `build/lewis_data.py`.
- **The NIPAM model** in the Lewis scene is N-isopropyl-2-methylbutanamide (the saturated residue the paper draws), embedded with RDKit and optimised with MMFF94, not the paper's DFTB geometries. Cations sit at the paper's M⁺–O distances (in water, with Cl⁻); the anion's distance from the N–H isn't in the paper's text, so it is drawn at a fixed 2.1 Å.

- **Brush profiles** are rebuilt from the tabulated fits, not taken from the paper's plotted curves. As a check, twice the first moment of each profile is compared with the paper's thicknesses. In D₂O all eight agree with the inset of Figure 2 to within 3%. Seven of the 35 salt conditions don't match Figure 5, so the page leaves them out (`LEFT_OUT` in `build/brush_data.py`): 100 mM acetate at 27.5 and 30 °C, 250 mM acetate at 20, 22.5, 25 and 35 °C (at 25 °C the table gives a Gaussian tail with no parameters), and 100 mM thiocyanate at 32.5 °C. These may be transcription errors in the SI tables.

- **IonSolvR water positions** are a random packing (seed 2022, no overlaps closer than 2.45 Å O–O). They are not frames from the repository.
- **The three PAH molecules** were re-optimised with GFN2-xTB (tblite, from RDKit starting structures), because the COMPAS-3x coordinates aren't in the app data.
  - The most stable isomer has Σ<sub>dihedral</sub> = 0°.
  - The typical isomer has Σ<sub>dihedral</sub> = 1,108°, and its prediction is 2.9 kcal/mol off, within the paper's 3.6 MAD.
  - The least stable isomer has Σ<sub>dihedral</sub> = 1,511° here, but the paper reports 1,770° for the COMPAS-3x structure. A 22-start conformer search found nothing near 1,770°, so the page labels it as a different conformer.
- **In the PAH histograms,** the dots in each 0.5 kcal/mol bin are spread evenly up their column, using a golden-ratio sequence. Each column's height is that formula's share of isomers in the bin. A dot's x position is its exact energy.

## Files

- `index.html`: the page. The six papers with a scene or a handwritten page play an `<article id="body-…">` in it, so their text is readable without JavaScript. Without JavaScript the page points to the full publication list on the home page for the rest.
- `tapes-data.js`: every paper, oldest first. Each entry holds what is printed on the case (title, tagline, synopsis, credits, badges, DOI), `first: true` or the first author's name in `lead` (`role` overrides the role shown), and either `art` (an image), `schematic` (a key in `schematics.js`) or `scene: true`. The 18 papers without a handwritten page also carry a `body`, which `tapes.js` turns into the page that plays.
- `schematics.js`: the 18 schematic drawings, as SVG strings. None of them shows data.
- `tapes.js`, `tapes.css`: the shelf, the cases and playback.
- `paper-visuals.js`: the three scenes. Each one mounts the first time its disc plays.
- `paper-data.js`: the extracted data, about 150 KB.
- `../vendor/three/`: Three.js r186 (MIT licence), shared with the home page.
- `build/`: the scripts that produced `paper-data.js` (each takes its input and output paths as arguments), and `schematic_art.py`, which draws the three schematics in `index.html`.

## Preview

Serve the site root (`python3 -m http.server 8000`) and open http://localhost:8000/papers/. Tested in Chromium at 1440 px and 390 px wide with no console errors.

## Place in the site

Each Research feature on the home page shows a still of one scene (`../img/*.webp`) that links to `papers/#hofmeister`, `papers/#pahaps` or `papers/#ionsolvr`, which turns to that disc and plays it. The same stills are the cover art of those three cases. If a scene changes, retake its still: with the site served locally, screenshot the scene's `.stage` at 2× in a 1360 px wide window, and save it as WebP at 1120 px wide in `../img/`.

## Still to confirm with Kas

- The PAHAPS web app and code links (`pahaps.streamlit.app` and `github.com/Kasigee/PAH_Analysis`).
