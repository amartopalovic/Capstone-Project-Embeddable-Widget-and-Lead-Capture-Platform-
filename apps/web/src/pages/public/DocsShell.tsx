import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { PublicShell } from '../../components/PublicShell.jsx';

/**
 * The shell for documentation and policy pages.
 *
 * A persistent list beside the content rather than a collapsible tree. There
 * are nine pages in total, which fits on a screen; a tree would add a widget to
 * operate and a state to get wrong for a set small enough to read at a glance.
 *
 * On narrow screens the list moves above the content instead of into a drawer.
 * A drawer is a control somebody has to discover, and it hides a table of
 * contents behind a tap on the one page type where a reader most wants to see
 * the whole shape at once.
 */

export interface DocsSection {
  readonly heading: string;
  readonly items: readonly { readonly to: string; readonly label: string }[];
}

export const DOC_SECTIONS: readonly DocsSection[] = [
  {
    heading: 'Getting started',
    items: [
      { to: '/docs/install', label: 'Install a widget' },
      { to: '/docs/domains', label: 'Domains and targeting' },
      { to: '/docs/consent', label: 'Consent and unsubscribe' },
    ],
  },
  {
    heading: 'Integrating',
    items: [
      { to: '/docs/webhooks', label: 'Webhooks' },
      { to: '/docs/api', label: 'API reference' },
    ],
  },
  {
    heading: 'When something is wrong',
    items: [{ to: '/docs/troubleshooting', label: 'Troubleshooting' }],
  },
];

export const POLICY_SECTIONS: readonly DocsSection[] = [
  {
    heading: 'Policies',
    items: [
      { to: '/policies/privacy', label: 'Privacy' },
      { to: '/policies/terms', label: 'Terms' },
      { to: '/policies/storage', label: 'Storage and cookies' },
      { to: '/policies/acceptable-use', label: 'Acceptable use' },
    ],
  },
];

export function DocsShell({
  sections,
  navLabel,
  title,
  intro,
  children,
}: {
  readonly sections: readonly DocsSection[];
  readonly navLabel: string;
  readonly title: string;
  readonly intro: string;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <PublicShell>
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 lg:grid-cols-[16rem_1fr] lg:gap-14">
        <nav aria-label={navLabel} className="lg:sticky lg:top-10 lg:self-start">
          <div className="space-y-6 border-b border-edge pb-6 lg:border-0 lg:pb-0">
            {sections.map((section) => (
              <div key={section.heading}>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                  {section.heading}
                </p>
                <ul className="mt-3 space-y-1.5">
                  {section.items.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        className={({ isActive }) =>
                          `-ml-3 block border-l-2 py-1 pl-3 text-sm ${
                            isActive
                              ? 'border-signal font-medium text-ink'
                              : 'border-transparent text-muted hover:text-ink'
                          }`
                        }
                      >
                        {item.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        {/*
         * The measure is capped well below the column width. Documentation is
         * read in long passes, and a 120-character line is where a reader
         * starts losing their place returning to the left edge.
         */}
        <article className="min-w-0 max-w-[68ch]">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">{title}</h1>
          <p className="mt-3 text-lg leading-relaxed text-muted">{intro}</p>
          <div className="mt-10 space-y-6">{children}</div>
        </article>
      </div>
    </PublicShell>
  );
}

/** A section heading with the mono eyebrow the rest of the product uses. */
export function DocSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): React.JSX.Element {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return (
    <section aria-labelledby={id} className="scroll-mt-10 border-t border-edge pt-8">
      <h2 id={id} className="text-xl font-semibold tracking-tight text-ink">
        {title}
      </h2>
      <div className="mt-4 space-y-4 leading-relaxed text-muted">{children}</div>
    </section>
  );
}

/** A short aside that matters more than the surrounding prose. */
export function Note({
  tone = 'neutral',
  children,
}: {
  readonly tone?: 'neutral' | 'warning';
  readonly children: ReactNode;
}): React.JSX.Element {
  const styles =
    tone === 'warning'
      ? 'border-danger/40 bg-danger-soft text-ink'
      : 'border-edge bg-panel text-muted';
  return <div className={`border-l-2 px-4 py-3 text-sm leading-relaxed ${styles}`}>{children}</div>;
}

/** A definition list, for the settings pages where that is the real shape. */
export function Settings({
  rows,
}: {
  readonly rows: readonly { readonly term: string; readonly description: ReactNode }[];
}): React.JSX.Element {
  return (
    <dl className="border border-edge bg-panel">
      {rows.map((row) => (
        <div
          key={row.term}
          className="grid gap-1 border-b border-edge p-4 last:border-b-0 sm:grid-cols-[12rem_1fr] sm:gap-4"
        >
          <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            {row.term}
          </dt>
          <dd className="text-sm leading-relaxed text-ink">{row.description}</dd>
        </div>
      ))}
    </dl>
  );
}
