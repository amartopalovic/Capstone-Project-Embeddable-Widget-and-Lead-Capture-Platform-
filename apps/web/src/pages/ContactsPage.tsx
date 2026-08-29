import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  CONTACT_SORT_FIELDS,
  CONTACT_STATUS_VALUES,
  type ContactBulkAction,
  type ContactSummary,
  type ContactSortField,
  type ContactStatusValue,
  type MemberSummary,
  type WidgetSummary,
} from '@lcp/contracts';
import { contactApi, contactQueryString, widgetApi, workspaceApi } from '../lib/api.js';
import type { ApiFailure } from '../lib/api.js';
import { useWorkspace } from '../lib/workspace-context.js';
import { useWorkspaceEvents } from '../lib/use-workspace-events.js';
import { Alert, Button, ContactStatusChip, Select } from '../components/ui.jsx';

/**
 * The contact inbox (blueprint 4.7).
 *
 * Two decisions shape this page.
 *
 * **A row says how persistent someone has been, not just who they are.** The
 * mono sub-line carries the submission count and the last date, because
 * "asked three times" is the fact that decides which lead to open first and a
 * name and a status alone cannot tell you. Full provenance - the page each
 * submission arrived from - is on the detail timeline, where the immutable
 * event that owns it lives; the list summary the API returns does not carry it,
 * and inventing a per-row lookup to show it would cost a query per row.
 *
 * **New leads queue instead of interrupting.** Blueprint 13.1 streams arrivals
 * live, but inserting a row into a list somebody is reading moves the thing
 * they were about to click, and silently changes what a bulk selection covers.
 * Arrivals are counted into a button instead, and appear when it is pressed.
 */

/** Filters that are not the search box live behind a disclosure. */
interface FilterState {
  search: string;
  status: readonly ContactStatusValue[];
  submittedAfter: string;
  submittedBefore: string;
  widgetId: string;
  domain: string;
  pageUrl: string;
  assigneeUserId: string;
  tag: string;
  country: string;
  city: string;
}

const EMPTY_FILTER: FilterState = {
  search: '',
  status: [],
  submittedAfter: '',
  submittedBefore: '',
  widgetId: '',
  domain: '',
  pageUrl: '',
  assigneeUserId: '',
  tag: '',
  country: '',
  city: '',
};

const SORT_LABELS: Record<ContactSortField, string> = {
  lastSubmissionAt: 'Latest submission',
  createdAt: 'First seen',
  normalizedEmail: 'Email',
};

/** How many filters are narrowing the list right now. */
function activeFilterCount(filter: FilterState): number {
  let count = 0;
  if (filter.status.length > 0) count += 1;
  for (const key of [
    'submittedAfter',
    'submittedBefore',
    'widgetId',
    'domain',
    'pageUrl',
    'assigneeUserId',
    'tag',
    'country',
    'city',
  ] as const) {
    if (filter[key] !== '') count += 1;
  }
  return count;
}

export function ContactsPage(): React.JSX.Element {
  const { active, capabilities } = useWorkspace();
  const canExport = capabilities.includes('contact.export');
  const canDelete = capabilities.includes('contact.delete');
  const canWorkflow = capabilities.includes('contact.workflow.write');
  const canMerge = capabilities.includes('contact.canonical.write');

  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  const [sort, setSort] = useState<ContactSortField>('lastSubmissionAt');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');

  const [contacts, setContacts] = useState<readonly ContactSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState(0);
  const [merging, setMerging] = useState(false);

  const [widgets, setWidgets] = useState<readonly WidgetSummary[]>([]);
  const [members, setMembers] = useState<readonly MemberSummary[]>([]);

  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  /**
   * The query string the list is showing.
   *
   * The export link is built from this same value, which is what makes
   * "download what you are looking at" true rather than a promise - blueprint
   * 4.7 requires the export to match the active filter exactly.
   */
  const query = useMemo(
    () =>
      contactQueryString({
        search: filter.search,
        status: filter.status,
        submittedAfter: filter.submittedAfter,
        submittedBefore: filter.submittedBefore,
        widgetId: filter.widgetId,
        domain: filter.domain,
        pageUrl: filter.pageUrl,
        assigneeUserId: filter.assigneeUserId,
        tag: filter.tag,
        country: filter.country,
        city: filter.city,
        sort,
        direction,
      }),
    [filter, sort, direction],
  );

  /**
   * The live query, read at call time.
   *
   * `load` is used from an effect and from event handlers, and a handler that
   * closed over a stale query would refetch the previous filter - the same
   * class of bug the widget builder hit in Stage 5b.
   */
  const queryRef = useRef(query);
  queryRef.current = query;

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    const result = await contactApi.list(queryRef.current);
    setLoading(false);
    if (!result.ok) {
      setFailure(result);
      return;
    }
    setFailure(null);
    setContacts(result.data.contacts);
    setNextCursor(result.data.nextCursor);
    setPending(0);

    /**
     * Keep the selection, minus anything that is no longer here.
     *
     * Clearing it outright was wrong in two ways. A refresh is not always
     * something the person asked for - it also happens when a load that was
     * already in flight lands - so wiping the selection silently discards work
     * they had just done, with no explanation. And it caused a real race: React
     * StrictMode runs the mount effect twice in development, so the second
     * load's completion could erase a selection made between the two.
     *
     * Pruning keeps the guarantee that mattered - a bulk action can never
     * target a row the person can no longer see - without the collateral.
     */
    const stillPresent = new Set(result.data.contacts.map((contact) => contact.id));
    setSelected((current) => new Set([...current].filter((id) => stillPresent.has(id))));
  }, []);

  useEffect(() => {
    void load();
  }, [load, query, active.id]);

  useEffect(() => {
    void (async () => {
      const [widgetList, memberList] = await Promise.all([
        widgetApi.list(),
        workspaceApi.members(),
      ]);
      if (widgetList.ok) setWidgets(widgetList.data.widgets);
      if (memberList.ok) setMembers(memberList.data.members);
    })();
  }, [active.id]);

  /**
   * Live arrivals (blueprint 13.1).
   *
   * Counted, not inserted. `contact.updated` is counted too: a repeat
   * submission changes a row's position under the default sort, so the list on
   * screen is out of date in the same way even though no row was added.
   */
  useWorkspaceEvents({
    types: ['contact.created', 'contact.updated'],
    enabled: !loading,
    onEvent: () => setPending((current) => current + 1),
  });

  async function loadMore(): Promise<void> {
    if (nextCursor === null) return;
    const result = await contactApi.list(
      `${queryRef.current}${queryRef.current === '' ? '?' : '&'}cursor=${encodeURIComponent(nextCursor)}`,
    );
    if (!result.ok) {
      setFailure(result);
      return;
    }
    setContacts((current) => [...current, ...result.data.contacts]);
    setNextCursor(result.data.nextCursor);
  }

  function toggle(contactId: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  }

  function toggleAll(): void {
    setSelected((current) =>
      current.size === contacts.length ? new Set() : new Set(contacts.map((c) => c.id)),
    );
  }

  async function runBulk(action: ContactBulkAction, extra: Record<string, string> = {}) {
    setNotice(null);
    setFailure(null);
    const result = await contactApi.bulk({
      action,
      contactIds: [...selected],
      ...extra,
    } as Parameters<typeof contactApi.bulk>[0]);

    if (!result.ok) {
      setFailure(result);
      return;
    }
    setNotice(
      result.data.changed === 1
        ? '1 contact updated.'
        : `${String(result.data.changed)} contacts updated.`,
    );
    await load();
  }

  const filterCount = activeFilterCount(filter);
  const allSelected = contacts.length > 0 && selected.size === contacts.length;

  return (
    <main className="mx-auto max-w-5xl px-5 py-12">
      <header className="mb-8 border-b border-edge pb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal">Inbox</p>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Leads in {active.name}</h1>
          {canDelete && (
            <Link
              to="/workspace/contacts/trash"
              className="text-sm text-muted underline decoration-edge underline-offset-4 hover:text-ink hover:decoration-signal"
            >
              Trash
            </Link>
          )}
        </div>
        <p className="mt-2 text-sm text-muted">
          Everyone who has submitted one of your widgets. New leads appear here as they arrive.
        </p>
      </header>

      {notice !== null && <Alert tone="success">{notice}</Alert>}
      {failure !== null && <Alert tone="error">{failure.message}</Alert>}

      {/* --- search ------------------------------------------------------ */}

      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
        className="mb-4 flex flex-wrap items-end gap-3"
      >
        <div className="min-w-56 flex-1">
          <label
            htmlFor="contact-search"
            className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-muted"
          >
            Search
          </label>
          <input
            id="contact-search"
            type="search"
            value={filter.search}
            onChange={(event) => setFilter((f) => ({ ...f, search: event.target.value }))}
            placeholder="Name, email, or anything they wrote"
            className="w-full border border-edge bg-panel px-3 py-2 text-sm text-ink placeholder:text-muted"
          />
        </div>
        <div className="w-44">
          <Select
            label="Sort by"
            value={sort}
            onChange={(event) => setSort(event.target.value as ContactSortField)}
          >
            {CONTACT_SORT_FIELDS.map((field) => (
              <option key={field} value={field}>
                {SORT_LABELS[field]}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-36">
          <Select
            label="Order"
            value={direction}
            onChange={(event) => setDirection(event.target.value as 'asc' | 'desc')}
          >
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </Select>
        </div>
      </form>

      {/* --- filters ----------------------------------------------------- */}

      {/*
       * Filters and export sit on one row, and that pairing is deliberate.
       * Blueprint 4.7 exports what the filter is showing, so the control that
       * downloads the list belongs beside the control that narrows it - and the
       * "N active" badge is visible at the moment somebody decides to download,
       * which is exactly when they need to know the list is narrowed.
       *
       * Export is NOT inside the disclosure. It is a primary action, and a
       * primary action hidden behind a collapsed panel is one people do not
       * find. An earlier revision had it inside; the browser test caught it.
       */}
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <details className="min-w-64 flex-1 border border-edge bg-panel">
          <summary
            data-testid="filters-toggle"
            className="cursor-pointer list-none px-4 py-2.5 text-sm font-medium text-ink"
          >
            Filters
            {filterCount > 0 && (
              <span className="ml-2 border border-signal px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-signal">
                {filterCount} active
              </span>
            )}
          </summary>

          <div className="grid gap-4 border-t border-edge p-4 sm:grid-cols-2 lg:grid-cols-3">
            <fieldset className="sm:col-span-2 lg:col-span-3">
              <legend className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                Status
              </legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {CONTACT_STATUS_VALUES.map((status) => (
                  <label key={status} className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={filter.status.includes(status)}
                      onChange={(event) =>
                        setFilter((f) => ({
                          ...f,
                          status: event.target.checked
                            ? [...f.status, status]
                            : f.status.filter((value) => value !== status),
                        }))
                      }
                      className="h-4 w-4 accent-signal"
                    />
                    <ContactStatusChip status={status} />
                  </label>
                ))}
              </div>
            </fieldset>

            <TextFilter
              label="Submitted after"
              type="date"
              value={filter.submittedAfter}
              onChange={(value) => setFilter((f) => ({ ...f, submittedAfter: value }))}
            />
            <TextFilter
              label="Submitted before"
              type="date"
              value={filter.submittedBefore}
              onChange={(value) => setFilter((f) => ({ ...f, submittedBefore: value }))}
            />

            <Select
              label="Widget"
              value={filter.widgetId}
              onChange={(event) => setFilter((f) => ({ ...f, widgetId: event.target.value }))}
            >
              <option value="">Any widget</option>
              {widgets.map((widget) => (
                <option key={widget.id} value={widget.id}>
                  {widget.name}
                </option>
              ))}
            </Select>

            <Select
              label="Assignee"
              value={filter.assigneeUserId}
              onChange={(event) => setFilter((f) => ({ ...f, assigneeUserId: event.target.value }))}
            >
              <option value="">Anyone</option>
              <option value="unassigned">Nobody yet</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.email}
                </option>
              ))}
            </Select>

            <TextFilter
              label="Domain"
              value={filter.domain}
              onChange={(value) => setFilter((f) => ({ ...f, domain: value }))}
              placeholder="shop.example.com"
            />
            <TextFilter
              label="Page URL"
              value={filter.pageUrl}
              onChange={(value) => setFilter((f) => ({ ...f, pageUrl: value }))}
              placeholder="https://shop.example.com/pricing"
            />
            <TextFilter
              label="Tag"
              value={filter.tag}
              onChange={(value) => setFilter((f) => ({ ...f, tag: value }))}
            />
            <TextFilter
              label="Country"
              value={filter.country}
              onChange={(value) => setFilter((f) => ({ ...f, country: value }))}
              placeholder="DE"
              maxLength={2}
            />
            <TextFilter
              label="City"
              value={filter.city}
              onChange={(value) => setFilter((f) => ({ ...f, city: value }))}
            />

            <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-3">
              <button
                type="button"
                onClick={() => setFilter(EMPTY_FILTER)}
                className="border border-edge px-3 py-2 text-sm text-ink hover:bg-paper"
              >
                Clear filters
              </button>
            </div>
          </div>
        </details>

        {canExport && (
          /*
           * A real link, not a fetch: the export is a streamed attachment, so
           * letting the browser handle it keeps the whole file out of memory
           * and picks up the filename the server sets. The href is built from
           * the same query the list just ran, which is what makes "download
           * what you are looking at" structural rather than a promise.
           */
          <a
            data-testid="export-csv"
            href={contactApi.exportUrl(query)}
            className="border border-edge bg-panel px-4 py-2.5 text-sm font-medium text-ink hover:bg-paper"
          >
            Export CSV
          </a>
        )}
      </div>

      {/* --- live arrivals ------------------------------------------------ */}

      {/*
       * A polite live region: a screen-reader user is told a lead arrived
       * without focus being taken from whatever they were reading. Pressing the
       * button is what actually changes the list.
       */}
      <div role="status" aria-live="polite" className={pending > 0 ? 'mb-4' : undefined}>
        {pending > 0 && (
          <button
            type="button"
            data-testid="new-leads"
            onClick={() => void load()}
            className="w-full border border-signal bg-panel px-4 py-2 text-sm font-medium text-signal hover:bg-paper"
          >
            {pending === 1 ? '1 new lead arrived' : `${String(pending)} new leads arrived`} — show
            them
          </button>
        )}
      </div>

      {/* --- bulk bar ----------------------------------------------------- */}

      {merging ? (
        <MergePanel
          contacts={contacts.filter((contact) => selected.has(contact.id))}
          onCancel={() => setMerging(false)}
          onMerge={(survivorId, duplicateId) => {
            void (async () => {
              setNotice(null);
              setFailure(null);
              const result = await contactApi.merge(survivorId, duplicateId);
              if (!result.ok) {
                setFailure(result);
                return;
              }
              setMerging(false);
              setNotice(
                `Merged. ${String(result.data.movedSubmissions)} submission${
                  result.data.movedSubmissions === 1 ? '' : 's'
                } moved to ${result.data.contact.email}.`,
              );
              await load();
            })();
          }}
        />
      ) : (
        selected.size > 0 &&
        canWorkflow && (
          <BulkBar
            count={selected.size}
            capabilities={capabilities}
            members={members}
            canMerge={canMerge && selected.size === 2}
            onMerge={() => setMerging(true)}
            onAction={(action, extra) => void runBulk(action, extra)}
            onClear={() => setSelected(new Set())}
          />
        )
      )}

      {/* --- list --------------------------------------------------------- */}

      {loading ? (
        <p className="text-sm text-muted">Loading leads.</p>
      ) : contacts.length === 0 ? (
        <EmptyState hasFilters={filterCount > 0 || filter.search !== ''} />
      ) : (
        <>
          {canWorkflow && (
            <label className="mb-2 flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="h-4 w-4 accent-signal"
              />
              Select all {contacts.length} shown
            </label>
          )}

          <ul
            data-testid="contact-list"
            className="divide-y divide-edge border border-edge bg-panel"
          >
            {contacts.map((contact) => (
              <ContactRow
                key={contact.id}
                contact={contact}
                selectable={canWorkflow}
                selected={selected.has(contact.id)}
                onToggle={() => toggle(contact.id)}
              />
            ))}
          </ul>

          {nextCursor !== null && (
            <div className="mt-4">
              <Button variant="secondary" onClick={() => void loadMore()}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------

interface TextFilterProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: string;
  readonly placeholder?: string;
  readonly maxLength?: number;
}

function TextFilter({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  maxLength,
}: TextFilterProps): React.JSX.Element {
  const id = `filter-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-muted"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full border border-edge bg-panel px-3 py-2 text-sm text-ink placeholder:text-muted"
      />
    </div>
  );
}

interface ContactRowProps {
  readonly contact: ContactSummary;
  readonly selectable: boolean;
  readonly selected: boolean;
  readonly onToggle: () => void;
}

/**
 * One lead.
 *
 * Two lines of content and one of provenance. The provenance line is the point
 * of difference: it says how many times this person has submitted and when they
 * last did, which is what tells you whether you are looking at a first enquiry
 * or somebody who has now asked three times.
 */
function ContactRow({
  contact,
  selectable,
  selected,
  onToggle,
}: ContactRowProps): React.JSX.Element {
  const label = contact.name ?? contact.email;

  return (
    <li className="flex items-start gap-3 p-4">
      {selectable && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          // Every checkbox in a list needs its own name, or a screen-reader
          // user hears "checkbox" fifty times with no way to tell them apart.
          aria-label={`Select ${label}`}
          className="mt-1 h-4 w-4 shrink-0 accent-signal"
        />
      )}

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <Link
            to={`/workspace/contacts/${contact.id}`}
            className="text-sm font-medium text-ink underline decoration-edge underline-offset-4 hover:decoration-signal"
          >
            {label}
          </Link>
          <ContactStatusChip status={contact.status} />
          {contact.tags.map((tag) => (
            <span
              key={tag}
              className="border border-edge px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted"
            >
              {tag}
            </span>
          ))}
        </p>

        {contact.name !== null && <p className="mt-0.5 text-sm text-muted">{contact.email}</p>}

        <p className="mt-1 font-mono text-[11px] tracking-[0.02em] text-muted">
          {contact.submissionCount === 1
            ? '1 submission'
            : `${String(contact.submissionCount)} submissions`}
          {' · last '}
          <time dateTime={contact.lastSubmissionAt}>
            {new Date(contact.lastSubmissionAt).toLocaleDateString()}
          </time>
        </p>
      </div>
    </li>
  );
}

interface BulkBarProps {
  readonly count: number;
  readonly capabilities: readonly string[];
  readonly members: readonly MemberSummary[];
  /** True only when merging is permitted AND exactly two rows are selected. */
  readonly canMerge: boolean;
  readonly onMerge: () => void;
  readonly onAction: (action: ContactBulkAction, extra?: Record<string, string>) => void;
  readonly onClear: () => void;
}

/**
 * Actions for the selected rows (blueprint 4.7).
 *
 * Which buttons exist is decided by the capability list the SERVER derived for
 * this caller, not by reading the role here. A Member does not see a
 * soft-delete button that would be refused; the button is absent, which is the
 * same treatment the audit-log link gets in the workspace bar.
 *
 * It sits in the flow above the list rather than floating over it: a fixed
 * overlay would cover rows, need its own focus management, and move under a
 * keyboard user rather than being the next thing they tab to.
 */
function BulkBar({
  count,
  capabilities,
  members,
  canMerge,
  onMerge,
  onAction,
  onClear,
}: BulkBarProps): React.JSX.Element {
  const [tag, setTag] = useState('');
  const canDelete = capabilities.includes('contact.delete');

  return (
    <section
      data-testid="bulk-bar"
      aria-label="Actions for selected leads"
      className="mb-4 border border-signal bg-panel p-4"
    >
      <div className="flex flex-wrap items-end gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-signal">
          {count === 1 ? '1 selected' : `${String(count)} selected`}
        </p>

        <div className="w-44">
          <Select
            label="Set status"
            defaultValue=""
            onChange={(event) => {
              if (event.target.value !== '') onAction('status', { status: event.target.value });
            }}
          >
            <option value="">Set status…</option>
            {CONTACT_STATUS_VALUES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-52">
          <Select
            label="Assign to"
            defaultValue=""
            onChange={(event) => {
              if (event.target.value !== '')
                onAction('assign', { assigneeUserId: event.target.value });
            }}
          >
            <option value="">Assign to…</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.email}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex items-end gap-2">
          <div className="w-36">
            <label
              htmlFor="bulk-tag"
              className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-muted"
            >
              Tag
            </label>
            <input
              id="bulk-tag"
              type="text"
              value={tag}
              onChange={(event) => setTag(event.target.value)}
              className="w-full border border-edge bg-panel px-3 py-2 text-sm text-ink"
            />
          </div>
          <button
            type="button"
            disabled={tag.trim() === ''}
            onClick={() => onAction('tag', { tag: tag.trim() })}
            className="border border-edge px-3 py-2 text-sm text-ink hover:bg-paper disabled:opacity-55"
          >
            Add tag
          </button>
        </div>

        <button
          type="button"
          onClick={() => onAction('archive')}
          className="border border-edge px-3 py-2 text-sm text-ink hover:bg-paper"
        >
          Archive
        </button>

        {canMerge && (
          /*
           * Merging is offered only for exactly two rows. The API takes one
           * survivor and one duplicate, and asking somebody to merge five leads
           * at once would be asking them to approve four decisions they cannot
           * see - so the button appears when the question is answerable.
           */
          <button
            type="button"
            data-testid="bulk-merge"
            onClick={onMerge}
            className="border border-edge px-3 py-2 text-sm text-ink hover:bg-paper"
          >
            Merge these two
          </button>
        )}

        {canDelete && (
          <button
            type="button"
            data-testid="bulk-delete"
            onClick={() => onAction('delete')}
            className="border border-danger px-3 py-2 text-sm text-danger hover:bg-danger-soft"
          >
            Move to trash
          </button>
        )}

        <button
          type="button"
          onClick={onClear}
          className="ml-auto text-sm text-muted underline decoration-edge underline-offset-4 hover:text-ink"
        >
          Clear selection
        </button>
      </div>
    </section>
  );
}

interface MergePanelProps {
  readonly contacts: readonly ContactSummary[];
  readonly onCancel: () => void;
  readonly onMerge: (survivorId: string, duplicateId: string) => void;
}

/**
 * Choosing which of two leads survives (blueprint 9.3).
 *
 * Rendered in place rather than in a dialog. The rest of this app is built on
 * native semantic elements and has deliberately avoided composite widgets, and
 * a modal is the one that most often ships with broken focus handling. An
 * inline panel that replaces the action bar needs none of that machinery and
 * keeps both leads visible while the choice is made.
 *
 * The panel says what merging does BEFORE it happens, because it cannot be
 * undone: the duplicate is retired and its history moves.
 */
function MergePanel({ contacts, onCancel, onMerge }: MergePanelProps): React.JSX.Element {
  const first = contacts[0];
  const second = contacts[1];
  const [survivorId, setSurvivorId] = useState(first?.id ?? '');

  if (first === undefined || second === undefined) {
    return (
      <section aria-label="Merge leads" className="mb-4 border border-edge bg-panel p-4">
        <p className="text-sm text-ink">Select exactly two leads to merge.</p>
        <button
          type="button"
          onClick={onCancel}
          className="mt-3 border border-edge px-3 py-2 text-sm text-ink hover:bg-paper"
        >
          Cancel
        </button>
      </section>
    );
  }

  const duplicate = survivorId === first.id ? second : first;

  return (
    <section
      data-testid="merge-panel"
      aria-labelledby="merge-heading"
      className="mb-4 border border-signal bg-panel p-4"
    >
      <h2 id="merge-heading" className="text-sm font-semibold text-ink">
        Merge these two leads
      </h2>
      <p className="mt-1.5 text-sm text-muted">
        Pick the one to keep. Every submission, note, and consent record from the other moves onto
        it, and the other is retired. This cannot be undone.
      </p>

      <fieldset className="mt-4">
        <legend className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          Keep this lead
        </legend>
        <div className="space-y-2">
          {[first, second].map((contact) => (
            <label key={contact.id} className="flex items-center gap-3 text-sm text-ink">
              <input
                type="radio"
                name="survivor"
                value={contact.id}
                checked={survivorId === contact.id}
                onChange={() => setSurvivorId(contact.id)}
                className="h-4 w-4 accent-signal"
              />
              <span>
                {contact.name ?? contact.email}
                <span className="ml-2 font-mono text-[11px] text-muted">
                  {contact.email}
                  {' \u00b7 '}
                  {contact.submissionCount === 1
                    ? '1 submission'
                    : `${String(contact.submissionCount)} submissions`}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className="mt-3 font-mono text-[11px] tracking-[0.02em] text-muted">
        {duplicate.email} will be retired.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          data-testid="confirm-merge"
          onClick={() => onMerge(survivorId, duplicate.id)}
          className="border border-signal bg-signal px-3 py-2 text-sm font-medium text-white hover:bg-signal-hover"
        >
          Merge and retire {duplicate.email}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="border border-edge px-3 py-2 text-sm text-ink hover:bg-paper"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}

/**
 * Nothing to show.
 *
 * Two different situations that must not share a message: a workspace with no
 * leads at all needs to know where leads come from, and a filter that matched
 * nothing needs to know the filter is why.
 */
function EmptyState({ hasFilters }: { readonly hasFilters: boolean }): React.JSX.Element {
  return (
    <div
      data-testid="contacts-empty"
      className="border border-edge bg-panel px-5 py-10 text-center"
    >
      {hasFilters ? (
        <>
          <p className="text-sm font-medium text-ink">No leads match these filters.</p>
          <p className="mt-1.5 text-sm text-muted">
            Clear a filter, or widen the date range, to see more.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-ink">No leads yet.</p>
          <p className="mt-1.5 text-sm text-muted">
            Publish a widget and add it to your site. Everyone who submits it appears here.
          </p>
          <p className="mt-4">
            <Link
              to="/workspace/widgets"
              className="text-sm text-signal underline decoration-signal/40 underline-offset-4 hover:decoration-signal"
            >
              Go to widgets
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
