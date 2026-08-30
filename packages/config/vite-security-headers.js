/**
 * Security headers for a Vite-served application (blueprint 17).
 *
 * The two front-end applications are static documents. Whoever serves them in
 * production sets response headers, but a `<meta http-equiv>` tag travels with
 * the document itself - so the Content Security Policy holds on a developer's
 * machine, on the dev server, on a preview build, and on whatever static host
 * the page ends up on, without depending on a hosting configuration none of
 * those four share.
 *
 * So both are done: the meta tag is injected into the HTML, and the dev and
 * preview servers additionally send the real headers, which is the only way to
 * carry the ones a meta tag cannot express (`X-Frame-Options` and
 * `Permissions-Policy` are ignored in meta form).
 *
 * The policy itself is NOT defined here. It comes from
 * `@lcp/contracts/security`, which the server uses too, so a reviewer reads one
 * document rather than three.
 *
 * @param {object} options
 * @param {string} options.csp                 serialized policy for the built document
 * @param {string} options.devCsp              serialized policy for the dev server
 * @param {string} options.metaCsp             built-document policy, minus what a meta tag ignores
 * @param {string} options.devMetaCsp          dev policy, minus what a meta tag ignores
 * @param {Record<string, string>} options.headers  the non-CSP headers
 * @returns {import('vite').Plugin}
 */
export function securityHeaders(options) {
  const { csp, devCsp, metaCsp, devMetaCsp, headers } = options;

  /** @param {import('node:http').ServerResponse} response */
  const apply = (response, policy) => {
    for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
    response.setHeader('Content-Security-Policy', policy);
  };

  return {
    name: 'lcp-security-headers',

    configureServer(server) {
      server.middlewares.use((_request, response, next) => {
        apply(response, devCsp);
        next();
      });
    },

    configurePreviewServer(server) {
      server.middlewares.use((_request, response, next) => {
        apply(response, csp);
        next();
      });
    },

    /**
     * The meta tag, injected into every HTML entry point.
     *
     * `injectTo: 'head-prepend'` matters: a browser applies whichever policy it
     * has parsed by the time it meets a resource, so a CSP that arrives after
     * the first `<script>` tag governs nothing before it.
     *
     * The dev policy is used when Vite is serving, because Vite's own client
     * and the React plugin's refresh preamble are things the built application
     * does not contain.
     *
     * The META variant is used, not the header one: a browser ignores
     * `frame-ancestors` in a meta tag and says so on the console every time the
     * page loads. Carrying a directive that does nothing would make the tag
     * look like it protects against framing when only the header does.
     */
    transformIndexHtml: {
      order: 'pre',
      handler(_html, context) {
        return [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: context.server === undefined ? metaCsp : devMetaCsp,
            },
            injectTo: 'head-prepend',
          },
        ];
      },
    },
  };
}
