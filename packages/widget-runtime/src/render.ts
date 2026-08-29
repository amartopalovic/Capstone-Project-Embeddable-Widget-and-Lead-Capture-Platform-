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

export interface RenderOptions {
  readonly response: PublicWidgetResponse;
  /** Whether to draw a close control - modal and floating modes have one. */
  readonly dismissible: boolean;
  readonly onClose: () => void;
  /**
   * Where a completed submission would go.
   *
   * Stage 7 owns the submission endpoint. Until it exists the form is rendered
   * fully and inertly: this is the typed seam it will attach to, not a
   * half-working post.
   */
  readonly onSubmit: (values: Record<string, string>) => void;
}

export function renderWidget(options: RenderOptions): RenderedWidget {
  const { response, dismissible, onClose, onSubmit } = options;
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
    panel.append(link);

    return { panel, focusable: () => collectFocusable(panel) };
  }

  const form = element('form');
  form.noValidate = true;
  const ordered = [...config.fields].sort((a, b) => a.order - b.order);
  for (const field of ordered) form.append(renderField(field, idPrefix));

  const submit = element('button', 'submit');
  submit.type = 'submit';
  submit.textContent = config.submitLabel;
  form.append(submit);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
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
    onSubmit(values);
  });

  panel.append(form);
  return { panel, focusable: () => collectFocusable(panel) };
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function collectFocusable(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
}
