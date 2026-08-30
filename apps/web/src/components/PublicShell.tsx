import { useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';

/**
 * Chrome for the public site (blueprint 14.2).
 *
 * Every page under it is reachable without an account, and the visitor is far
 * more likely to be an evaluator than a customer. That changes what the header
 * is for: not a conversion funnel, but a way to get to the evidence quickly -
 * the docs, the API reference, and the source.
 */

const NAV: readonly { readonly to: string; readonly label: string }[] = [
  { to: '/docs/install', label: 'Docs' },
  { to: '/docs/api', label: 'API' },
  { to: '/policies/privacy', label: 'Policies' },
];

export function PublicHeader(): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <header className="border-b border-edge bg-panel">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
        <Link
          to="/"
          className="font-mono text-[13px] font-semibold uppercase tracking-[0.16em] text-ink"
        >
          Lead<span className="text-signal">Capture</span>
        </Link>

        {/*
         * A disclosure rather than a hamburger icon, because it is a real
         * button with a real label. On desktop the list is always visible and
         * this control is hidden, so nobody tabs through a toggle that does
         * nothing.
         */}
        <button
          type="button"
          aria-expanded={open}
          aria-controls="public-nav"
          onClick={() => setOpen((value) => !value)}
          className="ml-auto border border-edge px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink sm:hidden"
        >
          {open ? 'Close' : 'Menu'}
        </button>

        <nav
          id="public-nav"
          aria-label="Site"
          className={`${open ? 'flex' : 'hidden'} w-full flex-col gap-3 sm:ml-auto sm:flex sm:w-auto sm:flex-row sm:items-center sm:gap-7`}
        >
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `text-sm ${isActive ? 'text-ink underline decoration-signal decoration-2 underline-offset-8' : 'text-muted hover:text-ink'}`
              }
            >
              {item.label}
            </NavLink>
          ))}
          <span aria-hidden="true" className="hidden h-4 w-px bg-edge sm:block" />
          <Link to="/login" className="text-sm text-muted hover:text-ink">
            Sign in
          </Link>
          <Link
            to="/register"
            className="border border-signal bg-signal px-3 py-1.5 text-center text-sm font-medium text-white hover:bg-signal-hover"
          >
            Create an account
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter(): React.JSX.Element {
  return (
    <footer className="border-t border-edge bg-panel">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-10 sm:grid-cols-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
            Documentation
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {[
              ['/docs/install', 'Install a widget'],
              ['/docs/domains', 'Domains and targeting'],
              ['/docs/consent', 'Consent and unsubscribe'],
              ['/docs/webhooks', 'Webhooks'],
              ['/docs/troubleshooting', 'Troubleshooting'],
              ['/docs/api', 'API reference'],
            ].map(([to, label]) => (
              <li key={to}>
                <Link to={to ?? '/'} className="text-muted hover:text-ink">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Policies</p>
          <ul className="mt-3 space-y-2 text-sm">
            {[
              ['/policies/privacy', 'Privacy'],
              ['/policies/terms', 'Terms'],
              ['/policies/storage', 'Storage and cookies'],
              ['/policies/acceptable-use', 'Acceptable use'],
            ].map(([to, label]) => (
              <li key={to}>
                <Link to={to ?? '/'} className="text-muted hover:text-ink">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
            Your own data
          </p>
          <p className="mt-3 max-w-xs text-sm text-muted">
            Filled in a form powered by this platform? You can{' '}
            <Link
              to="/privacy"
              className="text-signal underline decoration-signal/40 underline-offset-4 hover:decoration-signal"
            >
              see or delete what is held about you
            </Link>{' '}
            without an account.
          </p>
        </div>
      </div>

      <div className="border-t border-edge">
        <p className="mx-auto max-w-6xl px-5 py-5 text-xs text-muted">
          A portfolio project, built to a written blueprint. Synthetic data only, no service level
          agreement. MIT licensed.
        </p>
      </div>
    </footer>
  );
}

/**
 * The shell every public page sits in.
 *
 * `main` carries the landmark and the skip target, so the header links are
 * skippable on every page rather than only where somebody remembered.
 */
export function PublicShell({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:border focus:border-signal focus:bg-panel focus:px-4 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>
      <PublicHeader />
      <main id="content" className="flex-1">
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
