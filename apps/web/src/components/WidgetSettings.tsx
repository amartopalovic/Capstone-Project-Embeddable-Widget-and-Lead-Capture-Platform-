import { useId, type ReactNode } from 'react';
import {
  BORDER_RADII,
  BUTTON_STYLES,
  FONT_FAMILIES,
  FONT_SIZES,
  FORM_MODES,
  SPACING_SCALES,
  TRIGGER_TYPES,
  WIDGET_FIELD_MAX_LENGTH,
  WIDGET_FIELD_TYPES,
  collectsSubmissions,
  mandatoryFieldsFor,
  type ApiFieldError,
  type WidgetConfig,
  type WidgetField,
  type WidgetFieldType,
  type WidgetTrigger,
  type WidgetType,
} from '@lcp/contracts';

/**
 * The widget settings form (blueprint 4.3, 4.4, 4.5).
 *
 * Every control here edits one property of the draft configuration and hands
 * the whole updated object back, so the preview beside it always renders the
 * exact object that will be sent to the server - there is no separate
 * "preview model" that could drift from what gets saved.
 *
 * Two things this form deliberately does NOT do: decide whether a
 * configuration is valid (the server answers that, and its field errors are
 * rendered against the matching control), and invent a rule of its own. The
 * one rule it enforces locally - which fields may be removed - is read from
 * `mandatoryFieldsFor` in the shared contracts package, the same function the
 * API validates with.
 */

export interface WidgetSettingsProps {
  readonly type: WidgetType;
  readonly config: WidgetConfig;
  readonly errors: readonly ApiFieldError[];
  readonly disabled: boolean;
  readonly onChange: (next: WidgetConfig) => void;
}

/** Pull the server's message for one config path, if it sent one. */
function errorFor(errors: readonly ApiFieldError[], path: string): string | undefined {
  return errors.find((error) => error.path === path || error.path === `config.${path}`)?.message;
}

export function WidgetSettings({
  type,
  config,
  errors,
  disabled,
  onChange,
}: WidgetSettingsProps): React.JSX.Element {
  const patch = (partial: Partial<WidgetConfig>): void => onChange({ ...config, ...partial });
  const showsFields = collectsSubmissions(type, config);

  return (
    <div className="space-y-8">
      <Section title="Content" hint="What someone reads when the widget opens.">
        <TextInput
          label="Headline"
          value={config.headline}
          disabled={disabled}
          error={errorFor(errors, 'headline')}
          onChange={(headline) => patch({ headline })}
        />
        <TextArea
          label="Body"
          value={config.body}
          disabled={disabled}
          hint="Optional. One or two lines of context."
          onChange={(body) => patch({ body })}
        />
        <TextInput
          label="Button label"
          value={config.submitLabel}
          disabled={disabled}
          error={errorFor(errors, 'submitLabel')}
          onChange={(submitLabel) => patch({ submitLabel })}
        />
      </Section>

      {showsFields && (
        <FieldsSection
          type={type}
          config={config}
          errors={errors}
          disabled={disabled}
          onChange={onChange}
        />
      )}

      <Section title="Appearance" hint="Colours and type. No custom CSS is accepted.">
        <div className="grid gap-4 sm:grid-cols-3">
          <ColorInput
            label="Accent"
            value={config.appearance.primaryColor}
            disabled={disabled}
            onChange={(primaryColor) =>
              patch({ appearance: { ...config.appearance, primaryColor } })
            }
          />
          <ColorInput
            label="Background"
            value={config.appearance.backgroundColor}
            disabled={disabled}
            onChange={(backgroundColor) =>
              patch({ appearance: { ...config.appearance, backgroundColor } })
            }
          />
          <ColorInput
            label="Text"
            value={config.appearance.textColor}
            disabled={disabled}
            onChange={(textColor) => patch({ appearance: { ...config.appearance, textColor } })}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectInput
            label="Typeface"
            value={config.appearance.fontFamily}
            options={FONT_FAMILIES}
            disabled={disabled}
            onChange={(fontFamily) =>
              patch({
                appearance: {
                  ...config.appearance,
                  fontFamily: fontFamily as WidgetConfig['appearance']['fontFamily'],
                },
              })
            }
          />
          <SelectInput
            label="Text size"
            value={config.appearance.fontSize}
            options={FONT_SIZES}
            disabled={disabled}
            onChange={(fontSize) =>
              patch({
                appearance: {
                  ...config.appearance,
                  fontSize: fontSize as WidgetConfig['appearance']['fontSize'],
                },
              })
            }
          />
          <SelectInput
            label="Spacing"
            value={config.appearance.spacing}
            options={SPACING_SCALES}
            disabled={disabled}
            onChange={(spacing) =>
              patch({
                appearance: {
                  ...config.appearance,
                  spacing: spacing as WidgetConfig['appearance']['spacing'],
                },
              })
            }
          />
          <SelectInput
            label="Corner rounding"
            value={config.appearance.borderRadius}
            options={BORDER_RADII}
            disabled={disabled}
            onChange={(borderRadius) =>
              patch({
                appearance: {
                  ...config.appearance,
                  borderRadius: borderRadius as WidgetConfig['appearance']['borderRadius'],
                },
              })
            }
          />
          <SelectInput
            label="Button style"
            value={config.appearance.buttonStyle}
            options={BUTTON_STYLES}
            disabled={disabled}
            onChange={(buttonStyle) =>
              patch({
                appearance: {
                  ...config.appearance,
                  buttonStyle: buttonStyle as WidgetConfig['appearance']['buttonStyle'],
                },
              })
            }
          />
        </div>
      </Section>

      <Section title="How it opens" hint="When the widget appears to a visitor.">
        {type !== 'cta_popover' && (
          <SelectInput
            label="Display"
            value={config.formMode}
            options={FORM_MODES}
            disabled={disabled}
            error={errorFor(errors, 'formMode')}
            onChange={(formMode) => patch({ formMode: formMode as WidgetConfig['formMode'] })}
          />
        )}

        <fieldset className="border-0 p-0">
          <legend className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            Triggers
          </legend>
          {errorFor(errors, 'triggers') !== undefined && (
            <p className="mb-2 text-xs font-medium text-danger">{errorFor(errors, 'triggers')}</p>
          )}
          <div className="space-y-2">
            {TRIGGER_TYPES.map((triggerType) => {
              const active = config.triggers.find((trigger) => trigger.type === triggerType);
              return (
                <TriggerRow
                  key={triggerType}
                  triggerType={triggerType}
                  trigger={active}
                  disabled={disabled}
                  onToggle={(checked) => {
                    const without = config.triggers.filter((t) => t.type !== triggerType);
                    if (!checked) {
                      patch({ triggers: without });
                      return;
                    }
                    patch({ triggers: [...without, defaultTrigger(triggerType)] });
                  }}
                  onUpdate={(updated) =>
                    patch({
                      triggers: config.triggers.map((t) => (t.type === triggerType ? updated : t)),
                    })
                  }
                />
              );
            })}
          </div>
        </fieldset>

        {type === 'cta_popover' && (
          <div className="space-y-3 border-t border-edge pt-4">
            <SelectInput
              label="Button action"
              value={config.ctaAction.kind}
              options={['lead_form', 'external_url'] as const}
              disabled={disabled}
              onChange={(kind) =>
                patch({
                  ctaAction:
                    kind === 'lead_form'
                      ? { kind: 'lead_form' }
                      : { kind: 'external_url', url: '' },
                })
              }
            />
            {config.ctaAction.kind === 'external_url' && (
              <TextInput
                label="Destination"
                value={config.ctaAction.url}
                disabled={disabled}
                hint="A full https:// address."
                error={errorFor(errors, 'ctaAction.url')}
                onChange={(url) => patch({ ctaAction: { kind: 'external_url', url } })}
              />
            )}
          </div>
        )}
      </Section>

      <Section title="After a submission" hint="What happens once someone sends the form.">
        <SelectInput
          label="Outcome"
          value={config.success.kind}
          options={['message', 'redirect'] as const}
          disabled={disabled}
          onChange={(kind) =>
            patch({
              success:
                kind === 'message'
                  ? { kind: 'message', message: 'Thanks - we will be in touch shortly.' }
                  : { kind: 'redirect', url: '' },
            })
          }
        />
        {config.success.kind === 'message' ? (
          <TextArea
            label="Message"
            value={config.success.message}
            disabled={disabled}
            error={errorFor(errors, 'success.message')}
            onChange={(message) => patch({ success: { kind: 'message', message } })}
          />
        ) : (
          <TextInput
            label="Redirect to"
            value={config.success.url}
            disabled={disabled}
            hint="A full https:// address."
            error={errorFor(errors, 'success.url')}
            onChange={(url) => patch({ success: { kind: 'redirect', url } })}
          />
        )}
      </Section>

      <Section
        title="Where it runs"
        hint="A widget only loads on domains you list here. One is required before publishing."
      >
        <ListInput
          label="Allowed domains"
          values={config.targeting.allowedDomains}
          placeholder="example.com or *.example.com"
          disabled={disabled}
          testId="allowed-domains"
          hint="A wildcard does not include the bare domain: list example.com as well if you need it."
          error={errorFor(errors, 'targeting.allowedDomains')}
          onChange={(allowedDomains) =>
            patch({ targeting: { ...config.targeting, allowedDomains } })
          }
        />
        <ListInput
          label="Only on these pages"
          values={config.targeting.includePatterns}
          placeholder="/pricing or /blog/**"
          disabled={disabled}
          testId="include-patterns"
          hint="Leave empty to run everywhere on the allowed domains."
          onChange={(includePatterns) =>
            patch({ targeting: { ...config.targeting, includePatterns } })
          }
        />
        <ListInput
          label="Never on these pages"
          values={config.targeting.excludePatterns}
          placeholder="/checkout/**"
          disabled={disabled}
          testId="exclude-patterns"
          onChange={(excludePatterns) =>
            patch({ targeting: { ...config.targeting, excludePatterns } })
          }
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectInput
            label="Show again"
            value={config.targeting.cooldown.kind}
            options={['session', 'days'] as const}
            disabled={disabled}
            onChange={(kind) =>
              patch({
                targeting: {
                  ...config.targeting,
                  cooldown: kind === 'session' ? { kind: 'session' } : { kind: 'days', days: 7 },
                },
              })
            }
          />
          {config.targeting.cooldown.kind === 'days' && (
            <NumberInput
              label="Days between appearances"
              value={config.targeting.cooldown.days}
              min={1}
              max={365}
              disabled={disabled}
              onChange={(days) =>
                patch({ targeting: { ...config.targeting, cooldown: { kind: 'days', days } } })
              }
            />
          )}
        </div>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

function FieldsSection({
  type,
  config,
  errors,
  disabled,
  onChange,
}: WidgetSettingsProps): React.JSX.Element {
  const locked = new Set<WidgetFieldType>(mandatoryFieldsFor(type, config));
  const ordered = [...config.fields].sort((a, b) => a.order - b.order);
  const present = new Set(ordered.map((field) => field.type));
  const available = WIDGET_FIELD_TYPES.filter((fieldType) => !present.has(fieldType));

  /** Rewrite `order` from array position, so it is always 0..n-1 with no gaps. */
  const commit = (fields: readonly WidgetField[]): void =>
    onChange({ ...config, fields: fields.map((field, index) => ({ ...field, order: index })) });

  const move = (index: number, delta: number): void => {
    const next = [...ordered];
    const target = index + delta;
    const moving = next[index];
    const displaced = next[target];
    if (moving === undefined || displaced === undefined) return;
    next[index] = displaced;
    next[target] = moving;
    commit(next);
  };

  return (
    <Section
      title="Fields"
      hint="Add, remove, and reorder what the form asks for. Some fields cannot be removed."
    >
      {errorFor(errors, 'fields') !== undefined && (
        <p className="text-xs font-medium text-danger">{errorFor(errors, 'fields')}</p>
      )}

      <ul data-testid="field-list" className="divide-y divide-edge border border-edge bg-panel">
        {ordered.map((field, index) => (
          <li key={field.type} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-medium text-ink">
                {/*
                 * Position is real information here - field order is a setting
                 * the creator controls and the visitor sees - so it is shown,
                 * not decorated.
                 */}
                <span className="font-mono text-[11px] text-muted">
                  {String(index + 1).padStart(2, '0')}
                </span>
                {field.type}
                {locked.has(field.type) && (
                  <span className="border border-edge px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                    required
                  </span>
                )}
              </p>

              <div className="flex items-center gap-1">
                <IconButton
                  label={`Move ${field.type} earlier`}
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                >
                  &uarr;
                </IconButton>
                <IconButton
                  label={`Move ${field.type} later`}
                  disabled={disabled || index === ordered.length - 1}
                  onClick={() => move(index, 1)}
                >
                  &darr;
                </IconButton>
                {/*
                 * A locked field gets no remove control at all rather than a
                 * disabled one: the server would refuse it, and offering a
                 * button that always fails is the defect 4b set out to avoid.
                 */}
                {!locked.has(field.type) && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => commit(ordered.filter((candidate) => candidate !== field))}
                    className="border border-edge px-2 py-1 text-xs font-medium text-ink hover:bg-paper disabled:opacity-55"
                  >
                    Remove
                    <span className="sr-only"> the {field.type} field</span>
                  </button>
                )}
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <TextInput
                label="Label"
                value={field.label}
                disabled={disabled}
                onChange={(label) =>
                  commit(ordered.map((c) => (c === field ? { ...c, label } : c)))
                }
              />
              <TextInput
                label="Placeholder"
                value={field.placeholder}
                disabled={disabled}
                onChange={(placeholder) =>
                  commit(ordered.map((c) => (c === field ? { ...c, placeholder } : c)))
                }
              />
              <TextInput
                label="Help text"
                value={field.helpText}
                disabled={disabled}
                onChange={(helpText) =>
                  commit(ordered.map((c) => (c === field ? { ...c, helpText } : c)))
                }
              />
              <NumberInput
                label="Maximum length"
                value={field.maxLength}
                min={1}
                max={WIDGET_FIELD_MAX_LENGTH}
                disabled={disabled}
                onChange={(maxLength) =>
                  commit(ordered.map((c) => (c === field ? { ...c, maxLength } : c)))
                }
              />
              <Checkbox
                label="Required"
                checked={field.required}
                // A mandatory field cannot be made optional either; the server
                // enforces the same rule.
                disabled={disabled || locked.has(field.type)}
                onChange={(required) =>
                  commit(ordered.map((c) => (c === field ? { ...c, required } : c)))
                }
              />
            </div>
          </li>
        ))}
      </ul>

      {available.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <SelectInput
            label="Add a field"
            value=""
            options={available}
            placeholderOption="Choose a field"
            disabled={disabled}
            testId="add-field"
            onChange={(fieldType) => {
              if (fieldType === '') return;
              commit([...ordered, newField(fieldType as WidgetFieldType, ordered.length)]);
            }}
          />
        </div>
      )}
    </Section>
  );
}

function newField(type: WidgetFieldType, order: number): WidgetField {
  return {
    type,
    label: type.charAt(0).toUpperCase() + type.slice(1),
    placeholder: '',
    helpText: '',
    required: false,
    maxLength: type === 'message' ? 2000 : 120,
    order,
  };
}

function defaultTrigger(type: (typeof TRIGGER_TYPES)[number]): WidgetTrigger {
  switch (type) {
    case 'delay':
      return { type: 'delay', delaySeconds: 10 };
    case 'scroll_depth':
      return { type: 'scroll_depth', percent: 50 };
    case 'click':
      return { type: 'click' };
    case 'exit_intent':
      return { type: 'exit_intent' };
  }
}

const TRIGGER_LABELS: Record<(typeof TRIGGER_TYPES)[number], string> = {
  click: 'When someone clicks',
  delay: 'After a delay',
  scroll_depth: 'After scrolling',
  exit_intent: 'When they move to leave',
};

interface TriggerRowProps {
  readonly triggerType: (typeof TRIGGER_TYPES)[number];
  readonly trigger: WidgetTrigger | undefined;
  readonly disabled: boolean;
  readonly onToggle: (checked: boolean) => void;
  readonly onUpdate: (trigger: WidgetTrigger) => void;
}

function TriggerRow({
  triggerType,
  trigger,
  disabled,
  onToggle,
  onUpdate,
}: TriggerRowProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Checkbox
        label={TRIGGER_LABELS[triggerType]}
        checked={trigger !== undefined}
        disabled={disabled}
        onChange={onToggle}
      />
      {trigger?.type === 'delay' && (
        <NumberInput
          label="Seconds"
          value={trigger.delaySeconds}
          min={0}
          max={600}
          disabled={disabled}
          compact
          onChange={(delaySeconds) => onUpdate({ type: 'delay', delaySeconds })}
        />
      )}
      {trigger?.type === 'scroll_depth' && (
        <NumberInput
          label="Percent"
          value={trigger.percent}
          min={1}
          max={100}
          disabled={disabled}
          compact
          onChange={(percent) => onUpdate({ type: 'scroll_depth', percent })}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small native-element inputs
// ---------------------------------------------------------------------------

function Section({
  title,
  hint,
  children,
}: {
  readonly title: string;
  readonly hint: string;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <fieldset className="border-0 p-0">
      <legend className="text-base font-semibold text-ink">{title}</legend>
      <p className="mb-4 mt-1 text-sm text-muted">{hint}</p>
      <div className="space-y-4">{children}</div>
    </fieldset>
  );
}

const LABEL = 'mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-muted';
const CONTROL = 'w-full border border-edge bg-panel px-3 py-2 text-sm text-ink disabled:opacity-55';

interface BaseInputProps {
  readonly label: string;
  readonly disabled: boolean;
  readonly hint?: string;
  readonly error?: string | undefined;
}

function TextInput({
  label,
  value,
  disabled,
  hint,
  error,
  onChange,
}: BaseInputProps & {
  readonly value: string;
  readonly onChange: (value: string) => void;
}): React.JSX.Element {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        disabled={disabled}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={hint !== undefined || error !== undefined ? `${id}-note` : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={`${CONTROL} ${error !== undefined ? 'border-danger' : ''}`}
      />
      {(hint !== undefined || error !== undefined) && (
        <p
          id={`${id}-note`}
          className={`mt-1.5 text-xs ${error !== undefined ? 'font-medium text-danger' : 'text-muted'}`}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

function TextArea({
  label,
  value,
  disabled,
  hint,
  error,
  onChange,
}: BaseInputProps & {
  readonly value: string;
  readonly onChange: (value: string) => void;
}): React.JSX.Element {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <textarea
        id={id}
        rows={2}
        value={value}
        disabled={disabled}
        aria-invalid={error !== undefined || undefined}
        onChange={(event) => onChange(event.target.value)}
        className={`${CONTROL} ${error !== undefined ? 'border-danger' : ''}`}
      />
      {(hint !== undefined || error !== undefined) && (
        <p
          className={`mt-1.5 text-xs ${error !== undefined ? 'font-medium text-danger' : 'text-muted'}`}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

function NumberInput({
  label,
  value,
  min,
  max,
  disabled,
  compact = false,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly disabled: boolean;
  readonly compact?: boolean;
  readonly onChange: (value: number) => void;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className={compact ? 'w-32' : undefined}>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const parsed = Number.parseInt(event.target.value, 10);
          if (!Number.isNaN(parsed)) onChange(parsed);
        }}
        className={CONTROL}
      />
    </div>
  );
}

function ColorInput({
  label,
  value,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}): React.JSX.Element {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        {/*
         * A native colour input plus the hex beside it. The text field is what
         * makes the value checkable and pasteable; the swatch is what makes it
         * choosable. Only hex is ever accepted - blueprint 4.3 allows no
         * free-form style value.
         */}
        <input
          id={id}
          type="color"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-12 shrink-0 border border-edge bg-panel disabled:opacity-55"
        />
        <input
          type="text"
          aria-label={`${label} hex value`}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={`${CONTROL} font-mono`}
        />
      </div>
    </div>
  );
}

function SelectInput({
  label,
  value,
  options,
  disabled,
  error,
  placeholderOption,
  testId,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly string[];
  readonly disabled: boolean;
  readonly error?: string | undefined;
  readonly placeholderOption?: string;
  readonly testId?: string;
  readonly onChange: (value: string) => void;
}): React.JSX.Element {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-invalid={error !== undefined || undefined}
        onChange={(event) => onChange(event.target.value)}
        {...(testId === undefined ? {} : { 'data-testid': testId })}
        className={`${CONTROL} ${error !== undefined ? 'border-danger' : ''}`}
      >
        {placeholderOption !== undefined && <option value="">{placeholderOption}</option>}
        {options.map((option) => (
          <option key={option} value={option}>
            {humanize(option)}
          </option>
        ))}
      </select>
      {error !== undefined && <p className="mt-1.5 text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}

function Checkbox({
  label,
  checked,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 shrink-0 accent-signal disabled:opacity-55"
      />
      <label htmlFor={id} className="text-sm text-ink">
        {label}
      </label>
    </div>
  );
}

/**
 * A short list of short strings - domains and page patterns.
 *
 * One input per line plus an add button, rather than a comma-separated box:
 * each entry gets its own validation message and its own remove control, and
 * nobody has to guess the separator.
 */
function ListInput({
  label,
  values,
  placeholder,
  disabled,
  hint,
  error,
  testId,
  onChange,
}: BaseInputProps & {
  readonly values: readonly string[];
  readonly placeholder: string;
  readonly testId: string;
  /** Mutable, to match the array types Zod infers for the config. */
  readonly onChange: (values: string[]) => void;
}): React.JSX.Element {
  const id = useId();
  return (
    <div>
      <span className={LABEL} id={`${id}-label`}>
        {label}
      </span>
      <ul data-testid={testId} className="space-y-2">
        {values.map((value, index) => (
          <li key={index} className="flex items-center gap-2">
            <input
              type="text"
              value={value}
              disabled={disabled}
              placeholder={placeholder}
              aria-label={`${label} ${String(index + 1)}`}
              onChange={(event) =>
                onChange(values.map((current, i) => (i === index ? event.target.value : current)))
              }
              className={`${CONTROL} ${error !== undefined ? 'border-danger' : ''}`}
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(values.filter((_, i) => i !== index))}
              className="shrink-0 border border-edge px-2 py-2 text-xs font-medium text-ink hover:bg-paper disabled:opacity-55"
            >
              Remove
              <span className="sr-only">
                {' '}
                {label} {index + 1}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([...values, ''])}
        className="mt-2 border border-edge px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper disabled:opacity-55"
      >
        Add {label.toLowerCase()}
      </button>

      {(hint !== undefined || error !== undefined) && (
        <p
          className={`mt-1.5 text-xs ${error !== undefined ? 'font-medium text-danger' : 'text-muted'}`}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  readonly label: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="border border-edge px-2 py-1 text-xs text-ink hover:bg-paper disabled:opacity-40"
    >
      <span aria-hidden="true">{children}</span>
      <span className="sr-only">{label}</span>
    </button>
  );
}

function humanize(value: string): string {
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
