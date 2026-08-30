import type { NextFunction, Request, Response } from 'express';
import {
  ERROR_CODES,
  createErrorPayload,
  httpStatusForErrorCode,
  type ApiFieldError,
  type ErrorCode,
  type Logger,
} from '@lcp/contracts';
import { CSRF_ERROR_CODE } from './csrf.js';
import { nullErrorReporter, type ErrorReporter } from '../../ports/error-reporter.js';

/**
 * Typed application error carrying a machine-readable code.
 *
 * The message must always be safe to return to a client: no driver text, no
 * stack, no identifier belonging to another tenant.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details: readonly ApiFieldError[] | undefined;

  constructor(code: ErrorCode, message: string, details?: readonly ApiFieldError[]) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Terminal error handler.
 *
 * Blueprint section 10.1 requires that malformed or oversized input never
 * becomes a 500, so the two cases Express raises itself - a JSON parse failure
 * and a body-size overflow - are translated into their proper 4xx codes rather
 * than falling through to the generic branch.
 *
 * This is also where blueprint 16.3's "expected validation, authentication,
 * spam, and rate-limit responses are not reported as application crashes" is
 * implemented, and it is implemented by SHAPE rather than by a list. Every
 * branch above the last one is an answer this server meant to give, and none of
 * them reports anything. Only the final branch - the one that produces a 500
 * because nothing understood the error - reaches the monitoring service. An
 * expected error introduced by some future stage is therefore excluded by
 * construction, without anybody remembering to exclude it.
 */
export function errorHandler(logger: Logger, reporter: ErrorReporter = nullErrorReporter) {
  return (error: unknown, request: Request, response: Response, next: NextFunction): void => {
    if (response.headersSent) {
      next(error);
      return;
    }

    const correlationId = request.correlationId ?? 'unknown';

    if (error instanceof ApiError) {
      response
        .status(httpStatusForErrorCode(error.code))
        .json(createErrorPayload(error.code, error.message, correlationId, error.details));
      return;
    }

    const asRecord = error as {
      type?: string;
      status?: number;
      statusCode?: number;
      code?: string;
    };

    // CSRF rejection from csrf-csrf. Without this it would fall through to the
    // generic branch and surface as a 500, hiding a legitimate 403.
    if (asRecord.code === CSRF_ERROR_CODE || asRecord.statusCode === 403) {
      response
        .status(httpStatusForErrorCode(ERROR_CODES.CSRF_INVALID))
        .json(
          createErrorPayload(
            ERROR_CODES.CSRF_INVALID,
            'CSRF token missing or invalid',
            correlationId,
          ),
        );
      return;
    }

    // Express body-parser failures.
    if (asRecord.type === 'entity.too.large') {
      response
        .status(httpStatusForErrorCode(ERROR_CODES.PAYLOAD_TOO_LARGE))
        .json(
          createErrorPayload(
            ERROR_CODES.PAYLOAD_TOO_LARGE,
            'Request body is too large',
            correlationId,
          ),
        );
      return;
    }
    if (asRecord.type === 'entity.parse.failed' || asRecord.status === 400) {
      response
        .status(httpStatusForErrorCode(ERROR_CODES.MALFORMED_REQUEST))
        .json(
          createErrorPayload(
            ERROR_CODES.MALFORMED_REQUEST,
            'Request body could not be parsed',
            correlationId,
          ),
        );
      return;
    }

    // Anything else is genuinely unexpected. Log it with its name only; the
    // message could contain values that must not be logged (section 16.1).
    logger.error('request.unhandled_error', {
      correlationId,
      errorName: error instanceof Error ? error.name : 'unknown',
      result: 'server_error',
    });

    reporter.captureException(error, {
      correlationId,
      event: 'request.unhandled_error',
      workspaceId: request.workspaceScope?.workspaceId.toHexString(),
      userId: request.session?.userId,
    });

    response
      .status(httpStatusForErrorCode(ERROR_CODES.INTERNAL_ERROR))
      .json(
        createErrorPayload(
          ERROR_CODES.INTERNAL_ERROR,
          'An unexpected error occurred',
          correlationId,
        ),
      );
  };
}
