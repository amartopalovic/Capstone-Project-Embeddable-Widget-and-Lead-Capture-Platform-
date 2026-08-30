import { z } from 'zod';

/**
 * Turn off Zod's JIT validator compilation in the browser (blueprint 17).
 *
 * Zod compiles a fast validator with `new Function`, which this application's
 * Content Security Policy refuses because it carries no `'unsafe-eval'`. Zod
 * catches the failure and falls back, so nothing ever broke - but the browser
 * reported a policy violation on every page load, and a console full of benign
 * violations is exactly how a real one goes unnoticed. Found by a browser test
 * asserting there are none.
 *
 * Its own module, imported FIRST by `main.tsx`, for the same reason
 * `instrument.ts` is first on the server: Zod decides whether eval is available
 * the first time a schema is BUILT, and `@lcp/contracts` builds every schema in
 * the product at module scope. A `z.config` call in the body of `main.tsx` runs
 * after those imports have already been evaluated, and is too late - which is
 * what the first attempt at this did.
 *
 * Set here and NOT in `@lcp/contracts`, because the same schemas run on the
 * server on the submission hot path, where the compiled validator is a genuine
 * win and there is no Content Security Policy to satisfy. The setting belongs
 * to the environment, not to the schemas.
 */
z.config({ jitless: true });
