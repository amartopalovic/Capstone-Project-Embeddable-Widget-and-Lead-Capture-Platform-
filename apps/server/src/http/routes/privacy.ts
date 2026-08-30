import { Router } from 'express';
import {
  ERROR_CODES,
  completePrivacyRequestSchema,
  confirmOptInSchema,
  startPrivacyRequestSchema,
  unsubscribeSchema,
  validate,
  type Logger,
  type PrivacyRequestStarted,
} from '@lcp/contracts';
import type { ConsentService } from '../../application/privacy/consent-service.js';
import type { PrivacyRequestService } from '../../application/privacy/privacy-request-service.js';
import { ApiError } from '../middleware/error-handler.js';

/**
 * The public consent and privacy surface (blueprint 4.8).
 *
 * Everything here is reached by somebody with no account and no session, from a
 * link in an email or a page on a customer's site. That shapes three rules the
 * routes hold to.
 *
 * **The token is the authorization.** There is no session to check and nothing
 * useful in the request beyond the token, so the services verify a signature or
 * a stored hash and derive the workspace from what it proves. No route here
 * reads a workspace id from a body or a query string.
 *
 * **Answers never confirm existence.** Starting a privacy request returns the
 * same body whether or not the address is a lead. A consent link that cannot be
 * acted on returns the same message whatever the reason. Without that, these
 * endpoints become a way to test addresses against a customer's lead list.
 *
 * **POST, not GET.** Following a link lands on a page in the web app, which
 * then posts the token. An unsubscribe carried out by a GET would be triggered
 * by any mail client or corporate scanner that prefetches links - people would
 * be unsubscribed by software that merely looked at their inbox.
 */

export const PUBLIC_PRIVACY_PREFIX = '/public/v1';

export interface PrivacyRouterDeps {
  readonly consent: ConsentService;
  readonly privacyRequests: PrivacyRequestService;
  readonly logger: Logger;
}

/** The same answer for every start, whatever was found. */
const STARTED: PrivacyRequestStarted = {
  accepted: true,
  message:
    'If that address has data in this workspace, a confirmation email is on its way. The link expires in 24 hours.',
};

export function createPrivacyRouter(deps: PrivacyRouterDeps): Router {
  const router = Router();
  const { consent, privacyRequests } = deps;

  router.post('/consent/unsubscribe', async (request, response, next) => {
    try {
      const parsed = validate(unsubscribeSchema, request.body);
      if (!parsed.ok) {
        throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'That link is not valid', parsed.errors);
      }
      response.status(200).json(await consent.unsubscribe(parsed.data.token));
    } catch (error) {
      next(error);
    }
  });

  router.post('/consent/confirm', async (request, response, next) => {
    try {
      const parsed = validate(confirmOptInSchema, request.body);
      if (!parsed.ok) {
        throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'That link is not valid', parsed.errors);
      }
      response.status(200).json(await consent.confirmOptIn(parsed.data.token));
    } catch (error) {
      next(error);
    }
  });

  router.post('/privacy/requests', async (request, response, next) => {
    try {
      const parsed = validate(startPrivacyRequestSchema, request.body);
      if (!parsed.ok) {
        throw new ApiError(
          ERROR_CODES.VALIDATION_FAILED,
          'Check the submitted fields',
          parsed.errors,
        );
      }

      /**
       * Awaited, but its result is discarded on purpose.
       *
       * The service returns nothing about what it found, and the response is
       * the same constant either way - see the note at the top of this file.
       */
      await privacyRequests.start(parsed.data);
      response.status(202).json(STARTED);
    } catch (error) {
      next(error);
    }
  });

  router.post('/privacy/requests/complete', async (request, response, next) => {
    try {
      const parsed = validate(completePrivacyRequestSchema, request.body);
      if (!parsed.ok) {
        throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'That link is not valid', parsed.errors);
      }

      const result = await privacyRequests.complete(parsed.data.token);
      if (result === null) {
        /**
         * One answer for expired, already used, unknown, and pointing at a
         * contact that no longer exists. A 404 that distinguished them would
         * tell somebody probing tokens which of their guesses was close.
         */
        throw new ApiError(
          ERROR_CODES.NOT_FOUND,
          'This link is no longer valid. It may have expired or already been used.',
        );
      }

      response.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
