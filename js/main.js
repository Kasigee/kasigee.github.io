// Home page behaviour: the atoms hero, the two live figures, the menu, the rotating words,
// reveal-on-scroll, the project video, and the email address, which is assembled here to keep it
// away from scrapers. The 3D paper scenes live on papers/.
import { mountHero } from './hero-atoms.js';
import { mountFigures } from './figures/figures.js';

const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
document.documentElement.classList.add('js');

const hero = document.querySelector('.hero');
if (hero) mountHero(hero).catch((err) => {
  console.error(err);
  hero.classList.add('no-webgl');
});
mountFigures();

// Email: write the address in, and let the Copy button copy it.
let address = '';
for (const link of document.querySelectorAll('[data-email]')) {
  address = [link.dataset.user, link.dataset.domain].join('@');
  link.href = `mailto:${address}`;
  link.textContent = address;
}
for (const button of document.querySelectorAll('[data-copy-email]')) {
  button.addEventListener('click', () => {
    const selectIt = () => {
      const link = button.parentElement.querySelector('[data-email]');
      if (link) getSelection().selectAllChildren(link);
      button.textContent = 'Selected: press Ctrl+C';
    };
    if (!navigator.clipboard) return selectIt();
    navigator.clipboard.writeText(address).then(() => { button.textContent = 'Copied'; }, selectIt);
  });
}

const year = document.querySelector('[data-year]');
if (year) year.textContent = String(new Date().getFullYear());

// The project video loops silently and pauses off screen. Visitors who ask for reduced motion keep
// the controls from the markup instead, as do visitors without JavaScript.
for (const video of document.querySelectorAll('video[data-autoplay]')) {
  if (REDUCE) continue;
  video.controls = false;
  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) video.play().catch(() => {});
    else video.pause();
  }).observe(video);
}

// Fade sections in as they arrive. Everything shows after 2.5 s regardless, so nothing stays
// hidden if the observer never fires (for example in a full-page screenshot).
const reveal = new IntersectionObserver((entries) => entries.forEach((entry) => {
  if (!entry.isIntersecting) return;
  entry.target.classList.add('in');
  reveal.unobserve(entry.target);
}), { threshold: 0.1 });
document.querySelectorAll('.reveal').forEach((el) => reveal.observe(el));
setTimeout(() => document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in')), 2500);

// The header gets a background once the page has scrolled.
const top = document.querySelector('.top');
const onScroll = () => top.classList.toggle('scrolled', window.scrollY > 24);
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

// Rotating words in the About heading.
const words = [...document.querySelectorAll('.words span')];
let current = 0;
if (!REDUCE && words.length > 1) {
  setInterval(() => {
    const previous = current;
    words[previous].className = 'off';
    current = (current + 1) % words.length;
    words[current].className = 'on';
    setTimeout(() => {
      if (words[previous].className === 'off') words[previous].className = '';
    }, 650);
  }, 2200);
}

// Full-screen menu for narrow screens.
const menu = document.getElementById('menu');
const menuButton = document.querySelector('.menu-btn');
const setMenu = (open) => {
  menuButton.setAttribute('aria-expanded', String(open));
  if (open) {
    menu.hidden = false;
    void menu.offsetWidth; // apply the closed state first so the reveal animates
    menu.classList.add('open');
    menu.querySelector('a')?.focus();
  } else {
    menu.classList.remove('open');
    setTimeout(() => { menu.hidden = true; }, REDUCE ? 0 : 700);
  }
};
menuButton.addEventListener('click', () => setMenu(menuButton.getAttribute('aria-expanded') !== 'true'));
menu.querySelector('.close').addEventListener('click', () => {
  setMenu(false);
  menuButton.focus();
});
menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setMenu(false)));
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
    setMenu(false);
    menuButton.focus();
  }
});
