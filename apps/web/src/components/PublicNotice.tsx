import type { ReactNode } from 'react';

/**
 * The layout for the pages a stranger sees (blueprint 4.8).
 *
 * Everything else in this product is an operator's console: a shell, a nav,
 * dense panels, tables. Nobody who reaches these pages has an account, and most
 * will never see another page here. They followed a link out of an email,
 * frequently on a phone and frequently annoyed, and they want one thing - to
 * know it is done and to be finished.
 *
 * So the page is a STATEMENT, not a form in a card. One sentence set large in
 * the display face, a mono eyebrow naming what it is about, and a quiet line
 * underneath. Left-aligned rather than centred: centred text in a box reads as
 * a dialog somebody has to dismiss, and this is a statement of record.
 *
 * The mount bracket - the same corner ticks that frame the sign-in panel - is
 * reused here as the one piece of chrome, and its colour carries the outcome.
 * The colour is never the only carrier: the sentence says what happened, and
 * the bracket agrees with it.
 */

export type NoticeTone = 'settled' | 'affirmed' | 'neutral' | 'refused';

const BRACKET: Readonly<Record<NoticeTone, string>> = {
  settled: 'border-secure/60',
  affirmed: 'border-signal/60',
  neutral: 'border-edge',
  refused: 'border-muted/50',
};

function Bracket({ tone }: { readonly tone: NoticeTone }): React.JSX.Element {
  const tick = `absolute h-4 w-4 ${BRACKET[tone]}`;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute -inset-4">
      <span className={`${tick} left-0 top-0 border-l border-t`} />
      <span className={`${tick} right-0 top-0 border-r border-t`} />
      <span className={`${tick} bottom-0 left-0 border-b border-l`} />
      <span className={`${tick} bottom-0 right-0 border-b border-r`} />
    </div>
  );
}

export interface PublicNoticeProps {
  /** Mono, uppercase, tracked. Names the subject, not the outcome. */
  readonly eyebrow: string;
  /** The statement. One sentence, in plain words. */
  readonly heading: string;
  readonly tone?: NoticeTone;
  readonly children?: ReactNode;
  /** Small print under a rule: what to do next, if there is anything. */
  readonly footer?: ReactNode;
  readonly wide?: boolean;
}

export function PublicNotice({
  eyebrow,
  heading,
  tone = 'neutral',
  children,
  footer,
  wide = false,
}: PublicNoticeProps): React.JSX.Element {
  return (
    <main className="flex min-h-dvh flex-col justify-center px-6 py-16 sm:px-10">
      <div className={`mx-auto w-full ${wide ? 'max-w-3xl' : 'max-w-lg'}`}>
        <div className="relative">
          <Bracket tone={tone} />
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">{eyebrow}</p>
          {/*
           * `text-balance` keeps a two-line statement from leaving one word
           * stranded, which matters more here than anywhere else in the app:
           * this sentence is the entire page.
           */}
          <h1 className="mt-3 text-pretty text-3xl font-semibold leading-[1.15] tracking-tight text-ink sm:text-4xl">
            {heading}
          </h1>
        </div>

        {children !== undefined && <div className="mt-8">{children}</div>}

        {footer !== undefined && (
          <div className="mt-12 border-t border-edge pt-5 text-sm text-muted">{footer}</div>
        )}
      </div>
    </main>
  );
}

/**
 * A line of body copy under the statement.
 *
 * Its own component so the measure and colour are set once. Long lines of muted
 * text at this size are the fastest way to make a plain page feel unfinished.
 */
export function NoticeBody({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return <p className="max-w-prose text-base leading-relaxed text-muted">{children}</p>;
}
