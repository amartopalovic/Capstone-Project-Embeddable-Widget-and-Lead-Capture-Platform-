# @lcp/demo

Separate-origin anonymous sandbox.

**Status:** Stage 1 skeleton. It boots and builds with a placeholder page. Seeded widgets, the
hourly reset, and the safe public feed arrive in Stage 12.

Runs on port **5174**, a genuinely different origin from `@lcp/web` on 5173. This separation is
deliberate and load-bearing: it is what lets the cross-origin loader, config, and submission paths
be tested locally from Stage 6 onward instead of only after deployment.
