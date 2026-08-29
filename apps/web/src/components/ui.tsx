import {
  useId,
  useState,
  type ReactNode,
  type InputHTMLAttributes,
  type ButtonHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import type { ContactStatusValue, WidgetLifecycleState, WorkspaceRoleName } from '@lcp/contracts';

/**
 * Shared auth components.
 *
 * These are built on native semantic elements rather than a headless component
 * library. For forms the native elements ARE the accessible primitives: a real
 * `<label for>`, a real `<button>`, and `aria-describedby` give screen readers
 * and keyboards everything they need, with no JavaScript to go wrong. A headless
 * library earns its place for composite widgets - dialogs, comboboxes, tabs -
 * which this auth surface does not have. Stage 12 can add one when the dashboard
 * introduces those patterns.
 */

// ---------------------------------------------------------------------------
// AuthPanel - the signature element
// ---------------------------------------------------------------------------

/**
 * The mount bracket.
 *
 * Four corner ticks framing the panel, drawn from the product's own world: this
 * platform makes widgets that get mounted into someone else's page, and the
 * auth panel is presented as exactly that kind of mounted artifact. It is
 * decorative, so it is hidden from assistive technology.
 */
function MountBracket(): React.JSX.Element {
  const tick = 'absolute h-3 w-3 border-signal/45';
  return (
    <div aria-hidden="true" className="pointer-events-none absolute -inset-3">
      <span className={`${tick} left-0 top-0 border-l border-t`} />
      <span className={`${tick} right-0 top-0 border-r border-t`} />
      <span className={`${tick} bottom-0 left-0 border-b border-l`} />
      <span className={`${tick} bottom-0 right-0 border-b border-r`} />
    </div>
  );
}

export interface AuthPanelProps {
  readonly title: string;
  readonly intro?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  /** Shown above the title in mono, e.g. "step 2 of 3". */
  readonly eyebrow?: string;
  readonly wide?: boolean;
}

export function AuthPanel({
  title,
  intro,
  children,
  footer,
  eyebrow,
  wide = false,
}: AuthPanelProps): React.JSX.Element {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <div className={`relative w-full ${wide ? 'max-w-xl' : 'max-w-md'} mount-in`}>
        <MountBracket />
        <div className="relative border border-edge bg-panel px-6 py-8 sm:px-8">
          {eyebrow !== undefined && (
            <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-signal">
              {eyebrow}
            </p>
          )}
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          {intro !== undefined && <p className="mt-2 text-sm text-muted">{intro}</p>}
          <div className="mt-7">{children}</div>
        </div>
        {footer !== undefined && (
          <div className="mt-5 text-center text-sm text-muted">{footer}</div>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  readonly label: string;
  readonly error?: string | undefined;
  readonly hint?: string | undefined;
  /** Monospace input, for codes that are read character by character. */
  readonly mono?: boolean;
}

export function Field({
  label,
  error,
  hint,
  mono = false,
  ...inputProps
}: FieldProps): React.JSX.Element {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  // Only reference ids that are actually rendered, or a screen reader
  // announces a dangling reference.
  const describedBy = [hint !== undefined ? hintId : null, error !== undefined ? errorId : null]
    .filter((value): value is string => value !== null)
    .join(' ');

  return (
    <div className="mb-5">
      <label
        htmlFor={id}
        className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-muted"
      >
        {label}
      </label>
      <input
        id={id}
        {...inputProps}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        className={[
          'w-full border bg-panel px-3 py-2.5 text-ink',
          mono ? 'font-mono tracking-[0.2em]' : '',
          error !== undefined ? 'border-danger' : 'border-edge',
          // Full-strength muted, not a faded tint: at 60% opacity this
          // computes to roughly 2.6:1 on the panel, below the 4.5:1 that
          // WCAG 2.2 AA requires. axe caught this.
          'placeholder:text-muted',
        ].join(' ')}
      />
      {hint !== undefined && (
        <p id={hintId} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: 'primary' | 'secondary' | 'danger';
  readonly busy?: boolean;
}

export function Button({
  variant = 'primary',
  busy = false,
  children,
  disabled,
  ...buttonProps
}: ButtonProps): React.JSX.Element {
  const styles: Record<string, string> = {
    primary: 'bg-signal text-white hover:bg-signal-hover',
    secondary: 'border border-edge bg-panel text-ink hover:bg-paper',
    danger: 'border border-danger bg-panel text-danger hover:bg-danger-soft',
  };

  return (
    <button
      {...buttonProps}
      disabled={disabled === true || busy}
      // Announces the pending state to a screen reader, rather than relying on
      // the label changing silently.
      aria-busy={busy || undefined}
      className={`inline-flex w-full items-center justify-center px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${styles[variant] ?? ''}`}
    >
      {busy ? 'Working...' : children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Alert
// ---------------------------------------------------------------------------

export interface AlertProps {
  readonly tone: 'error' | 'success' | 'info';
  readonly children: ReactNode;
}

/**
 * A form-level message.
 *
 * Errors use `role="alert"`, which is an assertive live region, so a failed
 * submission is announced immediately instead of silently changing the page.
 */
export function Alert({ tone, children }: AlertProps): React.JSX.Element {
  const styles: Record<string, string> = {
    error: 'border-danger bg-danger-soft text-danger',
    success: 'border-secure bg-secure-soft text-secure',
    info: 'border-edge bg-paper text-ink',
  };

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`mb-5 border px-3.5 py-3 text-sm ${styles[tone] ?? ''}`}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PasswordStrength
// ---------------------------------------------------------------------------

/**
 * Segmented strength meter.
 *
 * Feedback only, never a gate: blueprint 4.2 gates on length and breach status,
 * and the server is the authority for both. The reading is exposed as text as
 * well as colour, so it does not rely on colour alone.
 */
export function PasswordStrength({ value }: { readonly value: string }): React.JSX.Element | null {
  if (value === '') return null;

  const score = [
    value.length >= 12,
    value.length >= 16,
    value.length >= 20,
    /\d/.test(value),
  ].filter(Boolean).length;
  const labels = ['Weak', 'Fair', 'Good', 'Strong'];
  const label = labels[Math.max(0, score - 1)] ?? 'Weak';

  return (
    <div className="-mt-2 mb-5">
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <span key={index} className={`h-1 flex-1 ${index < score ? 'bg-signal' : 'bg-edge'}`} />
        ))}
      </div>
      <p className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
        Strength: {label}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CodeList - recovery codes
// ---------------------------------------------------------------------------

export function CodeList({ codes }: { readonly codes: readonly string[] }): React.JSX.Element {
  return (
    <ul
      data-testid="recovery-codes"
      className="grid grid-cols-2 gap-x-4 gap-y-2 border border-edge bg-paper p-4 font-mono text-sm"
    >
      {codes.map((code) => (
        <li key={code} className="tracking-wider text-ink">
          {code}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// RoleChip
// ---------------------------------------------------------------------------

/**
 * A role, in the same mono micro-type the auth panels use for eyebrows.
 *
 * Role is the organising fact of the whole workspace surface - it decides what
 * every page shows - so it gets one consistent treatment everywhere it appears
 * rather than being reworded per page. The role name is spelled out, so the
 * colour is reinforcement and never the only carrier of meaning.
 */
export function RoleChip({ role }: { readonly role: WorkspaceRoleName }): React.JSX.Element {
  const tone: Record<WorkspaceRoleName, string> = {
    owner: 'border-signal text-signal',
    admin: 'border-edge text-ink',
    member: 'border-edge text-muted',
  };

  return (
    <span
      data-testid={`role-${role}`}
      className={`border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] ${tone[role]}`}
    >
      {role}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Meter
// ---------------------------------------------------------------------------

export interface MeterProps {
  readonly label: string;
  /** `null` means this is not measured yet - not that the count is zero. */
  readonly used: number | null;
  readonly limit: number;
  /** Where the real number arrives, shown when `used` is null. */
  readonly pending: string;
}

/**
 * One usage meter (blueprint 4.10).
 *
 * A meter with no data draws a dashed empty track and says where the number
 * will come from. Rendering it as a full-looking zero bar would assert that
 * nothing has happened yet, which is a different and currently untrue claim:
 * the thing simply is not counted until a later stage builds it.
 */
export function Meter({ label, used, limit, pending }: MeterProps): React.JSX.Element {
  const measured = used !== null;
  const percent = measured ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm text-ink">{label}</span>
        <span className="font-mono text-xs text-muted">
          {measured ? `${String(used)} / ${String(limit)}` : `— / ${String(limit)}`}
        </span>
      </div>

      {measured ? (
        <div
          role="meter"
          aria-valuenow={used}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-label={label}
          className="mt-2 h-1.5 w-full bg-edge"
        >
          <div className="h-full bg-signal" style={{ width: `${String(percent)}%` }} />
        </div>
      ) : (
        <>
          <div aria-hidden="true" className="mt-2 h-1.5 w-full border border-dashed border-edge" />
          <p className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            {pending}
          </p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WidgetStateChip
// ---------------------------------------------------------------------------

/**
 * A widget's lifecycle state, in the same mono micro-type as `RoleChip`.
 *
 * Published is the only state that gets the signal colour, because it is the
 * only one that means "a visitor can see this right now" - the distinction that
 * matters most on this surface.
 */
export function WidgetStateChip({
  state,
}: {
  readonly state: WidgetLifecycleState;
}): React.JSX.Element {
  const tone: Record<WidgetLifecycleState, string> = {
    published: 'border-secure text-secure',
    draft: 'border-edge text-muted',
    unpublished: 'border-edge text-ink',
    deleted: 'border-danger text-danger',
  };

  return (
    <span
      data-testid={`widget-state-${state}`}
      className={`border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] ${tone[state]}`}
    >
      {state}
    </span>
  );
}

// ---------------------------------------------------------------------------
// CopyField
// ---------------------------------------------------------------------------

/**
 * A read-only value with a copy button - the embed snippet (blueprint 7.2).
 *
 * The value stays visible and selectable in a real read-only input rather than
 * living only behind the button, because clipboard access can be denied by the
 * browser and someone installing a snippet must always be able to select it by
 * hand. The button is a convenience on top, never the only route.
 */
export function CopyField({
  label,
  value,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly testId?: string;
}): React.JSX.Element {
  const id = useId();
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard permission can be refused; the value is still selectable.
      setCopied(false);
    }
  }

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-muted"
      >
        {label}
      </label>
      <div className="flex items-start gap-2">
        <input
          id={id}
          type="text"
          readOnly
          value={value}
          {...(testId === undefined ? {} : { 'data-testid': testId })}
          onFocus={(event) => event.target.select()}
          className="w-full border border-edge bg-paper px-3 py-2 font-mono text-xs text-ink"
        />
        <button
          type="button"
          onClick={() => void copy()}
          className="shrink-0 border border-edge px-3 py-2 text-xs font-medium text-ink hover:bg-paper"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {/* A polite live region, so the confirmation is announced rather than
          only appearing on the button. */}
      <p role="status" className="mt-1.5 text-xs text-secure">
        {copied ? 'Snippet copied to your clipboard.' : ''}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContactStatusChip
// ---------------------------------------------------------------------------

/** The five lead statuses, in the pipeline order blueprint 4.6 lists them. */
const CONTACT_STATUS_LABELS: Record<ContactStatusValue, string> = {
  new: 'new',
  contacted: 'contacted',
  qualified: 'qualified',
  converted: 'converted',
  archived: 'archived',
};

/**
 * A lead's status, in the same mono micro-type as `RoleChip` and
 * `WidgetStateChip`.
 *
 * Unlike those two, these five are a PROGRESSION - new leads to closed business
 * - so the treatment reads along it rather than colouring five unrelated
 * states:
 *
 *   new        signal, because it is the one asking for attention;
 *   contacted  neutral ink, in play;
 *   qualified  secure outline, going well;
 *   converted  the only FILLED chip anywhere in this app, so the outcome that
 *              matters is unmistakable when scanning a long list;
 *   archived   muted, deliberately set aside.
 *
 * The status name is always spelled out, so colour reinforces and never carries
 * the meaning alone.
 */
export function ContactStatusChip({
  status,
}: {
  readonly status: ContactStatusValue;
}): React.JSX.Element {
  const tone: Record<ContactStatusValue, string> = {
    new: 'border-signal text-signal',
    contacted: 'border-edge text-ink',
    qualified: 'border-secure text-secure',
    converted: 'border-secure bg-secure-soft text-secure',
    archived: 'border-edge text-muted',
  };

  return (
    <span
      data-testid={`contact-status-${status}`}
      className={`border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] ${tone[status]}`}
    >
      {CONTACT_STATUS_LABELS[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------

export interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'id' | 'className'
> {
  readonly label: string;
  readonly children: ReactNode;
  /** Hide the label visually but keep it for screen readers and for tests. */
  readonly labelHidden?: boolean;
}

/**
 * A labelled native `select`.
 *
 * The inbox filter set needs nine of these, and repeating the label markup nine
 * times is nine chances for one to lose its `htmlFor`. A native select is the
 * accessible primitive for choosing one of a short list; nothing here replaces
 * its behaviour, it only supplies the label and the house styling.
 */
export function Select({ label, children, ...selectProps }: SelectProps): React.JSX.Element {
  const id = useId();
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-muted"
      >
        {label}
      </label>
      <select
        id={id}
        {...selectProps}
        className="w-full border border-edge bg-panel px-3 py-2 text-sm text-ink"
      >
        {children}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TextArea
// ---------------------------------------------------------------------------

export interface TextAreaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'id' | 'className'
> {
  readonly label: string;
  readonly hint?: string | undefined;
}

export function TextArea({ label, hint, ...textareaProps }: TextAreaProps): React.JSX.Element {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-muted"
      >
        {label}
      </label>
      <textarea
        id={id}
        {...textareaProps}
        aria-describedby={hint === undefined ? undefined : hintId}
        className="w-full border border-edge bg-panel px-3 py-2 text-sm text-ink"
      />
      {hint !== undefined && (
        <p id={hintId} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
