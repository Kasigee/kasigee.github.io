// Guest comments for the blog on kasimirgregory.com: a Cloudflare Worker.
//
// Blog comments are GitHub Discussions shown by giscus, which needs a GitHub sign-in. This Worker lets
// readers without a GitHub account comment too. The post's guest form sends a name, a comment and a
// Cloudflare Turnstile token here. The Worker checks the token, then posts the comment, as a
// separate guest GitHub account, into the same discussion that giscus shows for that post, creating
// the discussion the way giscus does if it doesn't exist yet. GitHub then emails anyone watching the
// repository's discussions, as it does for any comment.
//
// Secrets (set in the Cloudflare dashboard, never in this file):
//   GITHUB_TOKEN      a classic personal access token of the guest account, with only "public_repo"
//   TURNSTILE_SECRET  the secret key of the Turnstile widget for kasimirgregory.com
// Settings: the defaults below; a Worker variable with the same name overrides one.
// Optional: a Rate Limiting binding called LIMITER, keyed by IP address, if you add one.

const DEFAULTS = {
  SITE: 'https://kasimirgregory.com',
  ALLOWED_ORIGINS: 'https://kasimirgregory.com',
  TURNSTILE_HOSTNAMES: 'kasimirgregory.com',
  REPO: 'Kasigee/kasigee.github.io',
  REPO_ID: 'R_kgDOVaV21Q',
  CATEGORY: 'Comments',
  CATEGORY_ID: 'DIC_kwDOVaV21c4DKf4F',
};
const LIMITS = { name: 60, comment: 4000, links: 3 };
const POST_PATH = /^\/blog\/[a-z0-9][a-z0-9-]*\/$/;
const GITHUB_GRAPHQL = 'https://api.github.com/graphql';
const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const USER_AGENT = 'kasimirgregory-guest-comments';

const list = (value) => String(value).split(',').map((s) => s.trim()).filter(Boolean);

export default {
  async fetch(request, env) {
    const cfg = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) if (typeof env[key] === 'string' && env[key]) cfg[key] = env[key];

    const origin = request.headers.get('Origin') || '';
    const allowed = list(cfg.ALLOWED_ORIGINS).includes(origin);
    const cors = allowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };
    const reply = (status, body) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: allowed ? 204 : 403,
        headers: { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' },
      });
    }
    if (request.method !== 'POST') return reply(405, { error: 'Use POST.' });
    if (!allowed) return reply(403, { error: 'Comments can only be posted from the blog.' });
    if (!env.GITHUB_TOKEN || !env.TURNSTILE_SECRET) return reply(503, { error: 'Guest comments are not set up yet.' });

    try {
      return await postComment(request, env, cfg, reply);
    } catch (err) {
      console.error(err);
      return reply(502, { error: 'Your comment could not be posted just now. Please try again, or email it instead.' });
    }
  },
};

async function postComment(request, env, cfg, reply) {
  let data;
  try {
    data = await request.json();
  } catch {
    return reply(400, { error: 'Bad request.' });
  }
  const { term = '', name = '', comment = '', website = '', token = '' } = data || {};

  // Honeypot: the "website" field is hidden from people, so only bots fill it. Pretend it worked.
  if (website) return reply(200, { ok: true });

  if (typeof term !== 'string' || !POST_PATH.test(term)) return reply(400, { error: 'Unknown post.' });
  const cleanName = tidy(name).replace(/\s+/g, ' ').trim();
  const cleanComment = tidy(comment).replace(/\n{3,}/g, '\n\n').trim();
  if (!cleanName || cleanName.length > LIMITS.name) {
    return reply(400, { error: `Please give a name of up to ${LIMITS.name} characters.` });
  }
  if (!cleanComment) return reply(400, { error: 'Please write a comment.' });
  if (cleanComment.length > LIMITS.comment) {
    return reply(400, { error: `Please keep your comment under ${LIMITS.comment.toLocaleString('en-AU')} characters.` });
  }
  if ((cleanComment.match(/https?:\/\/|www\./gi) || []).length > LIMITS.links) {
    return reply(400, { error: `Please include at most ${LIMITS.links} links.` });
  }

  if (env.LIMITER) {
    const { success } = await env.LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
    if (!success) return reply(429, { error: 'Too many comments from your connection. Please wait a minute.' });
  }

  if (!(await turnstileOk(token, request, env, cfg))) {
    return reply(403, { error: 'The spam check failed or expired. Please tick it again and resend.' });
  }

  // The post must exist on the site, so discussions can't be created for made-up paths.
  const page = await fetch(cfg.SITE + term, { headers: { 'User-Agent': USER_AGENT } });
  if (!page.ok) return reply(400, { error: 'Unknown post.' });
  const description = metaContent(await page.text(), 'og:description');

  const hash = await sha1(term);
  const discussion = (await findDiscussion(env, cfg, hash)) || (await createDiscussion(env, cfg, term, description, hash));
  if (discussion.locked) return reply(403, { error: 'Comments on this post are closed.' });

  const body = `**${escapeMarkdown(cleanName)}** · *guest comment, posted without a GitHub account*\n\n${noMentions(cleanComment)}`;
  const result = await graphql(env, `
    mutation($id: ID!, $body: String!) {
      addDiscussionComment(input: { discussionId: $id, body: $body }) { comment { url } }
    }`, { id: discussion.id, body });
  return reply(200, { ok: true, url: result.addDiscussionComment.comment.url });
}

// giscus (strict mode) marks each post's discussion with an HTML comment holding the SHA-1 of the
// post's path, and finds it by searching for that hash. Look through the category's recent
// discussions first, because GitHub's search index can lag behind a newly created discussion.
async function findDiscussion(env, cfg, hash) {
  const tag = `<!-- sha1: ${hash} -->`;
  const [owner, name] = cfg.REPO.split('/');
  const recent = await graphql(env, `
    query($owner: String!, $name: String!, $category: ID!) {
      repository(owner: $owner, name: $name) {
        discussions(first: 100, categoryId: $category, orderBy: { field: CREATED_AT, direction: DESC }) {
          nodes { id url locked body }
        }
      }
    }`, { owner, name, category: cfg.CATEGORY_ID });
  const found = recent.repository.discussions.nodes.find((d) => d.body.includes(tag));
  if (found) return found;

  const query = `repo:${cfg.REPO.toLowerCase()} category:${JSON.stringify(cfg.CATEGORY)} in:body ${JSON.stringify(hash)}`;
  const search = await graphql(env, `
    query($query: String!) {
      search(type: DISCUSSION, first: 5, query: $query) {
        nodes { ... on Discussion { id url locked body } }
      }
    }`, { query });
  return search.search.nodes.find((d) => d.body?.includes(tag)) || null;
}

// Same title and body as giscus uses, so giscus shows the thread for the post.
async function createDiscussion(env, cfg, term, description, hash) {
  const body = `# ${term}\n\n${description}\n\n${cfg.SITE}${term}\n\n<!-- sha1: ${hash} -->`;
  const result = await graphql(env, `
    mutation($input: CreateDiscussionInput!) {
      createDiscussion(input: $input) { discussion { id url locked } }
    }`, { input: { repositoryId: cfg.REPO_ID, categoryId: cfg.CATEGORY_ID, title: term, body } });
  return result.createDiscussion.discussion;
}

async function graphql(env, query, variables) {
  const res = await fetch(GITHUB_GRAPHQL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ query, variables }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.errors) {
    throw new Error(`GitHub ${res.status}: ${(out.errors || []).map((e) => e.message).join('; ') || out.message || 'no details'}`);
  }
  return out.data;
}

async function turnstileOk(token, request, env, cfg) {
  if (!token || typeof token !== 'string') return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) form.append('remoteip', ip);
  const res = await fetch(TURNSTILE_VERIFY, { method: 'POST', body: form });
  const out = await res.json().catch(() => ({}));
  return out.success === true && list(cfg.TURNSTILE_HOSTNAMES).includes(out.hostname);
}

async function sha1(text) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Drop control and direction-override characters; keep newlines and tabs.
function tidy(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁠-⁩﻿]/g, '');
}

// Stop "@someone" in a guest comment from notifying that GitHub user (a zero-width space after the @).
function noMentions(text) {
  return text.replace(/(^|[^A-Za-z0-9_.+-])@(?=[A-Za-z0-9])/g, '$1@​');
}

function escapeMarkdown(text) {
  return noMentions(text.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, '\\$&'));
}

function metaContent(html, property) {
  for (const tag of html.match(/<meta\s[^>]*>/gi) || []) {
    const attr = (n) => tag.match(new RegExp(`\\s${n}\\s*=\\s*"([^"]*)"`, 'i'))?.[1];
    if (attr('property') === property || attr('name') === property) {
      return (attr('content') || '')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    }
  }
  return '';
}
