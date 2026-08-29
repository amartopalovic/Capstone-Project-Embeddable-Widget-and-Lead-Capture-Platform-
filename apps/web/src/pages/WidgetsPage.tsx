import { useCallback, useEffect, useState, type SubmitEvent } from 'react';
import { Link } from 'react-router';
import { WIDGET_TYPES, type WidgetSummary, type WidgetType } from '@lcp/contracts';
import { fieldError, widgetApi, type ApiFailure } from '../lib/api.js';
import { useWorkspace } from '../lib/workspace-context.js';
import { Alert, Button, Field, WidgetStateChip } from '../components/ui.jsx';

/**
 * The widget list (blueprint 4.3, 4.5).
 *
 * Creating a widget is the first thing anyone does here, so the empty state is
 * the create form rather than an illustration with a button under it.
 */

const TYPE_LABELS: Record<WidgetType, string> = {
  contact_form: 'Contact form',
  email_signup: 'Email signup',
  cta_popover: 'CTA popover',
};

const TYPE_HINTS: Record<WidgetType, string> = {
  contact_form: 'Name, email, subject, and message. For general enquiries.',
  email_signup: 'Just an email address. For a newsletter or product updates.',
  cta_popover: 'A short pitch and one button, which links out or opens a form.',
};

export function WidgetsPage(): React.JSX.Element {
  const { active, capabilities } = useWorkspace();
  const canDelete = capabilities.includes('widget.delete');
  const canDraft = capabilities.includes('widget.draft.write');

  const [widgets, setWidgets] = useState<readonly WidgetSummary[]>([]);
  const [trash, setTrash] = useState<readonly WidgetSummary[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    const [list, deleted] = await Promise.all([widgetApi.list(), widgetApi.trash()]);
    if (list.ok) setWidgets(list.data.widgets);
    if (deleted.ok) setTrash(deleted.data.widgets);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load, active.id]);

  async function remove(widget: WidgetSummary): Promise<void> {
    setNotice(null);
    setFailure(null);
    const result = await widgetApi.remove(widget.id);
    if (!result.ok) {
      setFailure(result);
      return;
    }
    setNotice(`${widget.name} was moved to the trash. You can restore it for 30 days.`);
    await load();
  }

  async function restore(widget: WidgetSummary): Promise<void> {
    setNotice(null);
    setFailure(null);
    const result = await widgetApi.recover(widget.id);
    if (!result.ok) {
      setFailure(result);
      return;
    }
    setNotice(`${widget.name} was restored. It is not published until you publish it.`);
    await load();
  }

  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <header className="mb-8 border-b border-edge pb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal">Widgets</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
          Widgets in {active.name}
        </h1>
        <p className="mt-2 text-sm text-muted">
          Build a widget, publish it, and paste one line into your site. Up to 10 can be live at
          once.
        </p>
      </header>

      {notice !== null && <Alert tone="success">{notice}</Alert>}
      {failure !== null && <Alert tone="error">{failure.message}</Alert>}

      <section aria-labelledby="widgets-heading" className="mb-10">
        <h2 id="widgets-heading" className="text-lg font-semibold text-ink">
          Your widgets
        </h2>

        {loading ? (
          <p className="mt-4 text-sm text-muted">Loading widgets.</p>
        ) : widgets.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No widgets yet. Create your first one below.</p>
        ) : (
          <ul
            data-testid="widget-list"
            className="mt-4 divide-y divide-edge border border-edge bg-panel"
          >
            {widgets.map((widget) => (
              <li
                key={widget.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 p-4"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                    <Link
                      to={`/workspace/widgets/${widget.id}`}
                      className="underline decoration-edge underline-offset-4 hover:decoration-signal"
                    >
                      {widget.name}
                    </Link>
                    <WidgetStateChip state={widget.state} />
                    {widget.hasUnpublishedChanges && (
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-signal">
                        unpublished changes
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted">
                    {TYPE_LABELS[widget.type]} &middot; {widget.publicId}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    to={`/workspace/widgets/${widget.id}`}
                    className="border border-edge px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper"
                  >
                    {canDraft ? 'Edit' : 'View'}
                    <span className="sr-only"> {widget.name}</span>
                  </Link>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => void remove(widget)}
                      className="border border-edge px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper"
                    >
                      Delete
                      <span className="sr-only"> {widget.name}</span>
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canDraft && (
        <CreateWidgetForm
          onCreated={async (name) => {
            setFailure(null);
            setNotice(`${name} was created. It is a draft until you publish it.`);
            await load();
          }}
          onFailure={(value) => {
            setNotice(null);
            setFailure(value);
          }}
        />
      )}

      {trash.length > 0 && (
        <section aria-labelledby="trash-heading" className="mt-10 border-t border-edge pt-6">
          <h2 id="trash-heading" className="text-lg font-semibold text-ink">
            Trash
          </h2>
          <p className="mt-1.5 text-sm text-muted">
            Deleted widgets can be restored for 30 days. Restoring does not republish them.
          </p>
          <ul
            data-testid="widget-trash"
            className="mt-4 divide-y divide-edge border border-edge bg-panel"
          >
            {trash.map((widget) => (
              <li key={widget.id} className="flex items-center justify-between gap-4 p-4">
                <div>
                  <p className="text-sm font-medium text-ink">{widget.name}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted">
                    {TYPE_LABELS[widget.type]} &middot; {widget.publicId}
                  </p>
                </div>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => void restore(widget)}
                    className="shrink-0 border border-edge px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper"
                  >
                    Restore
                    <span className="sr-only"> {widget.name}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

interface CreateWidgetFormProps {
  readonly onCreated: (name: string) => Promise<void>;
  readonly onFailure: (failure: ApiFailure) => void;
}

function CreateWidgetForm({ onCreated, onFailure }: CreateWidgetFormProps): React.JSX.Element {
  const [type, setType] = useState<WidgetType>('contact_form');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    const result = await widgetApi.create(type, name);
    setBusy(false);

    if (!result.ok) {
      setFailure(result);
      onFailure(result);
      return;
    }
    const created = name;
    setName('');
    await onCreated(created);
  }

  return (
    <section aria-labelledby="create-heading">
      <h2 id="create-heading" className="text-lg font-semibold text-ink">
        Create a widget
      </h2>
      <p className="mt-1.5 text-sm text-muted">
        Pick a type to start from. You can change everything about it afterwards, except its type.
      </p>

      <form onSubmit={(event) => void onSubmit(event)} className="mt-4" noValidate>
        <fieldset className="border-0 p-0">
          <legend className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            Type
          </legend>
          {/*
           * Radios rather than a select: there are exactly three, each needs a
           * sentence of explanation, and blueprint 4.3 locks the list - so
           * showing all three side by side is both possible and more useful
           * than hiding two of them behind a dropdown.
           */}
          <div className="grid gap-2 sm:grid-cols-3">
            {WIDGET_TYPES.map((candidate) => (
              <label
                key={candidate}
                className={`flex cursor-pointer gap-2 border p-3 text-sm ${
                  type === candidate ? 'border-signal bg-paper' : 'border-edge bg-panel'
                }`}
              >
                <input
                  type="radio"
                  name="widget-type"
                  value={candidate}
                  checked={type === candidate}
                  onChange={() => setType(candidate)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-signal"
                />
                <span>
                  <span className="block font-medium text-ink">{TYPE_LABELS[candidate]}</span>
                  <span className="mt-0.5 block text-xs text-muted">{TYPE_HINTS[candidate]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-5">
          <Field
            label="Name"
            name="name"
            required
            maxLength={80}
            hint="Only your team sees this."
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={failure === null ? undefined : fieldError(failure, 'name')}
          />
        </div>

        <Button type="submit" busy={busy}>
          Create widget
        </Button>
      </form>
    </section>
  );
}
