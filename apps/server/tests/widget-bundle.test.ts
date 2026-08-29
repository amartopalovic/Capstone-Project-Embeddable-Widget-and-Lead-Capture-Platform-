import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { loadRuntimeAsset, loaderSource } from '../src/http/routes/public-widget.js';

/**
 * Bundle-size budgets for the public widget assets (blueprint 8.3).
 *
 * The blueprint is deliberate about how these should exist: "The staged build
 * should establish measurable budgets rather than promise an arbitrary number
 * before bundling." So these numbers were MEASURED first and the ceilings set
 * around them with headroom, rather than picked and then built down to.
 *
 * At the time they were set:
 *
 *   runtime  13,613 B raw   5,439 B gzip
 *   loader      734 B raw      434 B gzip
 *
 * This lives in the unit suite rather than only in CI on purpose. `npm test`
 * already builds the packages first, so a change that doubles the bundle fails
 * on the machine that made it instead of twenty minutes later.
 */

/** Ceilings, not targets. Roughly 50% headroom over what was measured. */
const RUNTIME_RAW_BUDGET = 20_480;
const RUNTIME_GZIP_BUDGET = 8_192;
const LOADER_RAW_BUDGET = 2_048;
const LOADER_GZIP_BUDGET = 1_024;

function sizes(source: string | Buffer): { raw: number; gzip: number } {
  const buffer = typeof source === 'string' ? Buffer.from(source, 'utf8') : source;
  return { raw: buffer.length, gzip: gzipSync(buffer).length };
}

describe('public widget bundle budgets (blueprint 8.3)', () => {
  it('keeps the runtime within its measured budget', () => {
    const asset = loadRuntimeAsset();
    expect(asset, 'the runtime must be built; run `npm run build:packages`').not.toBeNull();
    if (asset === null) return;

    const { raw, gzip } = sizes(asset.source);
    // Reported either way, so a passing run still records the real numbers.
    console.log(`widget runtime: ${String(raw)} B raw, ${String(gzip)} B gzip`);

    expect(raw).toBeLessThanOrEqual(RUNTIME_RAW_BUDGET);
    expect(gzip).toBeLessThanOrEqual(RUNTIME_GZIP_BUDGET);
  });

  it('keeps the loader small, since every page pays for it on a 5-minute cache', () => {
    const source = loaderSource(
      'https://app.example.com/widget/v1/runtime.abc123.js',
      'https://app.example.com',
    );
    const { raw, gzip } = sizes(source);
    console.log(`widget loader: ${String(raw)} B raw, ${String(gzip)} B gzip`);

    expect(raw).toBeLessThanOrEqual(LOADER_RAW_BUDGET);
    expect(gzip).toBeLessThanOrEqual(LOADER_GZIP_BUDGET);
  });

  it('ships no dashboard framework or validation library (blueprint 8.3)', () => {
    const asset = loadRuntimeAsset();
    if (asset === null) return;

    /**
     * The rule blueprint 8.3 states as "no dashboard framework enters the
     * widget bundle", checked directly rather than inferred from the size.
     *
     * Zod is included because the shared contracts package depends on it, and
     * importing the wrong entry point - the barrel instead of `/rules` - would
     * pull the whole validation library into a bundle that ships to customer
     * websites.
     */
    for (const forbidden of ['react', 'React', 'ZodType', 'zod']) {
      expect(asset.source, `${forbidden} must not appear in the widget bundle`).not.toContain(
        forbidden,
      );
    }
  });

  it('gives the runtime a content hash, which is what makes a 1-year cache safe', () => {
    const asset = loadRuntimeAsset();
    if (asset === null) return;
    expect(asset.hash).toMatch(/^[0-9a-f]{16}$/);
  });
});
