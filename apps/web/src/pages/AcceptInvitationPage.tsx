import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { AuthenticatedUser } from '@lcp/contracts';
import { api, workspaceApi } from '../lib/api.js';
import { Alert, AuthPanel, Button } from '../components/ui.jsx';

/**
 * Redeem an invitation link (blueprint 4.1, journey 2 in 18.3).
 *
 * Unlike the auth endpoints, which answer generically on purpose so they cannot
 * be used to probe who has an account, this endpoint's outcomes are all about a
 * workspace the caller was deliberately invited to. There is nothing to leak,
 * so each outcome gets its own message and its own next step - being told
 * "something went wrong" when the real answer is "confirm your email first"
 * would leave someone with no way forward.
 */
type Outcome =
  | { readonly kind: 'working' }
  | { readonly kind: 'joined' }
  | { readonly kind: 'missing_token' }
  | { readonly kind: 'signed_out'; readonly token: string }
  | { readonly kind: 'verify_first'; readonly email: string }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'full' };

export function AcceptInvitationPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'working' });

  useEffect(() => {
    async function run(): Promise<void> {
      if (token === null || token === '') {
        setOutcome({ kind: 'missing_token' });
        return;
      }

      const me = await api.get<{ user: AuthenticatedUser }>('/auth/me');
      if (!me.ok) {
        setOutcome({ kind: 'signed_out', token });
        return;
      }

      const result = await workspaceApi.acceptInvitation(token);
      if (result.ok) {
        setOutcome({ kind: 'joined' });
        // Land them in the workspace; the server already made it active.
        await navigate('/workspace', { replace: true });
        return;
      }

      const email = me.data.user.email;
      switch (result.code) {
        case 'email_not_verified':
          setOutcome({ kind: 'verify_first', email });
          return;
        case 'not_found':
          setOutcome({ kind: 'unavailable' });
          return;
        case 'quota_exceeded':
          setOutcome({ kind: 'full' });
          return;
        default:
          setOutcome({ kind: 'invalid' });
      }
    }
    void run();
  }, [token, navigate]);

  async function signOut(): Promise<void> {
    await api.post('/auth/logout');
    await navigate(`/login?next=${encodeURIComponent(`/invitations/accept?token=${token ?? ''}`)}`);
  }

  switch (outcome.kind) {
    case 'working':
      return (
        <AuthPanel eyebrow="Invitation" title="Checking your invitation">
          <p className="text-sm text-muted">One moment.</p>
        </AuthPanel>
      );

    case 'joined':
      return (
        <AuthPanel eyebrow="Invitation" title="You're in">
          <Alert tone="success">You have joined the workspace.</Alert>
        </AuthPanel>
      );

    case 'missing_token':
      return (
        <AuthPanel eyebrow="Invitation" title="That link is incomplete">
          <Alert tone="error">
            This invitation link is missing its code. Open the link from your email again, or ask
            for a new invitation.
          </Alert>
        </AuthPanel>
      );

    case 'signed_out':
      return (
        <AuthPanel
          eyebrow="Invitation"
          title="Sign in to join"
          intro="Invitations are accepted by a signed-in account, so we know who is joining."
        >
          <div className="flex flex-col gap-3">
            <Link
              to={`/login?next=${encodeURIComponent(`/invitations/accept?token=${outcome.token}`)}`}
              className="inline-flex w-full items-center justify-center bg-signal px-4 py-2.5 text-sm font-medium text-white hover:bg-signal-hover"
            >
              Sign in
            </Link>
            {/*
             * A brand-new recipient registers with the invited address. They do
             * not have to come back here afterwards: confirming their email
             * redeems every invitation waiting for that address.
             */}
            <Link
              to="/register"
              className="inline-flex w-full items-center justify-center border border-edge bg-panel px-4 py-2.5 text-sm font-medium text-ink hover:bg-paper"
            >
              Create an account
            </Link>
          </div>
          <p className="mt-5 text-sm text-muted">
            Use the address the invitation was sent to. Once you confirm it, you will be added
            automatically.
          </p>
        </AuthPanel>
      );

    case 'verify_first':
      return (
        <AuthPanel eyebrow="Invitation" title="Confirm your email first">
          <Alert tone="info">
            We sent a link to {outcome.email}. Open it, and you will join this workspace
            automatically - you will not need this invitation again.
          </Alert>
          <Link
            to="/account"
            className="inline-flex w-full items-center justify-center border border-edge bg-panel px-4 py-2.5 text-sm font-medium text-ink hover:bg-paper"
          >
            Go to your account
          </Link>
        </AuthPanel>
      );

    case 'unavailable':
      return (
        <AuthPanel eyebrow="Invitation" title="That workspace is gone">
          <Alert tone="error">
            The workspace behind this invitation is no longer available. Ask whoever invited you for
            a new link.
          </Alert>
        </AuthPanel>
      );

    case 'full':
      return (
        <AuthPanel eyebrow="Invitation" title="That workspace is full">
          <Alert tone="error">
            This workspace has reached its 10-person limit. Ask the Owner to make room and invite
            you again.
          </Alert>
        </AuthPanel>
      );

    case 'invalid':
      /**
       * One answer for every way a redemption can fail, including being signed
       * in as someone the invitation was not sent to.
       *
       * That is the server's deliberate choice, not a gap here: telling a
       * signed-in stranger "this invitation is for someone else" would confirm
       * that an intercepted link is a real, live invitation. The suggestion
       * below is shown for ALL failures, so it helps the person who genuinely
       * used the wrong account without confirming anything to anyone else.
       */
      return (
        <AuthPanel eyebrow="Invitation" title="That link did not work">
          <Alert tone="error">
            This invitation is invalid, expired, or has already been used. Invitations last 7 days.
          </Alert>
          <p className="mb-5 text-sm text-muted">
            If you were invited at a different address, sign out and open the link again from that
            account.
          </p>
          <Button type="button" variant="secondary" onClick={() => void signOut()}>
            Sign out and use another account
          </Button>
        </AuthPanel>
      );
  }
}
