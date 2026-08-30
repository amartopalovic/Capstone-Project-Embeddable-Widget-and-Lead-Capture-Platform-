import { Link } from 'react-router';
import { CodeBlock } from '../../../components/CodeBlock.jsx';
import { DOC_SECTIONS, DocSection, DocsShell, Note } from '../DocsShell.jsx';

/**
 * Installing a widget.
 *
 * Every sample here is the real thing: the snippet matches what the builder
 * prints, and the identifier uses the real alphabet. Documentation whose code
 * is subtly different from the product teaches people to paste something that
 * does not work, and then blames them for it.
 */
export function InstallDoc(): React.JSX.Element {
  return (
    <DocsShell
      sections={DOC_SECTIONS}
      navLabel="Documentation"
      title="Install a widget"
      intro="Build it, publish it, paste one line. Nothing on your page needs to change afterwards when you edit the widget."
    >
      <DocSection title="Build and publish">
        <p>
          A widget is created from the Widgets screen and edited in a settings form with a live
          preview beside it. There are three types, and the type is fixed at creation because it
          decides which fields the form must have:
        </p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong className="font-medium text-ink">Contact form</strong> — always visible on the
            page, and always asks for an email address and a message.
          </li>
          <li>
            <strong className="font-medium text-ink">Email signup</strong> — a single address field,
            for a list or a newsletter.
          </li>
          <li>
            <strong className="font-medium text-ink">CTA popover</strong> — hidden until a trigger
            fires, then opens over the page.
          </li>
        </ul>
        <p>
          Editing changes a <em>draft</em>. Visitors keep seeing the last published version until
          you publish again, so an unfinished edit can never reach a customer’s site. Publishing
          needs a confirmed email address and at least one allowed domain.
        </p>
      </DocSection>

      <DocSection title="Paste the snippet">
        <p>
          The Widgets screen shows the exact tag for your widget, with your instance’s address
          already filled in. It looks like this:
        </p>

        <CodeBlock
          language="html"
          code={`<script async src="https://your-instance.example/widget/v1/loader.js" data-widget="w_8fk2m4qp7xz9nv3d"></script>`}
          caption="Put it anywhere in the page. It does not need to be in the head, and it does not need to be last."
        />

        <p>
          The <code className="font-mono text-[13px] text-ink">data-widget</code> value is your
          widget’s public identifier. It is safe to publish — it identifies the widget, and it
          authorises nothing on its own. What decides whether a submission is accepted is the
          allowed-domain list, checked on the server against the request’s{' '}
          <code className="font-mono text-[13px] text-ink">Origin</code>.
        </p>

        <p>
          The tag is <code className="font-mono text-[13px] text-ink">async</code>, so it never
          blocks your page from rendering. The loader is one small shared file: if you install two
          widgets on the same page, the browser fetches it once and both are set up from it.
        </p>

        <Note>
          The widget renders inside a shadow root. Your site’s CSS cannot reshape it and its styles
          cannot leak into your page, which is also why you cannot restyle it with your own
          stylesheet — use the appearance settings in the builder instead.
        </Note>
      </DocSection>

      <DocSection title="Open a popover from your own button">
        <p>
          A CTA popover normally opens on its own trigger — after a delay, at a scroll depth, or on
          exit intent. If you would rather open it from a link or button you already have, give that
          element the attribute below with your widget’s public identifier:
        </p>
        <CodeBlock
          language="html"
          code={`<button type="button" data-lcp-widget-open="w_8fk2m4qp7xz9nv3d">
  Get in touch
</button>`}
        />
        <p>
          Any number of elements can carry it. The widget must still be published and the page must
          still pass the targeting rules.
        </p>
      </DocSection>

      <DocSection title="Check that it worked">
        <p>Three things tell you the installation is live, in increasing order of certainty:</p>
        <ol className="ml-5 list-decimal space-y-1.5">
          <li>The widget renders on your page.</li>
          <li>
            Submitting it shows the confirmation you configured, and the lead appears in your inbox
            without you reloading it.
          </li>
          <li>
            The Analytics page counts a view for the widget. Views are recorded even when nobody
            submits, so this is what tells you the widget is being seen at all.
          </li>
        </ol>
        <p>
          If the widget does not appear, the cause is almost always the allowed-domain list. See{' '}
          <Link
            to="/docs/troubleshooting"
            className="text-signal underline decoration-signal/40 underline-offset-4 hover:decoration-signal"
          >
            troubleshooting
          </Link>
          .
        </p>
      </DocSection>

      <DocSection title="What we store, and what we do not">
        <p>
          A submission stores the values the visitor typed, the page and domain it came from, an
          approximate location, and the time. It does not store their IP address, and it sets no
          cookie on your site.
        </p>
        <p>
          Analytics events store even less: a widget, a page, a time, and a rotating pseudonym that
          is scoped to one widget — so the same visitor is not identifiable across two customers’
          sites. Raw events are deleted after 90 days; the daily counters built from them are kept.
        </p>
      </DocSection>
    </DocsShell>
  );
}
