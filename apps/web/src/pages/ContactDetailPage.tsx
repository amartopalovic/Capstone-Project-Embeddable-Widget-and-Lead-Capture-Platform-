import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  CONSENT_STATE_LABELS,
  CONTACT_STATUS_VALUES,
  type ContactDetail,
  type ContactStatusValue,
  type ContactSummary,
  type ContactTimelineActivity,
  type ContactTimelineSubmission,
  type MemberSummary,
} from '@lcp/contracts';
import { contactApi, workspaceApi, type ApiFailure } from '../lib/api.js';
import { Alert, Button, ContactStatusChip, Field, Select, TextArea } from '../components/ui.jsx';

/**
 * One lead, and everything that has happened to them (blueprint 4.6, 4.7, 9.3).
 *
 * The page is laid out around the distinction blueprint 4.6 draws and the rest
 * of the product depends on: the Contact is CANONICAL and editable, the
 * submission events are IMMUTABLE evidence. So the timeline gives those two
 * kinds of entry two different weights - a submission is a bordered panel,
 * because it is an artifact somebody sent; an activity entry is a hairline note,
 * because it is an annotation a teammate made. The structure carries the
 * distinction rather than a legend explaining it.
 */

export function ContactDetailPage(): React.JSX.Element {
  const { contactId = '' } = useParams();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<ContactDetail | null>(null);
  const [members, setMembers] = useState<readonly MemberSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const result = await contactApi.detail(contactId);
    setLoading(false);
    if (!result.ok) {
      setFailure(result);
      setDetail(null);
      return;
    }
    setDetail(result.data);
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      const list = await workspaceApi.members();
      if (list.ok) setMembers(list.data.members);
    })();
  }, []);

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl px-5 py-12">
        <p className="text-sm text-muted">Loading this lead.</p>
      </main>
    );
  }

  if (detail === null) {
    return (
      <main className="mx-auto max-w-5xl px-5 py-12">
        <Alert tone="error">
          {failure?.message ?? 'This lead is not available in this workspace.'}
        </Alert>
        <Link
          to="/workspace/contacts"
          className="text-sm text-signal underline decoration-signal/40 underline-offset-4"
        >
          Back to the inbox
        </Link>
      </main>
    );
  }

  const { contact } = detail;

  return (
    <main className="mx-auto max-w-5xl px-5 py-12">
      <p className="mb-6">
        <Link
          to="/workspace/contacts"
          className="text-sm text-muted underline decoration-edge underline-offset-4 hover:text-ink hover:decoration-signal"
        >
          Back to the inbox
        </Link>
      </p>

      <header className="mb-8 border-b border-edge pb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal">Lead</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {contact.name ?? contact.email}
          </h1>
          <ContactStatusChip status={contact.status} />
          {/*
           * Consent beside workflow status, because they are the two facts that
           * govern what a team may do with a lead: one says where it is in the
           * pipeline, the other says whether they are allowed to email it.
           * Chipped rather than buried in the timeline - "did they unsubscribe"
           * should never be a click away.
           */}
          <span
            data-testid="consent-state"
            className="border border-edge px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted"
          >
            {CONSENT_STATE_LABELS[contact.consentState]}
          </span>
        </div>
        <p className="mt-2 font-mono text-[11px] tracking-[0.02em] text-muted">
          {contact.email}
          {' · '}
          {contact.submissionCount === 1
            ? '1 submission'
            : `${String(contact.submissionCount)} submissions`}
          {' · first seen '}
          <time dateTime={contact.firstSubmissionAt}>
            {new Date(contact.firstSubmissionAt).toLocaleDateString()}
          </time>
        </p>
      </header>

      {notice !== null && <Alert tone="success">{notice}</Alert>}

      <div className="grid gap-10 lg:grid-cols-[22rem_1fr]">
        <div>
          <WorkflowPanel
            contact={contact}
            members={members}
            onChanged={(message) => {
              setNotice(message);
              void load();
            }}
          />

          {detail.canEditCanonical && (
            <CanonicalPanel
              contact={contact}
              onChanged={(message) => {
                setNotice(message);
                void load();
              }}
              onReload={load}
            />
          )}

          {detail.allowedActions.includes('delete') && (
            <section aria-labelledby="danger-heading" className="mt-8">
              <h2 id="danger-heading" className="text-lg font-semibold text-ink">
                Remove
              </h2>
              <p className="mt-1.5 text-sm text-muted">
                Moves this lead to the trash. You can restore it for 30 days.
              </p>
              <div className="mt-3">
                <Button
                  variant="danger"
                  onClick={() => {
                    void (async () => {
                      const result = await contactApi.softDelete(contact.id);
                      if (!result.ok) {
                        setFailure(result);
                        return;
                      }
                      await navigate('/workspace/contacts');
                    })();
                  }}
                >
                  Move to trash
                </Button>
              </div>
            </section>
          )}
        </div>

        <Timeline submissions={detail.submissions} activities={detail.activities} />
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Workflow - every role
// ---------------------------------------------------------------------------

interface PanelProps {
  readonly contact: ContactSummary;
  readonly members: readonly MemberSummary[];
  readonly onChanged: (message: string) => void;
}

/**
 * Status, assignee, tags, and notes (blueprint 4.6, 11).
 *
 * Every role may change these, so nothing here is gated. Each control saves on
 * its own rather than through one "Save" button: these are single decisions
 * ("this is qualified now"), not a form somebody fills in, and batching them
 * would invent a draft state the API does not have.
 */
function WorkflowPanel({ contact, members, onChanged }: PanelProps): React.JSX.Element {
  const [tag, setTag] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  async function apply(
    change: Parameters<typeof contactApi.updateWorkflow>[1],
    message: string,
  ): Promise<void> {
    setBusy(true);
    setFailure(null);
    const result = await contactApi.updateWorkflow(contact.id, change);
    setBusy(false);
    if (!result.ok) {
      setFailure(result);
      return;
    }
    onChanged(message);
  }

  return (
    <section aria-labelledby="workflow-heading">
      <h2 id="workflow-heading" className="text-lg font-semibold text-ink">
        Workflow
      </h2>

      {failure !== null && (
        <div className="mt-3">
          <Alert tone="error">{failure.message}</Alert>
        </div>
      )}

      <div className="mt-4 space-y-4">
        <Select
          label="Status"
          value={contact.status}
          disabled={busy}
          onChange={(event) =>
            void apply(
              { status: event.target.value as ContactStatusValue },
              `Status set to ${event.target.value}.`,
            )
          }
        >
          {CONTACT_STATUS_VALUES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </Select>

        <Select
          label="Assignee"
          value={contact.assigneeUserId ?? ''}
          disabled={busy}
          onChange={(event) =>
            void apply(
              { assigneeUserId: event.target.value === '' ? null : event.target.value },
              event.target.value === '' ? 'Assignee cleared.' : 'Assignee updated.',
            )
          }
        >
          <option value="">Nobody yet</option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.email}
            </option>
          ))}
        </Select>

        <div>
          <p className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            Tags
          </p>
          {contact.tags.length === 0 ? (
            <p className="text-sm text-muted">None yet.</p>
          ) : (
            <ul className="mb-2 flex flex-wrap gap-2">
              {contact.tags.map((value) => (
                <li key={value}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void apply(
                        { tags: contact.tags.filter((entry) => entry !== value) },
                        `Removed the tag "${value}".`,
                      )
                    }
                    className="border border-edge px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted hover:border-danger hover:text-danger"
                  >
                    {value}
                    <span className="sr-only"> (remove tag)</span>
                    <span aria-hidden="true"> ×</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              const next = tag.trim();
              if (next === '') return;
              setTag('');
              void apply({ tags: [...contact.tags, next] }, `Added the tag "${next}".`);
            }}
            className="flex items-end gap-2"
          >
            <div className="flex-1">
              <label htmlFor="add-tag" className="sr-only">
                Add a tag
              </label>
              <input
                id="add-tag"
                type="text"
                value={tag}
                onChange={(event) => setTag(event.target.value)}
                placeholder="vip"
                className="w-full border border-edge bg-panel px-3 py-2 text-sm text-ink placeholder:text-muted"
              />
            </div>
            <button
              type="submit"
              disabled={busy || tag.trim() === ''}
              className="border border-edge px-3 py-2 text-sm text-ink hover:bg-paper disabled:opacity-55"
            >
              Add tag
            </button>
          </form>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            const next = note.trim();
            if (next === '') return;
            setBusy(true);
            void (async () => {
              const result = await contactApi.addNote(contact.id, next);
              setBusy(false);
              if (!result.ok) {
                setFailure(result);
                return;
              }
              setNote('');
              onChanged('Note added.');
            })();
          }}
        >
          <TextArea
            label="Add a note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            hint="Only your team sees this. It appears in the timeline."
          />
          <div className="mt-2">
            <Button type="submit" variant="secondary" disabled={note.trim() === ''} busy={busy}>
              Add note
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Canonical - Owner/Admin
// ---------------------------------------------------------------------------

interface CanonicalPanelProps {
  readonly contact: ContactSummary;
  readonly onChanged: (message: string) => void;
  readonly onReload: () => Promise<void>;
}

/**
 * The lead's own details, which only Owner/Admin may correct (blueprint 11).
 *
 * Two things make this panel different from an ordinary form.
 *
 * **A field a human has corrected is marked.** Blueprint 4.6 protects those
 * values from being overwritten by a later submission, which is a real and
 * slightly surprising behaviour - so the fields it applies to say so, rather
 * than leaving somebody to wonder why a resubmitted name did not take.
 *
 * **A stale save is a designed state, not an error banner.** The Stage 8a API
 * refuses a write whose `expectedVersion` has moved, which happens when a
 * teammate edited the same lead or the visitor submitted again. Telling
 * somebody "conflict" and leaving their typing in a box they cannot save is a
 * dead end, so the conflict state says what happened and offers the one action
 * that resolves it.
 */
function CanonicalPanel({ contact, onChanged, onReload }: CanonicalPanelProps): React.JSX.Element {
  const [form, setForm] = useState({
    email: contact.email,
    name: contact.name ?? '',
    phone: contact.phone ?? '',
    company: contact.company ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [conflict, setConflict] = useState(false);

  /**
   * Re-seed the form when the contact changes underneath it.
   *
   * Keyed on the version rather than on the object, so reloading after our own
   * save refreshes the fields, and re-rendering for an unrelated reason does
   * not discard what someone is typing.
   */
  const seededVersion = useRef(contact.version);
  if (seededVersion.current !== contact.version) {
    seededVersion.current = contact.version;
    setForm({
      email: contact.email,
      name: contact.name ?? '',
      phone: contact.phone ?? '',
      company: contact.company ?? '',
    });
    setConflict(false);
  }

  const edited = new Set(contact.manuallyEditedFields);

  async function save(): Promise<void> {
    setBusy(true);
    setFailure(null);
    setConflict(false);

    const result = await contactApi.updateCanonical(contact.id, contact.version, {
      email: form.email.trim(),
      name: form.name.trim() === '' ? null : form.name.trim(),
      phone: form.phone.trim() === '' ? null : form.phone.trim(),
      company: form.company.trim() === '' ? null : form.company.trim(),
    });
    setBusy(false);

    if (result.ok) {
      onChanged('Details saved.');
      return;
    }
    if (result.code === 'stale_revision') {
      setConflict(true);
      return;
    }
    setFailure(result);
  }

  return (
    <section aria-labelledby="canonical-heading" className="mt-8">
      <h2 id="canonical-heading" className="text-lg font-semibold text-ink">
        Details
      </h2>
      <p className="mt-1.5 text-sm text-muted">
        Corrections you make here survive later submissions from the same person.
      </p>

      {conflict && (
        <div data-testid="canonical-conflict" className="mt-4">
          <Alert tone="error">
            <p className="font-medium">This lead changed while you were editing.</p>
            <p className="mt-1">
              Someone on your team edited it, or the visitor submitted again. Load the current
              details, then reapply your change so nothing is lost.
            </p>
            <p className="mt-3">
              <button
                type="button"
                data-testid="conflict-reload"
                onClick={() => void onReload()}
                className="border border-danger px-3 py-1.5 text-sm font-medium text-danger hover:bg-panel"
              >
                Load current details
              </button>
            </p>
          </Alert>
        </div>
      )}

      {failure !== null && (
        <div className="mt-4">
          <Alert tone="error">{failure.message}</Alert>
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        className="mt-4"
      >
        <CanonicalField
          label="Email"
          type="email"
          value={form.email}
          edited={edited.has('email')}
          onChange={(value) => setForm((f) => ({ ...f, email: value }))}
        />
        <CanonicalField
          label="Name"
          value={form.name}
          edited={edited.has('name')}
          onChange={(value) => setForm((f) => ({ ...f, name: value }))}
        />
        <CanonicalField
          label="Phone"
          value={form.phone}
          edited={edited.has('phone')}
          onChange={(value) => setForm((f) => ({ ...f, phone: value }))}
        />
        <CanonicalField
          label="Company"
          value={form.company}
          edited={edited.has('company')}
          onChange={(value) => setForm((f) => ({ ...f, company: value }))}
        />

        <Button type="submit" busy={busy}>
          Save details
        </Button>
      </form>
    </section>
  );
}

interface CanonicalFieldProps {
  readonly label: string;
  readonly value: string;
  readonly edited: boolean;
  readonly onChange: (value: string) => void;
  readonly type?: string;
}

function CanonicalField({
  label,
  value,
  edited,
  onChange,
  type = 'text',
}: CanonicalFieldProps): React.JSX.Element {
  return (
    <Field
      label={label}
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      {...(edited
        ? { hint: 'Edited by your team. A later submission will not overwrite this.' }
        : {})}
    />
  );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

type TimelineEntry =
  | { readonly kind: 'submission'; readonly at: string; readonly value: ContactTimelineSubmission }
  | { readonly kind: 'activity'; readonly at: string; readonly value: ContactTimelineActivity };

const ACTIVITY_LABELS: Record<string, string> = {
  status_changed: 'Status changed',
  assignee_changed: 'Assignee changed',
  tags_changed: 'Tags changed',
  note_added: 'Note',
  canonical_edited: 'Details edited',
  merged_from: 'Merged in a duplicate',
  merged_into: 'Merged into another lead',
  deleted: 'Moved to trash',
  recovered: 'Restored from trash',
};

/**
 * Submissions and activity, interleaved by time.
 *
 * The two are visually different weights on purpose. A submission is evidence
 * the visitor sent and can never be edited (blueprint 9.3), so it is a bordered
 * panel carrying its own values. An activity entry is something a teammate did
 * to the record, so it is a hairline note. Reading down the spine, you can tell
 * at a glance which marks came from outside and which came from your own team.
 */
function Timeline({
  submissions,
  activities,
}: {
  readonly submissions: readonly ContactTimelineSubmission[];
  readonly activities: readonly ContactTimelineActivity[];
}): React.JSX.Element {
  const entries: TimelineEntry[] = [
    ...submissions.map((value): TimelineEntry => ({
      kind: 'submission',
      at: value.submittedAt,
      value,
    })),
    ...activities.map((value): TimelineEntry => ({
      kind: 'activity',
      at: value.occurredAt,
      value,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <section aria-labelledby="timeline-heading">
      <h2 id="timeline-heading" className="text-lg font-semibold text-ink">
        Timeline
      </h2>
      <p className="mt-1.5 text-sm text-muted">
        Everything this person sent, and everything your team has done since. Newest first.
      </p>

      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Nothing here yet.</p>
      ) : (
        <ol data-testid="timeline" className="mt-5 border-l border-edge pl-5">
          {entries.map((entry) =>
            entry.kind === 'submission' ? (
              <SubmissionEntry key={`s-${entry.value.id}`} submission={entry.value} />
            ) : (
              <ActivityEntry key={`a-${entry.value.id}`} activity={entry.value} />
            ),
          )}
        </ol>
      )}
    </section>
  );
}

function SubmissionEntry({
  submission,
}: {
  readonly submission: ContactTimelineSubmission;
}): React.JSX.Element {
  const fields = Object.entries(submission.values);

  return (
    <li data-testid="timeline-submission" className="relative mb-5">
      {/* Ties the panel back to the spine without drawing a second line. */}
      <span aria-hidden="true" className="absolute -left-[1.4rem] top-3 h-px w-4 bg-edge" />

      <article className="border border-edge bg-panel p-4">
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-signal">
            Submitted
          </span>
          <time dateTime={submission.submittedAt} className="font-mono text-[11px] text-muted">
            {new Date(submission.submittedAt).toLocaleString()}
          </time>
        </p>

        {fields.length > 0 && (
          <dl className="mt-3 space-y-2">
            {fields.map(([key, value]) => (
              <div key={key}>
                <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                  {key}
                </dt>
                <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {/*
         * The provenance line - the page this arrived from, and where the
         * visitor was. This is what a lead in THIS product has that a lead in a
         * spreadsheet does not.
         */}
        <p className="mt-3 border-t border-edge pt-2 font-mono text-[11px] tracking-[0.02em] text-muted">
          {submission.pageUrl ?? submission.domain ?? 'unknown page'}
          {submission.country !== null && (
            <>
              {' · '}
              {submission.city ?? submission.country}
            </>
          )}
          {' · revision '}
          {submission.widgetRevisionNumber}
        </p>
      </article>
    </li>
  );
}

function ActivityEntry({
  activity,
}: {
  readonly activity: ContactTimelineActivity;
}): React.JSX.Element {
  const label = ACTIVITY_LABELS[activity.type] ?? activity.type;
  const from = activity.metadata['from'];
  const to = activity.metadata['to'];

  return (
    <li data-testid="timeline-activity" className="relative mb-5">
      <span
        aria-hidden="true"
        className="absolute -left-[1.4rem] top-2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-edge"
      />

      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
          {label}
        </span>
        <time dateTime={activity.occurredAt} className="font-mono text-[11px] text-muted">
          {new Date(activity.occurredAt).toLocaleString()}
        </time>
      </p>

      {activity.note !== null && (
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">{activity.note}</p>
      )}

      {activity.note === null && typeof to === 'string' && (
        <p className="mt-1 text-sm text-ink">
          {typeof from === 'string' && from !== '' ? `${from} → ${to}` : to}
        </p>
      )}
    </li>
  );
}
