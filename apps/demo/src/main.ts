/**
 * The separate-origin demo sandbox.
 *
 * This page exists so cross-origin widget behaviour is testable locally rather
 * than only after deployment: it runs on its own port, which makes it a
 * genuinely different origin from the dashboard, so the Origin allowlist, CORS,
 * and Shadow DOM isolation are all exercised for real.
 *
 * Which widgets to install is taken from the query string rather than hard-coded
 * or seeded, because a public widget id only exists once something has been
 * published through the dashboard. A browser test creates and publishes one,
 * then sends this page its identifier:
 *
 *   /?w=w_abc123...            install one widget
 *   /?w=w_abc...,w_def...      install several, sharing one runtime load
 *   /?api=http://localhost:3000  where the loader and config come from
 *
 * The seeded showcase, hourly reset, and synthetic-data labelling described in
 * blueprint 4.11 are Stage 12's job. This is the test fixture that proves the
 * runtime works on somebody else's page.
 */

const params = new URLSearchParams(window.location.search);
const apiBase = (params.get('api') ?? 'http://localhost:3000').replace(/\/+$/, '');
const publicIds = (params.get('w') ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value !== '');

const note = document.getElementById('origin-note');
if (note !== null) {
  note.textContent =
    publicIds.length === 0
      ? `Serving origin ${window.location.origin}. No widgets requested - add ?w=<publicId>.`
      : `Serving origin ${window.location.origin}. Installing ${String(publicIds.length)} widget(s) from ${apiBase}.`;
}

const mount = document.getElementById('widgets');

for (const publicId of publicIds) {
  /**
   * A click-trigger element, using the one contract the runtime defines for
   * host pages: `data-lcp-widget-open="<publicId>"`.
   */
  const opener = document.createElement('button');
  opener.type = 'button';
  opener.textContent = `Open ${publicId}`;
  opener.setAttribute('data-lcp-widget-open', publicId);
  opener.setAttribute('data-testid', `open-${publicId}`);
  mount?.append(opener);

  /**
   * The real snippet, exactly as blueprint 7.2 describes it and exactly as the
   * dashboard prints it for a customer to paste. Several of these on one page
   * is the multi-instance case: the loader guards itself so the runtime is
   * fetched once no matter how many tags there are.
   */
  const script = document.createElement('script');
  script.async = true;
  script.src = `${apiBase}/widget/v1/loader.js`;
  script.setAttribute('data-widget', publicId);
  mount?.append(script);
}
