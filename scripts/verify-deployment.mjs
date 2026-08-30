import { randomUUID } from 'node:crypto';

function requiredUrl(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') throw new Error(`${name} is required`);
  const url = new URL(raw);
  return url.href.replace(/\/$/, '');
}

async function expectResponse(label, url, options, expectedStatus = 200) {
  const started = performance.now();
  const response = await fetch(url, options);
  const elapsed = Math.round(performance.now() - started);
  if (response.status !== expectedStatus) {
    throw new Error(
      `${label}: expected ${String(expectedStatus)}, received ${String(response.status)}`,
    );
  }
  console.log(`[deploy-check] PASS ${label} (${String(elapsed)} ms)`);
  return response;
}

const app = requiredUrl('PRODUCTION_URL');
const demo = requiredUrl('DEMO_URL');

const readinessResponse = await expectResponse('readiness', `${app}/health/ready`);
const readiness = await readinessResponse.json();
const requiredDependencies = ['mongodb', 'redis', 'migrations'];
if (
  readiness.status !== 'ready' ||
  requiredDependencies.some(
    (name) => readiness.dependencies?.find((probe) => probe.name === name)?.status !== 'up',
  )
) {
  throw new Error('readiness body does not report MongoDB, Redis, and migrations as ready');
}

const reactResponse = await expectResponse('React application', `${app}/`);
if (!(await reactResponse.text()).includes('<div id="root"></div>')) {
  throw new Error('platform root did not return the built React document');
}

const docsResponse = await expectResponse('API reference', `${app}/api-reference`);
if (!(await docsResponse.text()).includes('swagger-ui')) {
  throw new Error('API reference did not return Swagger UI');
}

const demoResponse = await expectResponse('separate demo origin', `${demo}/`);
const demoHtml = await demoResponse.text();
if (!demoHtml.includes('Three widgets on a bench.') || demoHtml.includes('localhost:')) {
  throw new Error('demo did not return the production sandbox document');
}

const demoConfigResponse = await expectResponse(
  'demo configuration CORS',
  `${app}/demo/v1/config`,
  { headers: { Origin: demo } },
);
const demoConfig = await demoConfigResponse.json();
if (demoConfigResponse.headers.get('access-control-allow-origin') !== demo) {
  throw new Error('demo config did not echo the separate demo origin');
}
const widget = demoConfig.widgets?.find((candidate) => candidate.type === 'contact_form');
if (widget?.publicId === undefined) throw new Error('demo config has no contact-form widget');

const widgetResponse = await expectResponse(
  'cross-origin widget configuration',
  `${app}/widget/v1/config/${encodeURIComponent(widget.publicId)}`,
  { headers: { Origin: demo } },
);
if (widgetResponse.headers.get('access-control-allow-origin') !== demo) {
  throw new Error('widget config did not echo the separate demo origin');
}

await expectResponse(
  'cross-origin sandbox submission',
  `${app}/widget/v1/submit/${encodeURIComponent(widget.publicId)}`,
  {
    method: 'POST',
    headers: { Origin: demo, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: `stage14-${randomUUID()}`,
      values: { email: 'stage14-sandbox@example.invalid', message: 'Stage 14 deployment check' },
      pageUrl: `${demo}/`,
      renderedAt: Date.now() - 30_000,
    }),
  },
  202,
);

console.log(
  '[deploy-check] Public smoke and separate-origin checks passed. Auth, real delivery queue, cold-start, and restore checks are recorded separately because they require operator credentials or elapsed idle time.',
);
