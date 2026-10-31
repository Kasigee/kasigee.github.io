# kasigee.github.io
Kasimir Gregory
Kas obtained a Bachelor of Mathematics/Bachelor of Science (Hons – Chemistry and University Medal) from the University of Newcastle in 2018 and followed by undertaking a PhD there under the supervision of Prof. Alister Page, Prof. Erica Wanless and Prof. Grant Webber. During his PhD he investigated specific ion effects via computational and quantum chemistry. He then undertook a postdoctoral fellowship under the supervision of Prof. Vince Craigin Materials Physics at the Australian National University (ANU) to continue this project experimentally, by building a maximum bubble pressure surface tensiometer to use on nonaqueous electrolytes. Following this Kas moved across to the Division of Biomedical Sciences and Biochemistry in the Research School of Biology at ANU to work with Prof. Ben Corry. Primarily this project was investigating the thermodiffusion of salts with the purpose of optimising this potential new membrane free desalination method, as well as malarial protein transport mechanisms. Both via molecular dynamics simulations. Kas is now lecturing in Computational, Physical and Theoretical Chemistry at the University of New England. He also has a podcast, Anion the Future, for exploring Academics Novel Ideas, Origins and Networks.
kasimirgregory.com

## About this site

A static site with no build step, served by GitHub Pages at kasimirgregory.com (see `CNAME`). It has two pages:

- **Home** (`index.html`): "Dr Kas" spelled in iridescent atoms that scatter as you scroll, what Kas is working on in 2026, this year's talks, two live simulations, three papers with stills of their 3D views, and the publication list.
- **Papers on disc** (`papers/`): all 24 of Kas's papers (23 refereed articles and a preprint) as glass disc cases on a rotating shelf. The disc slides out of the case at the front. Drag, scroll or use the arrow keys to turn the shelf, press F to flip a case and read its back, and press play to open the paper. A filter narrows the shelf to the eight papers where Kas is first or joint first author, and the catalogue lists every paper, newest first. Three discs play an interactive 3D scene built from the paper's own data, and the rest show a schematic drawing of the paper's subject. `papers/#` followed by a paper's id (for example `papers/#hofmeister` or `papers/#malaria`) opens straight onto that paper. The ids are in `papers/tapes-data.js`.

The shelf began as a row of VHS tapes. That version is kept on the `archive/papers-vhs` branch, and the papers page's file names (`tapes.js`, `tapes.css`, `tapes-data.js`) date from it.

### Files

- `index.html`, `css/site.css`: the home page.
- `js/main.js`: menu, rotating words, reveal on scroll, the project video, and the email address, which is assembled in the browser to keep it from scrapers.
- `js/hero-atoms.js`: the "Dr Kas" atoms. They use capitals because a lowercase a and s lose their counters at this atom spacing. On a tall, narrow screen the words stack.
- `js/figures/`: the live figures. `lj-engine.js` is the Lennard-Jones simulation (velocity Verlet, periodic box, Berendsen thermostat), `liquid-scene.js` draws it, `reaction-model.js` holds the schematic SN2 energy profile and geometry, `reaction-scene.js` draws the reaction, and `figures.js` wires up the controls. Both figures render only while they are on screen.
- `papers/index.html`, `papers/tapes.css`, `papers/tapes.js`: the papers page. `papers/tapes-data.js` holds every paper: what is printed on its case and, for 18 of them, the text that plays. The other six play a handwritten `<article id="body-…">` in `papers/index.html`. `papers/schematics.js` draws the schematic covers.
- `papers/paper-visuals.js`, `papers/paper-data.js`, `papers/build/`: the three 3D paper scenes and the data behind them. See `papers/README.md`.
- `img/`: the portrait, the stills of the 3D scenes, the video poster, the favicon and the social preview images. `media/eva-glass.mp4`: the solar-panel simulation in the "Now" section (2.4 MB, silent, pauses off screen, no autoplay for reduced motion).
- `vendor/three/`: Three.js r186 (MIT licence), with OrbitControls, CSS2DRenderer and RoomEnvironment. The r186 npm package doesn't ship a minified build, so `three.module.min.js` was bundled from `three@0.186.1` with esbuild (`esbuild node_modules/three/build/three.module.js --bundle --format=esm --minify`), and the add-ons were minified the same way.

The only outside requests are the Google Fonts stylesheets (Spectral, IBM Plex Sans and Mono, Space Grotesk, and Unbounded for the letters D, r, K, a, s, R, A and S only). Every page falls back to system fonts if they fail.

### Preview locally

```
python3 -m http.server 8000
```

Then open http://localhost:8000. The pages use JavaScript modules, which browsers block on `file://`.

### Still to confirm with Kas

- The summaries on the 18 tapes without a handwritten page were written from each paper's title and its entry in the CV, not from the papers themselves. Check that each one says what its paper says (they are the `body` entries in `papers/tapes-data.js`).
- The press links in "Now" (pv magazine, Sustainability Matters, Lab Next 70) are the ones you sent. They describe the project's leadership differently from the site.
- The PAHAPS web app and code links (`pahaps.streamlit.app`, `github.com/Kasigee/PAH_Analysis`).
- The podcast link goes to anionthefuture.com, which showed a certificate warning. Fix the certificate, or point the link at the show's Spotify or Apple Podcasts page.
- The contact email is kasimir@live.com.au. Change `data-user` and `data-domain` in `index.html` to use another address.
- Add LinkedIn, a tidied GitHub profile, and a CV PDF (see the TODO comments in `index.html`).
- The Talks list follows the 2026 oral presentations in the October 2026 CV. Talks without a title in the CV are listed by event.
- The CV lists the first author of the 2023 protic ionic liquid paper as Burke. The published paper says T. Bourke, and so does the site.
- The 2026 Journal of Colloid and Interface Science paper on ion depth profiles (10.1016/j.jcis.2025.139019) isn't on the ORCID record yet.
