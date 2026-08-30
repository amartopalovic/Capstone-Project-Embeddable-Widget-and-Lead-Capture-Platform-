// Run: node --import tsx scripts/probe-privacy-leaks.mjs
import { createLogger } from '../packages/contracts/src/logging.ts';
import { scrubEvent as serverScrub } from '../apps/server/src/infrastructure/observability/sentry.ts';
import { scrubEvent as browserScrub } from '../apps/web/src/lib/observability.ts';

const sentinel = 'AUDIT_PRIVATE_SENTINEL';
const records = [];
const logger = createLogger({
  bindings: { service: 'audit', environment: 'production', release: 'audit' },
  sink: (record) => records.push(record),
});
logger.error('audit.failure', {
  email: `${sentinel}@example.invalid`,
  values: { message: sentinel },
  reason: `driver failed: ${sentinel}`,
  error: sentinel,
});
const sample = {
  message: sentinel,
  exception: {
    values: [
      {
        type: 'MongoServerError',
        value: sentinel,
        stacktrace: {
          frames: [{ filename: '/srv/app.js', vars: { lead: sentinel }, context_line: sentinel }],
        },
      },
    ],
  },
  request: {
    url: `/contacts?search=${sentinel}#${sentinel}`,
    query_string: `email=${sentinel}`,
    env: { REMOTE_ADDR: sentinel },
  },
  user: { id: 'synthetic-user', email: sentinel, name: sentinel },
  extra: { lead: sentinel },
  contexts: { arbitrary: { message: sentinel } },
  breadcrumbs: [
    {
      message: sentinel,
      data: {
        from: `/login?token=${sentinel}`,
        to: `/contacts?search=${sentinel}`,
        values: { name: sentinel },
      },
    },
  ],
};
console.log(
  JSON.stringify(
    {
      loggerLeaksSyntheticPrivateValue: JSON.stringify(records).includes(sentinel),
      serverSentryLeaksSyntheticPrivateValue: JSON.stringify(serverScrub(sample)).includes(
        sentinel,
      ),
      browserSentryLeaksSyntheticPrivateValue: JSON.stringify(browserScrub(sample)).includes(
        sentinel,
      ),
    },
    null,
    2,
  ),
);
