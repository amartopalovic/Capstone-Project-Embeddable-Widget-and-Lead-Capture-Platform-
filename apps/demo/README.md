# @lcp/demo

The public sandbox (blueprint 14.3), and the widget isolation fixture.

Runs on port **5174**, a genuinely different origin from `@lcp/web` on 5173. That separation is
load-bearing twice over: it is what lets the cross-origin loader, config, and submission paths be
tested locally from Stage 6 onward instead of only after deployment, and it is what blueprint 14.3
asks of the sandbox itself — "hosted on a different provider subdomain from the API so it proves
the capstone's cross-origin behavior".

No framework and no shared package with the platform, on purpose. If the widget runtime works here,
it works on anybody's website.

## Two pages

| Path            | What it is                                                        |
| --------------- | ----------------------------------------------------------------- |
| `/`             | The public sandbox a visitor uses.                                |
| `/fixture.html` | A deliberately hostile host page, for the widget isolation tests. |

They are separate because they want opposite things. The fixture resets `box-sizing` globally, puts
`!important` on every input, and defines a `.panel` class that collides with the widget's own
internals — a worst case the Stage 6 tests assert the widget survives. A sandbox somebody is meant
to enjoy using cannot be that page.

Both accept `?api=` to point at a platform on another port, which is how the browser tests reach
whichever server they started. The fixture additionally takes `?w=` with one or more public widget
ids; the sandbox discovers its own from the API.

## What the sandbox is

Three seeded widgets — a contact form, an email signup, and a CTA popover — installed exactly the
way a customer installs one: a single script tag fetched across an origin boundary. A submission
travels the real pipeline. It is validated against the published revision's field schema,
deduplicated by idempotency key, stored, and counted in analytics.

Then it stops:

- **Nothing is sent.** Email and outbound webhooks are refused for this tenant, both where
  deliveries are planned and again where one is attempted.
- **Everything is wiped hourly.** A scheduled job clears the tenant and reseeds it. There is no
  route that triggers it — a route that wipes a tenant is a route that wipes a tenant.
- **Its limits are stricter than production's.** Three per-visitor and per-widget rate rules and an
  8 KB body cap, applied on top of the production limits rather than instead of them.

The sandbox is one ordinary workspace with an `isDemo` marker, owned by nobody. It gets no
exemption in the tenancy layer and has no membership rows, so there is no account for which it is
listed and no dashboard route by which its contents could be read. What the demo demonstrates about
isolation is what the product actually does.

## The feed

The page shows recent sandbox activity: which example widget, whether it was a view or a
submission, when, and how many fields a submission carried. Deliberately **not** the values
somebody typed. This is a public page with no moderation, and a feed that echoed submissions would
republish whatever the last visitor chose to write to every subsequent one.

## Running it

`docker compose up --build` brings up everything, or run the platform and this app separately:

```
node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 5174   # from apps/demo
```

The sandbox seeds itself when the platform starts with workers enabled, and reseeds every hour. If
the page says it is still being prepared, the platform is not running or has not seeded yet.
