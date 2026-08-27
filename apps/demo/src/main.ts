/**
 * Stage 1 placeholder for the anonymous demo sandbox.
 *
 * It exists to prove the second origin genuinely runs and builds. Seeded
 * examples of all three widget types, the hourly reset, the safe public feed,
 * and the synthetic-data labelling arrive in Stage 12.
 */

const app = document.getElementById('app');

if (app !== null) {
  const heading = document.createElement('h1');
  heading.textContent = 'Lead Capture demo sandbox';

  const status = document.createElement('p');
  status.textContent =
    'Stage 1 skeleton. This is a separate origin from the platform application, which is what makes the cross-origin widget behaviour testable. No widgets are installed yet.';

  const origin = document.createElement('p');
  origin.textContent = `Serving origin: ${window.location.origin}`;

  app.append(heading, status, origin);
}
