import './demo.css';

/**
 * The public sandbox (blueprint 14.3).
 *
 * No framework, by design: this application exists partly to prove the widget
 * runtime works on a page that shares nothing with the platform - no React, no
 * build-time component model, no shared package. If the widgets render here,
 * they render anywhere.
 *
 * Everything on the page comes from two public endpoints. Nothing is
 * hard-coded, and that is not incidental: the seeded widgets get fresh public
 * ids on every hourly reset, so a page with baked-in ids would break within the
 * hour and quietly show nothing.
 */

interface DemoWidget {
  readonly publicId: string;
  readonly type: 'contact_form' | 'email_signup' | 'cta_popover';
  readonly name: string;
  readonly blurb: string;
}

interface DemoConfig {
  readonly widgets: readonly DemoWidget[];
  readonly seededAt: string;
  readonly resetsAt: string;
  readonly apiBaseUrl: string;
}

interface DemoFeedEntry {
  readonly kind: 'submission' | 'view';
  readonly widgetName: string;
  readonly occurredAt: string;
  readonly fieldCount: number | null;
}

interface DemoFeed {
  readonly entries: readonly DemoFeedEntry[];
  readonly totals: { readonly submissions: number; readonly views: number };
  readonly seededAt: string;
  readonly resetsAt: string;
}

/**
 * Where the platform is.
 *
 * The default comes from the build, through the same constant that built this
 * page's Content Security Policy - so the origin this page fetches from and the
 * origin its policy permits are one value and cannot drift into disagreeing.
 *
 * Still overridable by query string, so the browser tests can point this page
 * at whichever port the platform is on; that is the same affordance the
 * isolation fixture has had since Stage 6, and the CSP is what stops it being
 * pointed anywhere interesting.
 */
declare const __PLATFORM_ORIGIN__: string;

const params = new URLSearchParams(window.location.search);
const apiBase = (params.get('api') ?? __PLATFORM_ORIGIN__).replace(/\/+$/, '');

const TYPE_LABEL: Readonly<Record<DemoWidget['type'], string>> = {
  contact_form: 'Contact form',
  email_signup: 'Email signup',
  cta_popover: 'CTA popover',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The snippet a customer pastes, matching what the dashboard prints. */
function snippetFor(publicId: string): string {
  return `<script async src="${apiBase}/widget/v1/loader.js"\n        data-widget="${publicId}"></script>`;
}

// ---------------------------------------------------------------- specimens

/**
 * One widget, mounted.
 *
 * A `li` inside an ordered list because the three are presented as a numbered
 * set of specimens, and a screen reader announcing "3 of 3" is telling the
 * reader something true about the page.
 */
function renderSpecimen(widget: DemoWidget): HTMLLIElement {
  const item = el('li', 'specimen');

  const label = el('p', 'specimen__label');
  label.append(document.createTextNode('Specimen · '));
  const strong = el('b', undefined, TYPE_LABEL[widget.type]);
  label.append(strong);
  item.append(label);

  item.append(el('p', 'specimen__blurb', widget.blurb));

  const mount = el('div', 'mount');
  mount.append(el('span', 'mount__tick'));

  if (widget.type === 'cta_popover') {
    /**
     * A popover has nothing to render inline until its trigger fires, so the
     * specimen is the trigger. It uses the one contract the runtime offers a
     * host page - `data-lcp-widget-open` - which is also exactly how a customer
     * would wire it to a button they already have.
     */
    const explain = el(
      'p',
      'mount__explain',
      'This one stays hidden until something opens it. It has a three-second delay of its own, and any element on the page can open it too:',
    );
    mount.append(explain);

    const opener = el('button', 'mount__opener', 'Open the popover');
    opener.type = 'button';
    opener.setAttribute('data-lcp-widget-open', widget.publicId);
    opener.setAttribute('data-testid', `open-${widget.publicId}`);
    mount.append(opener);
  }

  /**
   * The real snippet, appended into the mount. The loader guards itself, so
   * three of these on one page fetch the runtime once.
   */
  const script = document.createElement('script');
  script.async = true;
  script.src = `${apiBase}/widget/v1/loader.js`;
  script.setAttribute('data-widget', widget.publicId);
  mount.append(script);

  item.append(mount);

  // The spec plate. States what this is; does not apologise for it.
  const spec = el('dl', 'spec');
  for (const [term, value, tone] of [
    ['Type', TYPE_LABEL[widget.type], ''],
    ['Public id', widget.publicId, ''],
    ['Stores', 'Yes, in the sandbox', ''],
    ['Sends', 'Nothing', 'is-nothing'],
  ] as const) {
    spec.append(el('dt', undefined, term));
    const dd = el('dd', tone === '' ? undefined : tone, value);
    spec.append(dd);
  }
  item.append(spec);

  const details = el('details', 'snippet');
  const summary = el('summary');
  const caret = el('span', 'snippet__caret', '›');
  caret.setAttribute('aria-hidden', 'true');
  summary.append(caret, document.createTextNode('What a customer pastes'));
  details.append(summary);
  const pre = el('pre');
  pre.tabIndex = 0;
  pre.setAttribute('aria-label', `Embed snippet for the ${TYPE_LABEL[widget.type]}`);
  pre.append(el('code', undefined, snippetFor(widget.publicId)));
  details.append(pre);
  item.append(details);

  return item;
}

// --------------------------------------------------------------------- feed

let lastSeenTop: string | null = null;

function renderFeed(feed: DemoFeed): void {
  const list = document.getElementById('feed');
  const totals = document.getElementById('totals');
  if (list === null) return;

  list.replaceChildren();

  if (feed.entries.length === 0) {
    list.append(el('li', 'feed__empty', 'Nothing yet. Fill in one of the forms.'));
  } else {
    for (const entry of feed.entries) {
      const item = el('li', 'feed__entry');

      /**
       * The copy says what happened AND what did not, at the moment of maximum
       * attention - right after somebody submits. That is where the "nothing
       * is sent" message actually lands, and here it is information rather
       * than a warning.
       */
      const what = el('p', 'feed__what');
      if (entry.kind === 'submission') {
        const stored = el('span', 'feed__stored', 'Stored');
        what.append(stored);
        what.append(
          document.createTextNode(
            ` · ${entry.widgetName} · ${String(entry.fieldCount ?? 0)} field${entry.fieldCount === 1 ? '' : 's'}. No email sent.`,
          ),
        );
      } else {
        what.textContent = `Seen · ${entry.widgetName}`;
      }
      item.append(what);

      const when = new Date(entry.occurredAt);
      const meta = el('p', 'feed__meta');
      const time = el('time', undefined, when.toLocaleTimeString());
      time.dateTime = entry.occurredAt;
      meta.append(time);
      item.append(meta);

      // Only the genuinely new top entry animates, so a poll that changed
      // nothing does not flash the whole list.
      if (lastSeenTop !== null && entry.occurredAt > lastSeenTop) {
        item.classList.add('is-new');
      }
      list.append(item);
    }
    lastSeenTop = feed.entries[0]?.occurredAt ?? lastSeenTop;
  }

  if (totals !== null) {
    totals.textContent = `${String(feed.totals.submissions)} submission${feed.totals.submissions === 1 ? '' : 's'} · ${String(feed.totals.views)} view${feed.totals.views === 1 ? '' : 's'} · all of it deleted on the hour`;
  }
}

async function refreshFeed(): Promise<void> {
  try {
    const response = await fetch(`${apiBase}/demo/v1/feed`);
    if (!response.ok) return;
    renderFeed((await response.json()) as DemoFeed);
  } catch {
    // A feed that cannot load is not worth breaking the page over; the widgets
    // above it are the point and they load independently.
  }
}

// ----------------------------------------------------------------- countdown

function startCountdown(resetsAt: string): void {
  const node = document.getElementById('countdown');
  if (node === null) return;

  const tick = (): void => {
    const remaining = new Date(resetsAt).getTime() - Date.now();
    if (Number.isNaN(remaining)) return;
    if (remaining <= 0) {
      node.textContent = 'any moment now';
      return;
    }
    const minutes = Math.floor(remaining / 60_000);
    node.textContent = minutes < 1 ? 'in under a minute' : `in ${String(minutes)} min`;
  };

  tick();
  window.setInterval(tick, 30_000);
}

// ---------------------------------------------------------------------- boot

async function start(): Promise<void> {
  const list = document.getElementById('specimens');

  let config: DemoConfig;
  try {
    const response = await fetch(`${apiBase}/demo/v1/config`);
    if (!response.ok) throw new Error(String(response.status));
    config = (await response.json()) as DemoConfig;
  } catch {
    if (list !== null) {
      list.replaceChildren(
        el(
          'li',
          'specimen__blurb',
          'The sandbox is still being prepared, or the platform is not running. Reload in a moment.',
        ),
      );
    }
    return;
  }

  if (list !== null) {
    list.replaceChildren(...config.widgets.map(renderSpecimen));
  }
  startCountdown(config.resetsAt);

  await refreshFeed();

  /**
   * The feed follows what the visitor does.
   *
   * A submission is handled entirely inside the widget's shadow root, so this
   * page never sees the event - polling is how it notices. Thirty seconds is
   * frequent enough that somebody who has just submitted sees it appear, and
   * infrequent enough not to hammer a free-tier instance; the widget's own
   * submit also nudges a refresh through the runtime's `focus` handoff below.
   */
  window.setInterval(() => void refreshFeed(), 30_000);

  /**
   * A burst of faster checks just after any click inside the page.
   *
   * A click is the cheapest proxy for "somebody probably just pressed Send"
   * that does not require the runtime to expose an event we would then have to
   * keep in step with.
   *
   * A BURST rather than one check, and the extra ones are not belt-and-braces.
   * A submission commits asynchronously, so a feed fetched a second after the
   * click can legitimately land before the row exists - and the next scheduled
   * poll is then thirty seconds away. Somebody who had just pressed Send would
   * watch an unchanged feed for half a minute and reasonably conclude nothing
   * happened.
   *
   * Stage 12b checked twice, at 1.2 and 4 seconds, which closed the window on
   * an idle machine and not on a loaded one - a browser test failed against
   * exactly that in Stage 13. The delays now stretch to fourteen seconds and
   * stop early the moment something new arrives, so the burst costs one request
   * in the common case and covers a slow write in the uncommon one.
   */
  let chase: number[] = [];

  document.addEventListener('click', () => {
    for (const timer of chase) window.clearTimeout(timer);
    const before = lastSeenTop;
    chase = [1000, 2500, 5000, 9000, 14_000].map((delay) =>
      window.setTimeout(() => {
        // Something newer than the top entry we had at click time has arrived;
        // the rest of the burst has nothing left to look for.
        if (lastSeenTop !== before) return;
        void refreshFeed();
      }, delay),
    );
  });
}

void start();
