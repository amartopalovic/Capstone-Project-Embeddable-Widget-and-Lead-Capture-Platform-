import { useCallback, useEffect, useState } from 'react';
import {
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUS_VALUES,
  DELIVERY_TYPE_LABELS,
  DELIVERY_TYPE_VALUES,
  type DeliveryHealth,
  type DeliveryStatusValue,
  type DeliverySummary,
  type DeliveryTypeValue,
  type WebhookEndpointSummary,
} from '@lcp/contracts';
import { deliveryApi, type ApiFailure } from '../lib/api.js';
import { useWorkspace } from '../lib/workspace-context.js';
import { Alert, Button, CopyField, Field, Select } from '../components/ui.jsx';

/**
 * Delivery health (blueprint 12.2, 12.3, 12.4, 16.4).
 *
 * The page answers one question - did the leads actually reach anyone? - and
 * the design is organised around the distinction that decides what to do next.
 *
 * **Rejected and gave up are not the same failure.** A permanently rejected
 * delivery was refused on its first attempt and will be refused again; one that
 * gave up spent all five attempts against a receiver that was down, and might
 * well succeed now. Only the second is worth a button. So the two are told
 * apart three times over: by the wording, by the attempt ledger, and by whether
 * the Replay control exists at all.
 *
 * The attempt ledger is this page's signature. Five attempts is a real, finite,
 * countable budget - the one place in this product where a numbered sequence is
 * genuinely the content rather than decoration - so it is drawn as five slots:
 * filled for spent, struck through for the attempts a permanent rejection means
 * will never be spent.
 */

export function DeliveryPage(): React.JSX.Element {
  const { active, capabilities } = useWorkspace();
  const canManage = capabilities.includes('settings.delivery.write');

  const [health, setHealth] = useState<DeliveryHealth | null>(null);
  const [endpoints, setEndpoints] = useState<readonly WebhookEndpointSummary[]>([]);
  const [status, setStatus] = useState<DeliveryStatusValue | ''>('');
  const [type, setType] = useState<DeliveryTypeValue | ''>('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [revealed, setRevealed] = useState<{ secret: string; notice: string } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const params = new URLSearchParams();
    if (status !== '') params.set('status', status);
    if (type !== '') params.set('type', type);
    const query = params.toString();

    const result = await deliveryApi.health(query === '' ? '' : `?${query}`);
    setLoading(false);
    if (!result.ok) {
      setFailure(result);
      return;
    }
    setFailure(null);
    setHealth(result.data);

    if (result.data.canManage) {
      const list = await deliveryApi.webhooks();
      if (list.ok) setEndpoints(list.data.endpoints);
    }
  }, [status, type]);

  useEffect(() => {
    void load();
  }, [load, active.id]);

  async function replay(delivery: DeliverySummary): Promise<void> {
    setNotice(null);
    setFailure(null);
    const result = await deliveryApi.replay(delivery.id);
    if (!result.ok) {
      setFailure(result);
      return;
    }
    setNotice(`Trying ${delivery.target} again. Watch this list for the result.`);
    await load();
  }

  return (
    <main className="mx-auto max-w-4xl px-5 py-12">
      <header className="mb-8 border-b border-edge pb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal">Delivery</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
          Delivery health in {active.name}
        </h1>
        <p className="mt-2 text-sm text-muted">
          What happened to the emails and webhooks your leads triggered. A lead is always saved
          first, so nothing here can lose one.
        </p>
      </header>

      {notice !== null && <Alert tone="success">{notice}</Alert>}
      {failure !== null && <Alert tone="error">{failure.message}</Alert>}

      {revealed !== null && (
        <SecretReveal
          secret={revealed.secret}
          notice={revealed.notice}
          onDone={() => setRevealed(null)}
        />
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading delivery health.</p>
      ) : health === null ? null : (
        <>
          <StatusSummary counts={health.counts} />
          <BudgetPanel budget={health.emailBudget} />

          <section aria-labelledby="deliveries-heading" className="mt-10">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
              <h2 id="deliveries-heading" className="text-lg font-semibold text-ink">
                Recent deliveries
              </h2>
              <div className="flex gap-3">
                <div className="w-44">
                  <Select
                    label="Status"
                    value={status}
                    onChange={(event) => setStatus(event.target.value as DeliveryStatusValue | '')}
                  >
                    <option value="">Any status</option>
                    {DELIVERY_STATUS_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {DELIVERY_STATUS_LABELS[value]}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="w-48">
                  <Select
                    label="Kind"
                    value={type}
                    onChange={(event) => setType(event.target.value as DeliveryTypeValue | '')}
                  >
                    <option value="">Any kind</option>
                    {DELIVERY_TYPE_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {DELIVERY_TYPE_LABELS[value]}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            </div>

            {health.deliveries.length === 0 ? (
              <EmptyState filtered={status !== '' || type !== ''} />
            ) : (
              <ul
                data-testid="delivery-list"
                className="divide-y divide-edge border border-edge bg-panel"
              >
                {health.deliveries.map((delivery) => (
                  <DeliveryRow
                    key={delivery.id}
                    delivery={delivery}
                    canManage={health.canManage}
                    onReplay={() => void replay(delivery)}
                  />
                ))}
              </ul>
            )}
          </section>

          {/*
           * Absent for a Member, not disabled. `delivery.view` is `limited` for
           * them in the section 11 matrix, and the server decides what that
           * means - the UI only reflects the answer it was given.
           */}
          {canManage && health.canManage && (
            <WebhookPanel
              endpoints={endpoints}
              onChanged={load}
              onSecret={(secret, secretNotice) => setRevealed({ secret, notice: secretNotice })}
              onFailure={setFailure}
            />
          )}
        </>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Status summary
// ---------------------------------------------------------------------------

/**
 * The six states, as counts.
 *
 * A per-type breakdown was cut: the list already labels each row's kind, and a
 * second set of numbers nobody acts on is chrome.
 */
function StatusSummary({
  counts,
}: {
  readonly counts: Readonly<Record<DeliveryStatusValue, number>>;
}): React.JSX.Element {
  return (
    <section aria-labelledby="summary-heading">
      <h2 id="summary-heading" className="sr-only">
        Delivery counts by state
      </h2>
      <dl
        data-testid="delivery-summary"
        className="grid grid-cols-2 border border-edge bg-panel sm:grid-cols-3 lg:grid-cols-6"
      >
        {DELIVERY_STATUS_VALUES.map((value) => (
          <div key={value} className="border-b border-r border-edge p-4 last:border-r-0">
            <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              {DELIVERY_STATUS_LABELS[value]}
            </dt>
            <dd
              data-testid={`count-${value}`}
              className={`mt-1 text-xl font-semibold ${
                counts[value] > 0 && (value === 'dead_letter' || value === 'failed')
                  ? 'text-danger'
                  : 'text-ink'
              }`}
            >
              {counts[value]}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Email budget
// ---------------------------------------------------------------------------

/**
 * The Brevo daily allowance (blueprint 5.3).
 *
 * Drawn as a segmented track rather than one percentage bar, because the
 * allowance has STRUCTURE and a single bar would misrepresent it: 300 a day,
 * of which 100 are reserved for authentication and privacy mail that lead
 * notifications may never touch. The reserved portion is drawn as a dashed
 * segment - present, accounted for, and not yours - so "why did my
 * notification stop at 200" is answered by looking rather than by reading docs.
 */
function BudgetPanel({
  budget,
}: {
  readonly budget: DeliveryHealth['emailBudget'];
}): React.JSX.Element {
  const used = Math.min(budget.sideEffectUsedToday, budget.sideEffectLimit);
  const usedPercent = Math.round((used / budget.dailyLimit) * 100);
  const capPercent = Math.round((budget.sideEffectLimit / budget.dailyLimit) * 100);
  const spent = budget.sideEffectUsedToday >= budget.sideEffectLimit;

  return (
    <section aria-labelledby="budget-heading" className="mt-6 border border-edge bg-panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="budget-heading" className="text-sm font-medium text-ink">
          Email allowance today
        </h2>
        <p className="font-mono text-xs text-muted">
          {budget.sideEffectUsedToday} / {budget.sideEffectLimit} used for notifications
        </p>
      </div>

      <div
        role="meter"
        aria-valuenow={budget.sideEffectUsedToday}
        aria-valuemin={0}
        aria-valuemax={budget.sideEffectLimit}
        aria-label="Notification email allowance used today"
        className="mt-3 flex h-2 w-full overflow-hidden bg-edge"
      >
        <div
          className={spent ? 'h-full bg-danger' : 'h-full bg-signal'}
          style={{ width: `${String(usedPercent)}%` }}
        />
        <div className="h-full flex-1" style={{ width: `${String(capPercent - usedPercent)}%` }} />
        {/* The reserved third, which notifications can never draw on. */}
        <div
          aria-hidden="true"
          className="h-full border-l border-edge bg-paper"
          style={{ width: `${String(100 - capPercent)}%` }}
        />
      </div>

      <p className="mt-2 text-xs text-muted">
        {spent
          ? 'Today’s notification allowance is spent. Anything queued now sends when the allowance resets at midnight UTC — nothing is lost.'
          : `${String(budget.dailyLimit - budget.sideEffectLimit)} of the ${String(budget.dailyLimit)} daily messages are reserved for sign-in and privacy email, so notifications stop at ${String(budget.sideEffectLimit)}.`}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Delivery row
// ---------------------------------------------------------------------------

/**
 * The attempt ledger - this page's one distinctive element.
 *
 * Five slots, because blueprint 12.2 gives a transient failure exactly five
 * attempts. Filled means spent. On a PERMANENTLY rejected delivery the
 * remaining four are struck through, because they will never be spent: the
 * receiver said no, and saying it again would change nothing. That single
 * difference is what separates "gave up, try again" from "rejected, fix the
 * address" at a glance, before any words are read.
 */
function AttemptLedger({
  attempts,
  maxAttempts,
  permanent,
}: {
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly permanent: boolean;
}): React.JSX.Element {
  const slots = Array.from({ length: maxAttempts }, (_, index) => index < attempts);
  const label = permanent
    ? `Rejected on attempt ${String(attempts)}; the remaining attempts were never used`
    : `${String(attempts)} of ${String(maxAttempts)} attempts used`;

  return (
    <span className="inline-flex items-center gap-1" title={label}>
      <span className="sr-only">{label}</span>
      {slots.map((spent, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={[
            'block h-1.5 w-4',
            spent ? (permanent ? 'bg-danger' : 'bg-ink') : 'bg-edge',
            // A slot that will never be spent is struck through rather than
            // simply empty - empty would read as "still to come".
            !spent && permanent
              ? 'relative after:absolute after:inset-x-0 after:top-1/2 after:h-px after:bg-danger'
              : '',
          ].join(' ')}
        />
      ))}
    </span>
  );
}

function DeliveryStatusChip({
  status,
}: {
  readonly status: DeliveryStatusValue;
}): React.JSX.Element {
  /**
   * No filled chip here on purpose.
   *
   * `converted` in the contact inbox is the only filled chip in this product,
   * and a second one would dilute what filling means. A dead letter is told
   * apart from a rejection by its wording, its ledger, and the presence of the
   * Replay button - three signals, none of which need to borrow that one.
   */
  const tone: Record<DeliveryStatusValue, string> = {
    queued: 'border-edge text-muted',
    delayed: 'border-edge text-ink',
    retrying: 'border-signal text-signal',
    delivered: 'border-secure text-secure',
    failed: 'border-danger text-danger',
    dead_letter: 'border-danger text-danger',
  };

  return (
    <span
      data-testid={`delivery-status-${status}`}
      className={`border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] ${tone[status]}`}
    >
      {DELIVERY_STATUS_LABELS[status]}
    </span>
  );
}

function DeliveryRow({
  delivery,
  canManage,
  onReplay,
}: {
  readonly delivery: DeliverySummary;
  readonly canManage: boolean;
  readonly onReplay: () => void;
}): React.JSX.Element {
  const permanent = delivery.status === 'failed';

  return (
    <li className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              {DELIVERY_TYPE_LABELS[delivery.type]}
            </span>
            <DeliveryStatusChip status={delivery.status} />
          </p>
          <p className="mt-1 font-mono text-sm text-ink">{delivery.target}</p>
          {delivery.lastError !== null && delivery.status !== 'delivered' && (
            <p className="mt-1 text-sm text-muted">{delivery.lastError}</p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <AttemptLedger
            attempts={delivery.attempts}
            maxAttempts={delivery.maxAttempts}
            permanent={permanent}
          />
          {/*
           * The button exists only for a dead letter, and only for somebody who
           * may manage delivery. `canReplay` is decided by the SERVER; the UI
           * never works it out from the status string.
           */}
          {delivery.canReplay && canManage && (
            <button
              type="button"
              data-testid={`replay-${delivery.id}`}
              onClick={onReplay}
              className="border border-signal px-3 py-1.5 text-xs font-medium text-signal hover:bg-paper"
            >
              Try again
            </button>
          )}
        </div>
      </div>

      {delivery.history.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer list-none font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            {delivery.history.length === 1
              ? '1 attempt'
              : `${String(delivery.history.length)} attempts`}
          </summary>
          <ol className="mt-2 border-l border-edge pl-4">
            {delivery.history.map((attempt) => (
              <li key={attempt.attempt} className="mb-2">
                <p className="font-mono text-[11px] text-muted">
                  <time dateTime={attempt.at}>{new Date(attempt.at).toLocaleString()}</time>
                  {' · '}
                  {attempt.outcome.replace(/_/g, ' ')}
                  {attempt.statusCode !== null && ` · ${String(attempt.statusCode)}`}
                </p>
                <p className="text-sm text-ink">{attempt.detail}</p>
              </li>
            ))}
          </ol>
        </details>
      )}
    </li>
  );
}

function EmptyState({ filtered }: { readonly filtered: boolean }): React.JSX.Element {
  return (
    <div
      data-testid="delivery-empty"
      className="border border-edge bg-panel px-5 py-10 text-center"
    >
      {filtered ? (
        <>
          <p className="text-sm font-medium text-ink">Nothing matches this filter.</p>
          <p className="mt-1.5 text-sm text-muted">Choose “Any status” to see everything.</p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-ink">No deliveries yet.</p>
          <p className="mt-1.5 text-sm text-muted">
            Add a notification recipient or a webhook to a widget, and the next lead will show up
            here.
          </p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One-time secret reveal
// ---------------------------------------------------------------------------

/**
 * The highest-stakes moment on this page.
 *
 * The secret is shown once and cannot be retrieved afterwards, so the panel
 * says so before the value, gives a real copy control, and is dismissed by a
 * deliberate press rather than by clicking away. It wears the mount bracket -
 * the product's signature - because this is literally the artifact being handed
 * over to be installed in somebody else's system, which is what that mark has
 * meant everywhere else it appears.
 */
function SecretReveal({
  secret,
  notice,
  onDone,
}: {
  readonly secret: string;
  readonly notice: string;
  readonly onDone: () => void;
}): React.JSX.Element {
  return (
    <section
      data-testid="secret-reveal"
      aria-labelledby="secret-heading"
      className="relative mb-6 border border-signal bg-panel p-5"
    >
      <div aria-hidden="true" className="pointer-events-none absolute -inset-2">
        {[
          'left-0 top-0 border-l border-t',
          'right-0 top-0 border-r border-t',
          'bottom-0 left-0 border-b border-l',
          'bottom-0 right-0 border-b border-r',
        ].map((position) => (
          <span key={position} className={`absolute h-3 w-3 border-signal/45 ${position}`} />
        ))}
      </div>

      <h2 id="secret-heading" className="text-sm font-semibold text-ink">
        Copy your signing secret now
      </h2>
      <p className="mt-1.5 text-sm text-muted">{notice}</p>

      <div className="mt-4">
        <CopyField label="Signing secret" value={secret} testId="webhook-secret" />
      </div>

      <p className="mt-4">
        <button
          type="button"
          data-testid="secret-done"
          onClick={onDone}
          className="border border-edge px-3 py-2 text-sm text-ink hover:bg-paper"
        >
          I have copied it
        </button>
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Webhook endpoints
// ---------------------------------------------------------------------------

function WebhookPanel({
  endpoints,
  onChanged,
  onSecret,
  onFailure,
}: {
  readonly endpoints: readonly WebhookEndpointSummary[];
  readonly onChanged: () => Promise<void>;
  readonly onSecret: (secret: string, notice: string) => void;
  readonly onFailure: (failure: ApiFailure) => void;
}): React.JSX.Element {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [urlError, setUrlError] = useState<string | undefined>(undefined);

  async function add(): Promise<void> {
    setBusy(true);
    setUrlError(undefined);
    const result = await deliveryApi.createWebhook(url.trim(), null);
    setBusy(false);
    if (!result.ok) {
      // The server names which class of address it refused, and that message is
      // shown on the field rather than as a generic banner.
      setUrlError(
        result.fieldErrors.find((error) => error.path === 'url')?.message ?? result.message,
      );
      return;
    }
    setUrl('');
    onSecret(result.data.secret, result.data.notice);
    await onChanged();
  }

  async function rotate(endpoint: WebhookEndpointSummary): Promise<void> {
    const result = await deliveryApi.rotateWebhook(endpoint.id);
    if (!result.ok) {
      onFailure(result);
      return;
    }
    onSecret(result.data.secret, result.data.notice);
    await onChanged();
  }

  return (
    <section aria-labelledby="webhooks-heading" className="mt-12">
      <h2 id="webhooks-heading" className="text-lg font-semibold text-ink">
        Webhooks
      </h2>
      <p className="mt-1.5 text-sm text-muted">
        Send every new lead to your own system. Each request is signed, so you can prove it came
        from us.
      </p>

      {endpoints.length === 0 ? (
        <p data-testid="webhooks-empty" className="mt-4 text-sm text-muted">
          No webhooks yet.
        </p>
      ) : (
        <ul
          data-testid="webhook-list"
          className="mt-4 divide-y divide-edge border border-edge bg-panel"
        >
          {endpoints.map((endpoint) => (
            <li
              key={endpoint.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 p-4"
            >
              <div className="min-w-0">
                <p className="break-all font-mono text-sm text-ink">{endpoint.url}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                  <span
                    className={`border px-1.5 py-0.5 ${endpoint.enabled ? 'border-secure text-secure' : 'border-edge text-muted'}`}
                  >
                    {endpoint.enabled ? 'on' : 'off'}
                  </span>
                  <span>secret v{endpoint.secretVersion}</span>
                  {endpoint.rotationInProgress && (
                    /*
                     * The overlap window is stated, because it is the only
                     * thing standing between a rotation and a receiver that
                     * silently starts rejecting payloads.
                     */
                    <span className="border border-signal px-1.5 py-0.5 text-signal">
                      old secret works until{' '}
                      {new Date(endpoint.previousSecretRetiresAt ?? '').toLocaleString()}
                    </span>
                  )}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void rotate(endpoint)}
                  className="border border-edge px-3 py-1.5 text-xs text-ink hover:bg-paper"
                >
                  Rotate secret
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void (async () => {
                      await deliveryApi.setWebhookEnabled(endpoint.id, !endpoint.enabled);
                      await onChanged();
                    })();
                  }}
                  className="border border-edge px-3 py-1.5 text-xs text-ink hover:bg-paper"
                >
                  {endpoint.enabled ? 'Turn off' : 'Turn on'}
                </button>
                <button
                  type="button"
                  data-testid={`delete-webhook-${endpoint.id}`}
                  onClick={() => {
                    void (async () => {
                      await deliveryApi.deleteWebhook(endpoint.id);
                      await onChanged();
                    })();
                  }}
                  className="border border-danger px-3 py-1.5 text-xs text-danger hover:bg-danger-soft"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
        className="mt-6 max-w-xl"
      >
        <Field
          label="Endpoint URL"
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com/hooks/leads"
          error={urlError}
          hint="Must be https, and must be reachable from the public internet."
        />
        <Button type="submit" busy={busy} disabled={url.trim() === ''}>
          Add webhook
        </Button>
      </form>
    </section>
  );
}
