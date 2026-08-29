import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { ApiFieldError, WidgetConfig, WidgetDetail } from '@lcp/contracts';
import { widgetApi, type ApiFailure } from '../lib/api.js';
import { useWorkspace } from '../lib/workspace-context.js';
import { Alert, Button, CopyField, WidgetStateChip } from '../components/ui.jsx';
import { WidgetSettings } from '../components/WidgetSettings.jsx';
import { WidgetPreview } from '../components/WidgetPreview.jsx';

/**
 * The widget builder: settings on the left, live preview on the right
 * (blueprint 4.3's "settings form with a live preview").
 *
 * The draft lives in component state while it is being edited and is written
 * only when the creator saves. That is deliberate rather than autosave: Stage
 * 5a's optimistic concurrency means every write can be refused as stale, and an
 * autosaving builder would produce that conflict at unpredictable moments,
 * halfway through a thought. An explicit save makes the conflict land at the
 * moment the creator asked for something, which is when they can act on it.
 *
 * Nothing here decides what the creator may do. Publish and delete controls key
 * off the capabilities the API derived from the section 11 matrix, exactly as
 * the members page does, and validation messages are the server's own.
 */
export function WidgetBuilderPage(): React.JSX.Element {
  const { widgetId } = useParams();
  const navigate = useNavigate();
  const { user, capabilities } = useWorkspace();

  const canDraft = capabilities.includes('widget.draft.write');
  const canPublish = capabilities.includes('widget.publish');
  const canDelete = capabilities.includes('widget.delete');

  const [detail, setDetail] = useState<WidgetDetail | null>(null);
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  /**
   * The latest configuration, readable without waiting for a re-render.
   *
   * Saving straight after a keystroke would otherwise run a handler still
   * closed over the previous render's `config` and quietly persist the older
   * value - which is exactly the "silently lose an edit" failure the whole
   * optimistic-concurrency design exists to prevent, arriving by a different
   * route. A ref is read at the moment of the click, so what gets sent is what
   * is on screen.
   */
  const configRef = useRef<WidgetConfig | null>(null);
  /** The version the current edits are based on; null means no draft exists yet. */
  const [baseVersion, setBaseVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<readonly ApiFieldError[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  /** Re-read the widget, discarding local edits. Used on load and after a save. */
  const load = useCallback(
    async (keepEdits = false): Promise<void> => {
      if (widgetId === undefined) return;
      const result = await widgetApi.detail(widgetId);
      if (!result.ok) {
        await navigate('/workspace/widgets', { replace: true });
        return;
      }

      setDetail(result.data);
      // A widget with no draft is edited from what is live; the first write
      // then carries version 0, which is what Stage 5a expects.
      const source = result.data.draft ?? result.data.published;
      setBaseVersion(result.data.draft?.version ?? 0);
      if (!keepEdits && source !== null) {
        setConfig(source.config);
        configRef.current = source.config;
        setDirty(false);
      }
      setLoading(false);
    },
    [widgetId, navigate],
  );

  useEffect(() => {
    void load();
  }, [load]);

  function edit(next: WidgetConfig): void {
    setConfig(next);
    configRef.current = next;
    setDirty(true);
    // A previous rejection no longer describes what is on screen.
    setErrors([]);
    setConflict(null);
  }

  async function save(): Promise<boolean> {
    const pending = configRef.current ?? config;
    if (widgetId === undefined || pending === null) return false;
    setBusy(true);
    setNotice(null);
    setFailure(null);

    const result = await widgetApi.saveDraft(widgetId, pending, baseVersion);
    setBusy(false);

    if (result.ok) {
      setErrors([]);
      setConflict(null);
      setBaseVersion(result.data.version);
      setDirty(false);
      setNotice('Draft saved. It is not live until you publish it.');
      await load(true);
      return true;
    }

    if (result.code === 'stale_revision') {
      /**
       * Someone else saved first. Nothing local is thrown away: the edits stay
       * on screen and the creator chooses between keeping theirs and taking the
       * other version. Silently reloading would be the data loss the 409
       * exists to prevent.
       */
      setConflict(result.message);
      return false;
    }

    setErrors(result.fieldErrors);
    setFailure(result);
    return false;
  }

  async function publish(): Promise<void> {
    if (widgetId === undefined) return;

    // Publishing what is on screen, not what was last saved, is what a creator
    // means by "publish" - so an unsaved draft is saved first.
    if (dirty) {
      const saved = await save();
      if (!saved) return;
    }

    setBusy(true);
    setNotice(null);
    setFailure(null);
    const current = await widgetApi.detail(widgetId);
    const version = current.ok ? (current.data.draft?.version ?? 0) : baseVersion;

    const result = await widgetApi.publish(widgetId, version);
    setBusy(false);

    if (!result.ok) {
      setErrors(result.fieldErrors);
      setFailure(result);
      return;
    }
    setNotice(`Published revision ${String(result.data.revisionNumber)}. It is live now.`);
    await load();
  }

  async function unpublish(): Promise<void> {
    if (widgetId === undefined) return;
    setBusy(true);
    setNotice(null);
    setFailure(null);
    const result = await widgetApi.unpublish(widgetId);
    setBusy(false);
    if (!result.ok) {
      setFailure(result);
      return;
    }
    setNotice('Unpublished. Visitors stop seeing it straight away.');
    await load();
  }

  async function remove(): Promise<void> {
    if (widgetId === undefined) return;
    setBusy(true);
    const result = await widgetApi.remove(widgetId);
    setBusy(false);
    setConfirmingDelete(false);
    if (!result.ok) {
      setFailure(result);
      return;
    }
    await navigate('/workspace/widgets', { replace: true });
  }

  if (loading || detail === null || config === null) {
    return (
      <main className="mx-auto max-w-5xl px-5 py-16">
        <p className="text-muted">Loading this widget.</p>
      </main>
    );
  }

  const { widget } = detail;

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <header className="mb-6 border-b border-edge pb-5">
        <Link to="/workspace/widgets" className="text-sm text-muted underline hover:text-ink">
          &larr; All widgets
        </Link>
        <h1 className="mt-3 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight text-ink">
          {widget.name}
          <WidgetStateChip state={widget.state} />
        </h1>
        <p className="mt-2 font-mono text-xs text-muted">
          {widget.publicId}
          {widget.publishedRevisionNumber !== null &&
            ` · live revision ${String(widget.publishedRevisionNumber)}`}
        </p>
      </header>

      {notice !== null && <Alert tone="success">{notice}</Alert>}
      {conflict !== null && (
        <Alert tone="error">
          <span className="block font-medium">{conflict}</span>
          <span className="mt-1 block">
            Your changes are still here and nothing has been lost. Save again to overwrite theirs,
            or discard yours to take the newer version.
          </span>
          <span className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              data-testid="conflict-retry"
              onClick={() => {
                // Rebase onto whatever is current, keeping the edits on screen.
                void widgetApi.detail(widget.id).then(async (result) => {
                  if (result.ok) setBaseVersion(result.data.draft?.version ?? 0);
                  await save();
                });
              }}
              className="border border-danger px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger-soft"
            >
              Keep my changes
            </button>
            <button
              type="button"
              data-testid="conflict-discard"
              onClick={() => {
                setConflict(null);
                void load();
              }}
              className="border border-edge px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper"
            >
              Discard mine and reload
            </button>
          </span>
        </Alert>
      )}
      {failure !== null && conflict === null && <Alert tone="error">{failure.message}</Alert>}

      {!canDraft && <Alert tone="info">Your role can view this widget but not change it.</Alert>}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* --- settings --- */}
        <div>
          <WidgetSettings
            type={widget.type}
            config={config}
            errors={errors}
            disabled={!canDraft || busy}
            onChange={edit}
          />
        </div>

        {/* --- preview and actions --- */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <WidgetPreview type={widget.type} config={config} />

          <div className="mt-6 space-y-3 border border-edge bg-panel p-5">
            {canDraft && (
              <Button type="button" variant="secondary" busy={busy} onClick={() => void save()}>
                {dirty ? 'Save draft' : 'Saved'}
              </Button>
            )}

            {canPublish ? (
              <>
                <Button type="button" busy={busy} onClick={() => void publish()}>
                  Publish
                </Button>
                {widget.state === 'published' && (
                  <Button
                    type="button"
                    variant="secondary"
                    busy={busy}
                    onClick={() => void unpublish()}
                  >
                    Unpublish
                  </Button>
                )}
              </>
            ) : (
              /*
               * The distinction the API already draws: an unverified Owner or
               * Admin is told to confirm their email, while a Member is simply
               * not offered publishing at all.
               */
              <p className="text-sm text-muted" data-testid="publish-unavailable">
                {user.emailVerified
                  ? 'Publishing is available to Owners and Admins.'
                  : 'Confirm your email address to publish. We sent a link when you registered.'}
              </p>
            )}

            {canDelete && (
              <div className="border-t border-edge pt-3">
                {!confirmingDelete ? (
                  <Button
                    type="button"
                    variant="danger"
                    data-testid="delete-widget"
                    onClick={() => setConfirmingDelete(true)}
                  >
                    Delete widget
                  </Button>
                ) : (
                  <>
                    <p className="mb-3 text-sm text-muted">
                      This stops serving it immediately. You can restore it for 30 days.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <Button
                        type="button"
                        variant="danger"
                        busy={busy}
                        data-testid="confirm-delete-widget"
                        onClick={() => void remove()}
                      >
                        Yes, delete it
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setConfirmingDelete(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/*
           * What is live right now, beside what is being edited.
           *
           * The builder always edits the DRAFT, so without this there is no
           * way to answer "has my change gone out yet?" - and after a
           * teammate saves, the headline on screen is theirs, not what
           * visitors are seeing.
           */}
          {detail.published !== null && (
            <div data-testid="live-revision" className="mt-6 border border-edge bg-panel p-5">
              <h2 className="text-sm font-semibold text-ink">
                Live now &middot; revision {String(detail.published.revisionNumber)}
              </h2>
              <p className="mt-2 text-sm text-muted">
                Visitors currently see{' '}
                <span data-testid="live-headline" className="text-ink">
                  {detail.published.config.headline}
                </span>
                .
              </p>
              {widget.hasUnpublishedChanges && (
                <p className="mt-2 text-sm text-muted">
                  The draft beside this has changes that are not live yet.
                </p>
              )}
            </div>
          )}

          <div className="mt-6 border border-edge bg-panel p-5">
            <h2 className="text-sm font-semibold text-ink">Install</h2>
            {widget.state === 'published' ? (
              <>
                <p className="mb-3 mt-1 text-sm text-muted">
                  Paste this once into the page you want it on, just before the closing body tag.
                </p>
                <CopyField label="Embed snippet" value={detail.snippet} testId="embed-snippet" />
              </>
            ) : (
              <p className="mt-1 text-sm text-muted" data-testid="snippet-unavailable">
                Publish this widget to get its embed snippet.
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
