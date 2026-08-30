import { Link } from 'react-router';
import { DocSection, DocsShell, Note, POLICY_SECTIONS } from './DocsShell.jsx';

/**
 * The four policy pages blueprint 4.8 requires.
 *
 * Written as real policy rather than as filler, and written for what this
 * actually is: a portfolio project with no company behind it. That constraint
 * is stated at the top of each page instead of being hidden in a final
 * paragraph, because somebody deciding whether to put data here needs it before
 * they read anything else - not after.
 *
 * They are deliberately workspace-neutral. A customer using this platform is
 * the controller of their own leads' data and needs their own privacy policy;
 * these describe the platform, and say so.
 */

const UPDATED = '30 August 2026';

function PolicyMeta(): React.JSX.Element {
  return (
    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
      Last updated {UPDATED}
    </p>
  );
}

function PortfolioNotice(): React.JSX.Element {
  return (
    <Note tone="warning">
      This is a portfolio project, not a company. There is no legal entity behind it, no support
      commitment, and no service level agreement. Treat the hosted instance as a demonstration: put
      synthetic data in it and nothing you would mind losing.
    </Note>
  );
}

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

export function PrivacyPolicyPage(): React.JSX.Element {
  return (
    <DocsShell
      sections={POLICY_SECTIONS}
      navLabel="Policies"
      title="Privacy"
      intro="What this platform stores, why, for how long, and how to get it back or have it removed."
    >
      <PolicyMeta />
      <PortfolioNotice />

      <DocSection title="Two different sets of people">
        <p>
          This platform holds data about two groups, and they have different relationships with it.
        </p>
        <p>
          <strong className="font-medium text-ink">Account holders</strong> are people who sign up
          and build widgets. We hold their email address, a hashed password, and the security
          settings on their account.
        </p>
        <p>
          <strong className="font-medium text-ink">Leads</strong> are people who fill in a form
          built with this platform, on somebody else’s website. We store their submission on behalf
          of the workspace that collected it. That workspace decides what to ask for and what to do
          with the answers; this platform provides the mechanism.
        </p>
        <p>
          If you are a lead and want to know why a particular company holds your details, ask them —
          they chose the questions. What you can do here, without an account, is see everything one
          workspace holds about you or have it deleted.
        </p>
      </DocSection>

      <DocSection title="What is stored about a lead">
        <ul className="ml-5 list-disc space-y-1.5">
          <li>The values submitted in the form, exactly as typed.</li>
          <li>The page address and domain the form was on, and the time.</li>
          <li>
            An approximate location derived from the network address — country, region, and city.
            Never the address itself.
          </li>
          <li>
            The consent wording shown at the time, and whether it was agreed to, so consent can be
            evidenced later.
          </li>
          <li>Notes, tags, and status that the workspace’s own team adds afterwards.</li>
        </ul>
        <p>
          Raw network addresses are used during a request for spam and rate-limit checks and are
          never written to storage. What is stored instead is a rotating one-way pseudonym that
          changes every month.
        </p>
      </DocSection>

      <DocSection title="What is stored about a visitor who does not submit">
        <p>
          Widget views and interactions are counted so a workspace can see whether its forms are
          working. Those records contain a widget, a page, a time, and a rotating pseudonym that is
          scoped to a single widget — so the same person is not identifiable across two different
          customers’ websites. No cookie is set, no advertising identifier is used, and nothing is
          shared with a third party for advertising.
        </p>
        <p>
          Raw interaction records are deleted after 90 days. Only anonymous daily counts remain.
        </p>
      </DocSection>

      <DocSection title="How long things are kept">
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong className="font-medium text-ink">Leads:</strong> as long as the workspace
            chooses, up to indefinitely, with 12 months the default. Measured from the last time the
            lead was active or worked on.
          </li>
          <li>
            <strong className="font-medium text-ink">
              Deleted leads, widgets, workspaces, and accounts:
            </strong>{' '}
            recoverable for 30 days, then permanently removed or anonymised.
          </li>
          <li>
            <strong className="font-medium text-ink">Raw interaction events:</strong> 90 days.
          </li>
          <li>
            <strong className="font-medium text-ink">Delivery records:</strong> 90 days.
          </li>
          <li>
            <strong className="font-medium text-ink">Audit records:</strong> 12 months.
          </li>
        </ul>
        <p>These are enforced by scheduled jobs, not by intention.</p>
      </DocSection>

      <DocSection title="Your rights over your own data">
        <p>
          If you have filled in a form powered by this platform, you can ask for a copy of
          everything one workspace holds about you, or have it deleted. Both are self-service and
          need no account:
        </p>
        <p>
          <Link
            to="/privacy"
            className="text-signal underline decoration-signal/40 underline-offset-4 hover:decoration-signal"
          >
            See or delete your data
          </Link>
        </p>
        <p>
          You confirm the request from your own inbox, which is what proves the address is yours. A
          deletion is immediate and irreversible. One thing survives it deliberately: a one-way
          fingerprint of your address on the unsubscribe list, so the workspace cannot start
          emailing you again if you later fill in another of their forms. It cannot be read back
          into your address.
        </p>
        <p>
          Every marketing email carries an unsubscribe link, which stops marketing across every
          widget in that workspace. Messages that answer something you did — a confirmation after
          you submit a form — are not affected.
        </p>
      </DocSection>

      <DocSection title="Who else sees it">
        <p>
          Data is processed by the infrastructure this runs on: a hosting provider, a database
          provider, a Redis provider, and an email provider for outbound messages. An approximate
          location lookup is made against a third-party geolocation service using the network
          address, which is not retained. Nothing is sold, and nothing is shared for advertising.
        </p>
        <p>
          A workspace can configure a webhook that posts its own leads to its own endpoint. Where a
          lead’s data goes after that is between the lead and that workspace.
        </p>
      </DocSection>

      <DocSection title="Security">
        <p>
          Passwords are hashed with Argon2id. Sessions are server-side and can be revoked
          immediately. Two-factor authentication is available and secrets for it are encrypted at
          rest. Every workspace’s data is isolated at the query layer, and cross-tenant access is
          tested rather than assumed.
        </p>
        <PortfolioNotice />
      </DocSection>
    </DocsShell>
  );
}

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

export function TermsPage(): React.JSX.Element {
  return (
    <DocsShell
      sections={POLICY_SECTIONS}
      navLabel="Policies"
      title="Terms"
      intro="What you can expect from this service, and what it expects from you."
    >
      <PolicyMeta />
      <PortfolioNotice />

      <DocSection title="What this is">
        <p>
          A demonstration of an embeddable lead-capture platform, built as a portfolio project
          against a written specification. The software is MIT licensed. The hosted instance is
          provided so the work can be evaluated, not as a commercial service.
        </p>
      </DocSection>

      <DocSection title="No warranty, and no guarantee of availability">
        <p>
          The service is provided as is. It runs on free infrastructure and may be slow, asleep,
          restarted, reset, or withdrawn at any time without notice. There is no uptime commitment,
          no backup you can rely on, and no support channel.
        </p>
        <p>
          Do not use it for anything that matters. Do not store personal data about real people in
          it, and do not point a production website at it.
        </p>
      </DocSection>

      <DocSection title="Your account and your workspace">
        <p>
          You are responsible for what happens under your account, for keeping your password to
          yourself, and for who you invite into your workspace. Roles are enforced, but somebody you
          make an Admin can do Admin things.
        </p>
        <p>
          You can delete your account at any time. It is recoverable for 30 days, after which the
          profile is removed and the history of what it did in a workspace is anonymised rather than
          erased — so a workspace’s own accountability record survives somebody leaving.
        </p>
      </DocSection>

      <DocSection title="Data you collect from other people">
        <p>
          If you collect leads with this platform, you are the one responsible for them. That means
          telling people what you are collecting and why, having a lawful basis for it, honouring
          unsubscribe and deletion requests, and having your own privacy policy. This platform gives
          you the mechanisms — consent records, unsubscribe suppression, retention limits, and a
          self-service export and deletion flow — but it does not make those decisions for you.
        </p>
      </DocSection>

      <DocSection title="Limits">
        <p>
          Each workspace is capped at 10 members, 10 active widgets, 2,000 accepted submissions per
          month, and 20,000 interaction events per month. Requests are rate limited and bodies are
          capped at 32 KB. These are enforced, and reaching one returns a clear error rather than
          silently dropping data.
        </p>
      </DocSection>

      <DocSection title="Ending it">
        <p>
          You can stop using the service and delete your workspace whenever you like. Access may be
          withdrawn if the acceptable-use policy is broken, and the whole instance may be shut down
          at any point, since it exists to demonstrate a piece of work rather than to serve
          customers.
        </p>
      </DocSection>
    </DocsShell>
  );
}

// ---------------------------------------------------------------------------
// Storage and cookies
// ---------------------------------------------------------------------------

export function StoragePage(): React.JSX.Element {
  return (
    <DocsShell
      sections={POLICY_SECTIONS}
      navLabel="Policies"
      title="Storage and cookies"
      intro="What is written to your browser, by which part of the product, and whether you can refuse it."
    >
      <PolicyMeta />

      <DocSection title="On a website that has a widget installed">
        <p>
          The widget sets <strong className="font-medium text-ink">no cookies</strong>. It writes
          one thing to that site’s own local storage, and only for widgets that can be dismissed: a
          note that you closed it, so it does not reopen immediately.
        </p>
        <p>
          That note lives under the website’s own origin, is readable only by that site, and is
          never sent to us. Clearing your browser storage removes it, and the widget will simply
          appear again. Nothing is used for advertising, and nothing follows you to another site.
        </p>
      </DocSection>

      <DocSection title="On the dashboard, when you are signed in">
        <p>Two cookies, both strictly necessary for the application to work at all:</p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong className="font-mono text-[13px] text-ink">lcp.sid</strong> — your session. Set
            when you sign in, deleted when you sign out. HttpOnly so scripts cannot read it, Secure
            in production, and SameSite=Lax.
          </li>
          <li>
            <strong className="font-mono text-[13px] text-ink">lcp.csrf</strong> — a token that
            proves a state-changing request came from the application rather than from another site
            that had you open in a tab.
          </li>
        </ul>
        <p>
          There is no analytics cookie, no advertising cookie, and no third-party script on the
          dashboard. Because both cookies are strictly necessary for a service you asked for, there
          is no consent banner — a banner offering a choice that does not exist would be theatre.
        </p>
      </DocSection>

      <DocSection title="What we do instead of tracking">
        <p>
          Widget analytics are counted without identifying anybody. Instead of a cookie or a network
          address, a one-way pseudonym is derived that rotates monthly and is scoped to a single
          widget. It cannot be reversed, it changes every month, and the same person produces
          different values on two different customers’ websites — so it cannot be used to follow
          anybody around the internet.
        </p>
      </DocSection>
    </DocsShell>
  );
}

// ---------------------------------------------------------------------------
// Acceptable use
// ---------------------------------------------------------------------------

export function AcceptableUsePage(): React.JSX.Element {
  return (
    <DocsShell
      sections={POLICY_SECTIONS}
      navLabel="Policies"
      title="Acceptable use"
      intro="A short list, because most of it follows from one idea: this collects data from other people, on their own devices."
    >
      <PolicyMeta />

      <DocSection title="Do not">
        <ul className="ml-5 list-disc space-y-2">
          <li>
            Collect data from people without telling them what it is for. The consent field exists
            for this, and the wording you write is recorded as evidence.
          </li>
          <li>
            Install a widget on a website you do not control or have permission to modify. The
            allowed-domain list is checked on the server precisely so this is enforceable rather
            than merely discouraged.
          </li>
          <li>
            Ask for special-category data — health, biometrics, political or religious belief,
            sexual orientation — or for payment card details. This platform is not built to hold
            them and its safeguards are not designed for them.
          </li>
          <li>
            Send marketing to people who have unsubscribed, or work around suppression by deleting
            and recreating a lead. Suppression deliberately survives deletion.
          </li>
          <li>
            Use the service to send unsolicited bulk email, or to add addresses you obtained
            elsewhere.
          </li>
          <li>
            Attempt to reach another workspace’s data, exceed the published limits by automated
            means, or use the platform to attack a third party — including by pointing a webhook at
            somebody else’s infrastructure.
          </li>
          <li>
            Store real personal data on the hosted demonstration instance. It offers no guarantees
            and may be reset.
          </li>
        </ul>
      </DocSection>

      <DocSection title="Security research">
        <p>
          Looking is fine. If you find a way to reach data across a workspace boundary, to bypass a
          rate limit, or to make a widget do something its configuration should not allow, report it
          rather than exercising it against somebody else’s workspace. Do not use automated scanning
          that degrades the service for others — it runs on free infrastructure and is easy to knock
          over, which is not an interesting finding.
        </p>
      </DocSection>

      <DocSection title="What happens if this is broken">
        <p>
          Access can be withdrawn without notice. There is no appeals process, because there is no
          company — this is a portfolio project, and the remedy for a dispute is that you stop using
          it.
        </p>
      </DocSection>
    </DocsShell>
  );
}
