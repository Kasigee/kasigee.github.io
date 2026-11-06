// Blog extras: a view count on each post and in the post list, and comments through giscus.
//
// View counts come from GoatCounter's public counter. It counts visitors (a reader returning in the
// same session isn't counted twice) and updates every few hours. A count stays hidden until the
// page has had its first counted visit, or if the counter can't be reached (some ad blockers block it).
import { GOATCOUNTER, GISCUS, GUEST_COMMENTS } from './site-config.js';

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
const showGiscus = (on) => {
  box.hidden = !on;
  document.querySelectorAll('[data-when="giscus"]').forEach((el) => { el.hidden = !on; });
  document.querySelectorAll('[data-when="no-giscus"]').forEach((el) => { el.hidden = on; });
};
if (box && GISCUS.repoId && GISCUS.categoryId) {
  // If giscus can't run on the repository (its app isn't installed, say), fall back to the email
  // option rather than show an error box. "Discussion not found" is normal before a first comment.
  window.addEventListener('message', (event) => {
    if (event.origin !== 'https://giscus.app') return;
    const error = event.data?.giscus?.error;
    if (typeof error === 'string' && /not installed/i.test(error)) showGiscus(false);
  });
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
  if (GUEST_COMMENTS.endpoint && GUEST_COMMENTS.turnstileSiteKey) addGuestForm(term);
  showGiscus(true);
}

// "No GitHub account? Comment as a guest": a name, a comment and a Turnstile check, sent to the
// guest-comments Worker, which posts the comment into this post's giscus thread.
function addGuestForm(term) {
  const details = document.createElement('details');
  details.className = 'guest';
  details.dataset.when = 'giscus';
  details.innerHTML = `
    <summary>No GitHub account? Comment as a guest</summary>
    <form novalidate>
      <label>Name <input name="name" maxlength="60" autocomplete="name" required></label>
      <label>Comment <textarea name="comment" maxlength="4000" rows="5" required></textarea></label>
      <div class="hp" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></div>
      <div class="turnstile"></div>
      <p class="fine-print">Guest comments are public. They appear below through a shared guest account, under the name you give. Please keep it civil: I remove spam.</p>
      <button type="submit">Post comment</button>
      <p class="status" role="status" aria-live="polite"></p>
    </form>`;
  box.before(details);

  const form = details.querySelector('form');
  const field = (name) => form.querySelector(`[name="${name}"]`);
  const button = form.querySelector('button');
  const status = form.querySelector('.status');
  const say = (text, isError = false) => {
    status.textContent = text;
    status.classList.toggle('err', isError);
  };
  try { field('name').value = localStorage.getItem('guest-name') || ''; } catch { /* storage blocked */ }
  form.addEventListener('input', () => { if (status.classList.contains('err')) say(''); });

  // Load Turnstile only when someone opens the form.
  let token = '';
  let widget;
  details.addEventListener('toggle', async () => {
    if (!details.open || widget !== undefined) return;
    widget = null;
    try {
      await new Promise((resolve, reject) => {
        if (window.turnstile) return resolve();
        const s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true;
        s.onload = resolve;
        s.onerror = reject;
        document.head.append(s);
      });
      widget = window.turnstile.render(form.querySelector('.turnstile'), {
        sitekey: GUEST_COMMENTS.turnstileSiteKey,
        theme: 'auto',
        callback: (t) => { token = t; },
        'expired-callback': () => { token = ''; },
        'error-callback': () => { token = ''; },
      });
    } catch {
      say('The spam check could not load, so guest comments are unavailable. Please email your comment instead.', true);
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = field('name').value.trim();
    const comment = field('comment').value.trim();
    if (!name || !comment) return say('Please add your name and a comment.', true);
    if (!token) return say('Please complete the spam check above, then post again.', true);
    button.disabled = true;
    say('Posting…');
    try {
      let res;
      try {
        res = await fetch(GUEST_COMMENTS.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ term, name, comment, website: field('website').value, token }),
        });
      } catch {
        throw new Error('Your comment could not be sent. Please check your connection, or email it instead.');
      }
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) throw new Error(out.error || 'Your comment could not be posted. Please try again, or email it instead.');
      field('comment').value = '';
      try { localStorage.setItem('guest-name', name); } catch { /* storage blocked */ }
      say('Thank you: your comment is posted. It can take a minute to appear below.');
      // Reload the giscus frame so the new comment shows; again later in case GitHub is slow.
      for (const ms of [1500, 20000]) {
        setTimeout(() => {
          const frame = document.querySelector('iframe.giscus-frame');
          if (frame) frame.src = frame.src;
        }, ms);
      }
    } catch (err) {
      say(err.message, true);
    } finally {
      token = ''; // Turnstile tokens work once
      if (widget) window.turnstile.reset(widget);
      button.disabled = false;
    }
  });
}
