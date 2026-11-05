// Blog extras: a view count on each post and in the post list, and comments through giscus.
//
// View counts come from GoatCounter's public counter. It counts visitors (a reader returning in the
// same session isn't counted twice) and updates every few hours. A count stays hidden until the
// page has had its first counted visit, or if the counter can't be reached (some ad blockers block it).
import { GOATCOUNTER, GISCUS } from './site-config.js';

const SVG = 'http://www.w3.org/2000/svg';

function eye() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'eye');
  svg.setAttribute('aria-hidden', 'true');
  const outline = document.createElementNS(SVG, 'path');
  outline.setAttribute('d', 'M1.8 12S5.7 5 12 5s10.2 7 10.2 7-3.9 7-10.2 7S1.8 12 1.8 12Z');
  const pupil = document.createElementNS(SVG, 'circle');
  pupil.setAttribute('cx', '12');
  pupil.setAttribute('cy', '12');
  pupil.setAttribute('r', '3.1');
  svg.append(outline, pupil);
  return svg;
}

async function showViews(el) {
  try {
    const res = await fetch(`${GOATCOUNTER}/counter/${encodeURIComponent(el.dataset.views)}.json`);
    if (!res.ok) return;
    const { count } = await res.json();
    const n = Number(String(count).replace(/\D/g, ''));
    if (!n) return;
    const number = document.createElement('b');
    number.textContent = String(count);
    el.replaceChildren(' · ', eye(), number, n === 1 ? ' view' : ' views');
    el.title = 'Readers counted by GoatCounter, updated every few hours';
    el.hidden = false;
  } catch {
    // Offline or blocked: leave the count hidden.
  }
}

document.querySelectorAll('[data-views]').forEach(showViews);

// Comments: load giscus once it is configured; until then only the email option shows.
const box = document.querySelector('.giscus');
if (box && GISCUS.repoId && GISCUS.categoryId) {
  // One discussion per post, keyed by the post's canonical path so /index.html and query strings
  // don't split its comments.
  const canonical = document.querySelector('link[rel="canonical"]')?.href;
  const term = canonical ? new URL(canonical).pathname : location.pathname;
  const script = document.createElement('script');
  script.src = 'https://giscus.app/client.js';
  const attrs = {
    repo: GISCUS.repo,
    'repo-id': GISCUS.repoId,
    category: GISCUS.category,
    'category-id': GISCUS.categoryId,
    mapping: 'specific',
    term,
    strict: '1',
    'reactions-enabled': '1',
    'emit-metadata': '0',
    'input-position': 'top',
    theme: 'preferred_color_scheme',
    lang: 'en',
    loading: 'lazy',
  };
  for (const [key, value] of Object.entries(attrs)) script.setAttribute(`data-${key}`, value);
  script.crossOrigin = 'anonymous';
  script.async = true;
  box.after(script);
  document.querySelectorAll('[data-when="giscus"]').forEach((el) => { el.hidden = false; });
  document.querySelectorAll('[data-when="no-giscus"]').forEach((el) => { el.hidden = true; });
}
