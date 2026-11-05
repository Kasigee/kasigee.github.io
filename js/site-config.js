// Settings for the visit counter and the blog comments, kept in one place.

// GoatCounter (goatcounter.com) counts visits without cookies. The view counts on blog posts use its
// public counter, which needs "Allow adding visitor counts on your website" ticked in its settings.
// The counting script itself is the <script data-goatcounter> line in each page's <head>.
export const GOATCOUNTER = 'https://kasimirgregory.goatcounter.com';

// giscus (giscus.app) stores blog comments as GitHub Discussions on this site's repository.
// Comments stay switched off until categoryId is filled in; the ID comes from giscus.app once
// Discussions are on and a "Comments" category exists.
export const GISCUS = {
  repo: 'Kasigee/kasigee.github.io',
  repoId: 'R_kgDOVaV21Q',
  category: 'Comments',
  categoryId: '',
};
