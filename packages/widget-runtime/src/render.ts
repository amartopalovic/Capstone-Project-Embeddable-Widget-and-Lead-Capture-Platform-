import { isSafeDestinationUrl } from '@lcp/contracts/rules';
import type { PublicWidgetConfig, PublicWidgetResponse, WidgetField } from '@lcp/contracts';

/**
 * Building the widget's DOM.
 *
 * Every configured string reaches the page through `textContent` or a property
 * assignment - there is no `innerHTML` anywhere in this file, and no template
 * string that becomes markup. Blueprint 17 requires "output escaping, safe
 * template variables, and no arbitrary HTML/CSS/JS", and the way to keep that
 * promise in a framework-free bundle is to never build markup from a string in
 * the first place.
 *
 * The CTA destination is re-checked with the same `isSafeDestinationUrl` the
 * server validates with. The server has already refused anything else, so this
 * is defence in depth - but an href is the one place a bad value becomes script
 * execution in the host page, and the check costs nothing.
 */

const INPUT_TYPES: Record<string, string> = {
  email: 'email',
  phone: 'tel',
  name: 'text',
  subject: 'text',
  company: 'text',
};

export interface RenderedWidget {
  readonly panel: HTMLElement;
  /** Focusable elements in order, for the modal focus trap. */
  focusable(): HTMLElement[];
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  return node;
}

/** One form field, label bound to control by id (blueprint 14.1). */
function renderField(field: WidgetField, idPrefix: string): HTMLElement {
  const wrapper = element('div', 'field');
  const controlId = `${idPrefix}-${field.type}`;

  if (field.type === 'consent') {
    const row = element('div', 'consent');
    const input = element('input');
    input.type = 'checkbox';
    input.id = controlId;
    input.name = field.type;
    input.required = field.required;

    const label = element('label', 'label');
    label.htmlFor = controlId;
    label.textContent = field.label;
    if (field.required) {
      const star = element('span', 'required');
      star.textContent = ' *';
      label.append(star);
    }

    row.append(input, label);
    wrapper.append(row);
  } else {
    const label = element('label', 'label');
    label.htmlFor = controlId;
    label.textContent = field.label;
    if (field.required) {
      const star = element('span', 'required');
      star.textContent = ' *';
      label.append(star);
    }

    const control = field.type === 'message' ? element('textarea') : element('input');
    if (control instanceof HTMLInputElement) {
      control.type = INPUT_TYPES[field.type] ?? 'text';
    }
    control.id = controlId;
    control.name = field.type;
    control.required = field.required;
    control.maxLength = field.maxLength;
    if (field.placeholder !== '') control.placeholder = field.placeholder;

    wrapper.append(label, control);
  }

  if (field.helpText !== '') {
    const help = element('p', 'help');
    help.id = `${controlId}-help`;
    help.textContent = field.helpText;
    wrapper.append(help);

    const control = wrapper.querySelector<HTMLElement>(`#${CSS.escape(controlId)}`);
    control?.setAttribute('aria-describedby', help.id);
  }

  return wrapper;
}

/**
 * What the runtime shows after a submission.
 *
 * A closed union rather than a loose object, so a caller cannot forget the
 * failure case - which is the one a half-finished integration always forgets.
 */
export type SubmitOutcome =
  | { readonly kind: 'message'; readonly message: string }
  | { readonly kind: 'redirect'; readonly url: string }
  | { readonly kind: 'error'; readonly message: string };

export interface RenderOptions {
  readonly response: PublicWidgetResponse;
  /** Whether to draw a close control - modal and floating modes have one. */
  readonly dismissible: boolean;
  readonly onClose: () => void;
  /**
   * Send a completed submission.
   *
   * Resolves with what to show the visitor. The runtime does not decide that:
   * the success message is the workspace's own configured wording, and a
   * failure is whatever the server said, because the server owns the field
   * schema and the runtime must not grow a second opinion about it.
   */
  readonly onSubmit: (values: Record<string, string>) => Promise<SubmitOutcome>;
  /**
   * The visitor started filling the form (blueprint 4.9).
   *
   * Fired on the first input or focus, whichever comes first, and only once -
   * the funnel counts a visitor REACHING a stage, not how many fields they
   * touched.
   */
  readonly onFormStart?: () => void;
  /** The visitor clicked the CTA link (blueprint 4.9). */
  readonly onCtaClick?: () => void;
}

export function renderWidget(options: RenderOptions): RenderedWidget {
  const { response, dismissible, onClose, onSubmit, onFormStart, onCtaClick } = options;
  const config: PublicWidgetConfig = response.config;
  const idPrefix = `lcp-${response.publicId}`;

  const panel = element('div', 'panel');

  if (dismissible) {
    const close = element('button', 'close');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', onClose);
    panel.append(close);
  }

  const headline = element('h2', 'headline');
  headline.id = `${idPrefix}-headline`;
  headline.textContent = config.headline;
  panel.append(headline);

  if (config.body !== '') {
    const body = element('p', 'body');
    body.textContent = config.body;
    panel.append(body);
  }

  // A CTA popover that links out is a button, not a form.
  if (config.ctaAction.kind === 'external_url') {
    const link = element('a', 'submit');
    link.textContent = config.submitLabel;
    if (isSafeDestinationUrl(config.ctaAction.url)) {
      link.href = config.ctaAction.url;
    } else {
      // Never emit an href we would not vouch for; the label still renders.
      link.setAttribute('aria-disabled', 'true');
    }
    link.rel = 'noopener noreferrer';
    link.target = '_blank';
    /**
     * Recorded on click, before the navigation. The analytics queue flushes on
     * `visibilitychange`, so a click that leaves the page still reports.
     */
    if (onCtaClick !== undefined) link.addEventListener('click', () => onCtaClick());
    panel.append(link);

    return { panel, focusable: () => collectFocusable(panel) };
  }

  const form = element('form');
  form.noValidate = true;

  /**
   * Form start, on whichever of focus or input happens first.
   *
   * `focusin` alone would count a visitor who tabbed through without typing;
   * `input` alone would miss somebody who focused and then left, which is a
   * real signal about a form people open and abandon. Taking the earlier of the
   * two, once, records the stage they actually reached. Both listeners are
   * `once` so neither leaks.
   */
  if (onFormStart !== undefined) {
    let started = false;
    const start = (): void => {
      if (started) return;
      started = true;
      onFormStart();
    };
    form.addEventListener('focusin', start, { once: true });
    form.addEventListener('input', start, { once: true });
  }
  const ordered = [...config.fields].sort((a, b) => a.order - b.order);
  for (const field of ordered) form.append(renderField(field, idPrefix));

  const submit = element('button', 'submit');
  submit.type = 'submit';
  submit.textContent = config.submitLabel;
  form.append(submit);

  /**
   * A place for the server's answer, announced politely.
   *
   * Inside the form rather than replacing it, so a rejected submission keeps
   * what the visitor typed. Losing somebody's message because one field was
   * wrong is the rudest thing a form can do.
   */
  const notice = element('p', 'notice');
  notice.setAttribute('role', 'status');
  notice.hidden = true;
  form.append(notice);

  let sending = false;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (sending) return;

    const values: Record<string, string> = {};
    for (const field of ordered) {
      const control = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        `#${CSS.escape(`${idPrefix}-${field.type}`)}`,
      );
      if (control === null) continue;
      values[field.type] =
        control instanceof HTMLInputElement && control.type === 'checkbox'
          ? String(control.checked)
          : control.value;
    }

    sending = true;
    submit.disabled = true;
    notice.hidden = true;

    void onSubmit(values).then(
      (outcome) => {
        sending = false;
        submit.disabled = false;

        if (outcome.kind === 'redirect') {
          window.location.assign(outcome.url);
          return;
        }

        if (outcome.kind === 'error') {
          notice.className = 'notice error';
          notice.textContent = outcome.message;
          notice.hidden = false;
          return;
        }

        /**
         * Success replaces the form entirely. There is nothing left to do with
         * it, and leaving a filled-in form on screen invites a second send.
         */
        form.replaceChildren();
        const done = element('p', 'notice success');
        done.setAttribute('role', 'status');
        done.textContent = outcome.message;
        form.append(done);
      },
      () => {
        sending = false;
        submit.disabled = false;
        notice.className = 'notice error';
        notice.textContent = 'That did not send. Check your connection and try again.';
        notice.hidden = false;
      },
    );
  });

  panel.append(form);
  return { panel, focusable: () => collectFocusable(panel) };
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function collectFocusable(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
}
