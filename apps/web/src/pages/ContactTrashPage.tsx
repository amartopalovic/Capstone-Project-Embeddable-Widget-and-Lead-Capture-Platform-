import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { ContactSummary } from '@lcp/contracts';
import { contactApi, type ApiFailure } from '../lib/api.js';
import { Alert, ContactStatusChip } from '../components/ui.jsx';

/**
 * Deleted leads, recoverable for 30 days (blueprint 9.5, 4.7).
 *
 * A separate page rather than a tab on the inbox. The trash answers a different
 * question - "did we lose something?" - and blueprint 4.7 restricts recovery to
 * Owner/Admin, so keeping it separate means the whole surface is behind one
 * capability instead of half a page being conditionally hidden.
 *
 * Reaching it without `contact.delete` is refused by the API, and this page
 * shows that refusal rather than pretending the trash is empty. An empty trash
 * and a forbidden trash are different facts.
 */
export function ContactTrashPage(): React.JSX.Element {
  const [contacts, setContacts] = useState<readonly ContactSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const result = await contactApi.trash('');
    setLoading(false);
    if (!result.ok) {
      setFailure(result);
      return;
    }
    setFailure(null);
    setContacts(result.data.contacts);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function restore(contact: ContactSummary): Promise<void> {
    setNotice(null);
    setFailure(null);
    const result = await contactApi.recover(contact.id);
    if (!result.ok) {
      setFailure(result);
      return;
    }
    setNotice(`${contact.email} is back in your inbox.`);
    await load();
  }

  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <p className="mb-6">
        <Link
          to="/workspace/contacts"
          className="text-sm text-muted underline decoration-edge underline-offset-4 hover:text-ink hover:decoration-signal"
        >
          Back to the inbox
        </Link>
      </p>

      <header className="mb-8 border-b border-edge pb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal">Trash</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Deleted leads</h1>
        <p className="mt-2 text-sm text-muted">
          Deleted leads stay here for 30 days. After that their details are removed for good.
        </p>
      </header>

      {notice !== null && <Alert tone="success">{notice}</Alert>}
      {failure !== null && <Alert tone="error">{failure.message}</Alert>}

      {loading ? (
        <p className="text-sm text-muted">Loading the trash.</p>
      ) : failure !== null ? null : contacts.length === 0 ? (
        <div
          data-testid="trash-empty"
          className="border border-edge bg-panel px-5 py-10 text-center"
        >
          <p className="text-sm font-medium text-ink">The trash is empty.</p>
          <p className="mt-1.5 text-sm text-muted">Nothing has been deleted in the last 30 days.</p>
        </div>
      ) : (
        <ul data-testid="trash-list" className="divide-y divide-edge border border-edge bg-panel">
          {contacts.map((contact) => (
            <li
              key={contact.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 p-4"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                  {contact.name ?? contact.email}
                  <ContactStatusChip status={contact.status} />
                </p>
                {contact.name !== null && (
                  <p className="mt-0.5 text-sm text-muted">{contact.email}</p>
                )}
                <p className="mt-1 font-mono text-[11px] tracking-[0.02em] text-muted">
                  {contact.submissionCount === 1
                    ? '1 submission'
                    : `${String(contact.submissionCount)} submissions`}
                </p>
              </div>

              <button
                type="button"
                data-testid={`restore-${contact.email}`}
                onClick={() => void restore(contact)}
                className="border border-edge px-3 py-2 text-sm text-ink hover:bg-paper"
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
