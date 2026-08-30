import { useState } from 'react';

/**
 * A copyable code sample.
 *
 * Documentation code exists to be pasted, so the copy control is part of the
 * sample rather than a nicety. Three things it gets right that a naive version
 * does not:
 *
 * **The result is announced.** A button whose label silently changes to
 * "Copied" tells a sighted person and nobody else. The status lives in a polite
 * live region, so a screen reader hears it too.
 *
 * **Failure is stated, not swallowed.** `navigator.clipboard` is unavailable
 * over plain HTTP on some browsers and can be refused by permissions policy.
 * Pretending it worked would be worse than saying it did not, because the
 * person would paste the wrong thing.
 *
 * **The code is selectable either way.** It is a real `pre`, so the fallback is
 * the one every reader already knows.
 */
export function CodeBlock({
  code,
  language,
  caption,
}: {
  readonly code: string;
  /** Shown as the sample's label. Not syntax highlighting - see below. */
  readonly language: string;
  readonly caption?: string;
}): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return (
    <figure className="my-6">
      <div className="border border-edge bg-panel">
        <div className="flex items-center justify-between gap-4 border-b border-edge px-4 py-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
            {language}
          </span>
          <button
            type="button"
            onClick={() => void copy()}
            className="border border-edge px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink hover:bg-paper"
          >
            Copy
          </button>
        </div>
        {/*
         * No syntax highlighting, deliberately. It would mean a highlighter
         * dependency and a colour scheme to keep at AA against this palette,
         * to decorate samples that are at most a dozen lines. The samples are
         * short enough to read as text, which is what they are.
         *
         * `tabIndex` is not optional here. A block that scrolls horizontally is
         * a scrollable region, and a region a mouse can scroll but a keyboard
         * cannot is a WCAG 2.1.1 failure - the content past the right edge is
         * simply unreachable. Making it focusable is what lets arrow keys move
         * it, and the label is what stops it being announced as an unexplained
         * stop on the way down the page.
         */}
        <pre
          tabIndex={0}
          aria-label={`${language} code sample`}
          className="overflow-x-auto px-4 py-4 text-[13px] leading-relaxed text-ink"
        >
          <code>{code}</code>
        </pre>
      </div>

      <p role="status" className="mt-1 h-4 font-mono text-[11px] text-muted">
        {state === 'copied' && 'Copied to the clipboard.'}
        {state === 'failed' && 'Could not copy. Select the text and copy it manually.'}
      </p>

      {caption !== undefined && <figcaption className="text-sm text-muted">{caption}</figcaption>}
    </figure>
  );
}
