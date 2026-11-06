// Settings for the visit counter and the blog comments, kept in one place.

// GoatCounter (goatcounter.com) counts visits without cookies. The view counts on blog posts use its
// public counter, which needs "Allow adding visitor counts on your website" ticked in its settings.
// The counting script itself is the <script data-goatcounter> line in each page's <head>.
export const GOATCOUNTER = 'https://kasimirgregory.goatcounter.com';

// giscus (giscus.app) stores blog comments as GitHub Discussions on this site's repository, one
// discussion per post, in the "Comments" category (an open-ended discussion category). To move them
// to another category, put its name and ID here: giscus.app lists the IDs once you enter the repo.
// An empty categoryId switches comments off, leaving the email option.
export const GISCUS = {
  repo: 'Kasigee/kasigee.github.io',
  repoId: 'R_kgDOVaV21Q',
  category: 'Comments',
  categoryId: 'DIC_kwDOVaV21c4DKf4F',
};

// Guest comments, for readers without a GitHub account: a form on each post sends the comment to a
// small Cloudflare Worker (worker/guest-comments/), which posts it into the post's giscus thread
// through a separate guest GitHub account. Cloudflare Turnstile keeps bots out. The form appears once
// both values are filled in; both are public, so they're safe here.
export const GUEST_COMMENTS = {
  endpoint: '', // the Worker's address, e.g. https://guest-comments.your-name.workers.dev
  turnstileSiteKey: '', // the site key of the Turnstile widget for kasimirgregory.com
};
