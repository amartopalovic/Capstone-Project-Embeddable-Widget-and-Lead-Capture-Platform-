import { CodeBlock } from '../../../components/CodeBlock.jsx';
import { DOC_SECTIONS, DocSection, DocsShell, Note, Settings } from '../DocsShell.jsx';

/**
 * Allowed domains and page targeting.
 *
 * These two settings are frequently confused, and the confusion is expensive:
 * one is a security boundary the server enforces, the other is a display rule
 * the browser applies. The page separates them before explaining either.
 */
export function DomainsDoc(): React.JSX.Element {
  return (
    <DocsShell
      sections={DOC_SECTIONS}
      navLabel="Documentation"
      title="Domains and targeting"
      intro="Where a widget is allowed to run, and where it chooses to appear. These are two different settings, and only one of them is a security control."
    >
      <DocSection title="The difference, first">
        <Settings
          rows={[
            {
              term: 'Allowed domains',
              description: (
                <>
                  A <strong className="font-medium">security boundary</strong>, enforced on the
                  server. A submission from a domain that is not on the list is refused, whatever
                  the page claims about itself. This is what stops somebody copying your snippet
                  onto their own site and filling your inbox.
                </>
              ),
            },
            {
              term: 'Page targeting',
              description: (
                <>
                  A <strong className="font-medium">display rule</strong>, applied in the browser.
                  It decides which pages on your allowed domains actually show the widget. It is a
                  convenience, not a protection — treat it as “where I want this to appear”.
                </>
              ),
            },
          ]}
        />
      </DocSection>

      <DocSection title="Allowed domains">
        <p>
          At least one is required before a widget can be published. Enter hosts, not URLs — no
          scheme, no path, no port:
        </p>
        <CodeBlock
          language="text"
          code={`example.com          matches https://example.com only
*.example.com        matches shop.example.com, blog.example.com, and so on
localhost            for local development`}
        />
        <p>
          A wildcard covers subdomains, not the bare domain: if you need both{' '}
          <code className="font-mono text-[13px] text-ink">example.com</code> and{' '}
          <code className="font-mono text-[13px] text-ink">www.example.com</code>, add both. The
          check is made against the request’s{' '}
          <code className="font-mono text-[13px] text-ink">Origin</code> header, which a browser
          sets and a page cannot forge.
        </p>

        <Note tone="warning">
          Removing a domain takes effect the next time the widget is published. Until then the
          previously published revision — including its allowlist — is what visitors get, because a
          published revision is an immutable snapshot.
        </Note>
      </DocSection>

      <DocSection title="Page targeting">
        <p>
          Include and exclude patterns are matched against the page’s path. Leave both empty and the
          widget appears on every page of every allowed domain.
        </p>
        <CodeBlock
          language="text"
          code={`/pricing             exactly that path
/blog/*              one level below /blog
/blog/**             /blog and everything under it, at any depth
/products/*/reviews  a wildcard in the middle`}
        />
        <p>
          Excludes are applied after includes, so an exclude always wins. A common shape is “every
          page except the ones where a popover would be rude”:
        </p>
        <Settings
          rows={[
            { term: 'Include', description: '/**' },
            { term: 'Exclude', description: '/checkout/**, /account/**' },
          ]}
        />
      </DocSection>

      <DocSection title="Cooldown">
        <p>
          For a CTA popover, the cooldown decides how long a visitor who dismisses it is left alone.
          It is remembered in the browser’s own storage on your site, not in a cookie and not on our
          server, so it does not follow anybody between sites.
        </p>
        <p>
          A visitor who clears their browser storage sees the popover again. That is the honest
          behaviour: we would rather forget somebody’s preference than track them to remember it.
        </p>
      </DocSection>
    </DocsShell>
  );
}
