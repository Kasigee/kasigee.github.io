// Home page behaviour: the atoms hero, the two live figures, the rotating words and the project
// video. The header, menu, reveal-on-scroll and email address are shared with the other pages
// (chrome.js). The 3D paper scenes live on papers/.
import './chrome.js';
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
