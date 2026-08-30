import { loadEnv } from './config/env.js';
import { initSentry } from './infrastructure/observability/sentry.js';
import { nullErrorReporter, type ErrorReporter } from './ports/error-reporter.js';

/**
 * Error monitoring, started before anything else (blueprint 16.3).
 *
 * A separate module, imported FIRST by `index.ts`, because Sentry's automatic
 * instrumentation works by patching modules and can only patch what has not
 * been loaded yet. An ES module's dependencies are evaluated in the order their
 * import declarations appear, so `import './instrument.js'` at the top of
 * `index.ts` genuinely runs before `express` is evaluated. A bundler would be
 * free to reorder that; nothing here is bundled, and if that ever changes the
 * supported alternative is `node --import ./dist/instrument.js`.
 *
 * `loadEnv()` runs a second time here rather than being threaded in, because
 * there is nothing to thread it from yet - this module is deliberately the
 * first thing that exists. It is a pure read of `process.env`.
 */

const env = loadEnv();

export const errorReporter: ErrorReporter =
  env.sentryDsn === ''
    ? nullErrorReporter
    : initSentry({
        dsn: env.sentryDsn,
        environment: env.nodeEnv,
        release: env.release,
        tracesSampleRate: env.sentryTracesSampleRate,
      });

export const errorMonitoringEnabled = env.sentryDsn !== '';
