# Guest comments

Blog comments on kasimirgregory.com are GitHub Discussions, shown by [giscus](https://giscus.app),
which needs a GitHub sign-in. This Cloudflare Worker lets readers without a GitHub account comment
too:

1. The post's "No GitHub account? Comment as a guest" form (in `js/blog.js`) sends a name, a comment
   and a [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) token to the Worker.
2. The Worker checks the token with Cloudflare, checks the post exists, and posts the comment, through
   a separate guest GitHub account, into the same discussion giscus shows for that post. If the post
   has no discussion yet, it creates one exactly as giscus would.
3. GitHub emails everyone watching the repository's discussions, as for any comment.

Guest comments appear immediately, headed with the name the reader gave. Delete or hide them on
GitHub like any other comment.

## Setting it up

You need a second GitHub account for the guest comments and a free Cloudflare account. Nothing secret
goes in this repository: the two keys live only in the Worker's settings.

### 1. The guest GitHub account

1. In a private browser window, create a GitHub account for the comments, for example
   `kasimirgregory-guest`, and verify its email address. GitHub allows one such machine account per
   person. Giving it a profile name like "Guest comments (kasimirgregory.com)" makes it obvious what
   it is.
2. Signed in as that account, go to **Settings → Developer settings → Personal access tokens →
   Tokens (classic) → Generate new token (classic)**. Tick only **public_repo**, set an expiry (a year
   is sensible; put a reminder in your calendar), and copy the token.

   It has to be a classic token: a fine-grained token can't write to a repository owned by another
   account. The account itself has no special access to anything, so the token can only do what any
   GitHub user can do in public.

### 2. Turnstile (the spam check)

In the Cloudflare dashboard, open **Turnstile → Add widget**. Name it, add the hostname
`kasimirgregory.com`, keep the **Managed** mode, and create it. Copy the **site key** (public) and
the **secret key**.

### 3. The Worker

1. In **Workers & Pages**, create a Worker from the "Hello World" starter, name it `guest-comments`
   and deploy it.
2. Choose **Edit code**, replace everything with the contents of `worker.js`, and deploy.
3. In the Worker's **Settings → Variables and Secrets**, add two variables of type **Secret**:
   - `GITHUB_TOKEN`: the guest account's token from step 1;
   - `TURNSTILE_SECRET`: the Turnstile secret key from step 2.
4. Copy the Worker's address, which looks like `https://guest-comments.<your-subdomain>.workers.dev`.

(With the command line instead: `npx wrangler deploy` in this folder, then
`npx wrangler secret put GITHUB_TOKEN` and `npx wrangler secret put TURNSTILE_SECRET`.)

### 4. Switch the form on

Put the Worker's address and the Turnstile **site key** in `GUEST_COMMENTS` in `js/site-config.js`.
Both are public. The form appears on every post once both are set.

## Settings

The repository, discussion category, site address and allowed hostnames are at the top of
`worker.js`. A Worker variable with the same name (for example `CATEGORY_ID`) overrides one, if the
comments ever move to another category.

Limits: names up to 60 characters, comments up to 4,000 characters with at most 3 links. "@name"
mentions in guest comments don't notify GitHub users. A hidden field catches simple bots before
Turnstile does. For a per-connection limit as well, add a Rate Limiting binding called `LIMITER`
to the Worker; the code uses it if it's there.

## Switching it off

Empty `endpoint` in `js/site-config.js` to hide the form, or delete the Worker's `GITHUB_TOKEN`
secret to stop it posting. If the token ever leaks, revoke it in the guest account's settings.
