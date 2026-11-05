// Shared by every page: the header and full-screen menu, reveal-on-scroll, the year in the footer,
// and the email address, which is assembled here to keep it away from scrapers.
const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
document.documentElement.classList.add('js');

// Email: write the address in, and let the Copy button copy it.
let address = '';
for (const link of document.querySelectorAll('[data-email]')) {
  address = [link.dataset.user, link.dataset.domain].join('@');
  const subject = link.dataset.subject ? `?subject=${encodeURIComponent(link.dataset.subject)}` : '';
  link.href = `mailto:${address}${subject}`;
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
const onScroll = () => top?.classList.toggle('scrolled', window.scrollY > 24);
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

// Full-screen menu for narrow screens.
const menu = document.getElementById('menu');
const menuButton = document.querySelector('.menu-btn');
if (menu && menuButton) {
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
}
