/**
 * FIRST, before anything that builds a Zod schema is imported. See the module
 * itself for why the order is load-bearing.
 */
import './lib/zod-config.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { captureReactError, initObservability } from './lib/observability.js';
import './index.css';

/**
 * Error monitoring first, before React mounts (blueprint 16.3).
 *
 * A crash during the first render is the one most worth having a report of,
 * and it is the one that is missed if the SDK starts after mounting.
 */
initObservability();

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root container #root was not found in index.html');
}

/**
 * React 19's own error hooks, rather than only a boundary.
 *
 * `onUncaughtError` and `onRecoverableError` fire for failures no boundary
 * catches - including hydration mismatches - which are exactly the ones that
 * otherwise leave a blank page and no evidence.
 */
createRoot(container, {
  onUncaughtError: captureReactError,
  onCaughtError: captureReactError,
  onRecoverableError: captureReactError,
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
