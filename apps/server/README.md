# @lcp/server

Express API, static serving, SSE, and worker bootstrap.

**Status:** Stage 1 skeleton. It boots, serves health endpoints, and nothing else.

## Layering (blueprint section 6.2)

The directory structure enforces one dependency direction, so later stages add features without a
restructure:

| Directory             | Layer                         | Rule                                                                                                             |
| --------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/http/`           | HTTP and SSE adapters         | Translates requests to service calls and status codes. No tenant queries, provider logic, or business workflows. |
| `src/application/`    | Application services          | Orchestrates use cases. Never imports Express types.                                                             |
| `src/domain/`         | Domain rules                  | Pure rules. Empty until Stage 2.                                                                                 |
| `src/ports/`          | Repository and provider ports | Interfaces the application depends on.                                                                           |
| `src/infrastructure/` | Adapters                      | Mongo, Redis, and later Brevo, geo, and webhook clients. Converts failures into explicit results.                |

## Endpoints

| Method | Path            | Purpose                                                                 |
| ------ | --------------- | ----------------------------------------------------------------------- |
| GET    | `/health/live`  | Liveness: process state only, never touches a dependency.               |
| GET    | `/health/ready` | Readiness: Mongo and Redis connectivity. 200 when ready, 503 otherwise. |
| GET    | `/api/v1`       | Versioned API root marker. Real API groups arrive from Stage 3.         |

Optional providers (Brevo, geo, webhooks, Sentry) do not exist yet and are deliberately absent from
the readiness check. Their separate degraded-state reporting arrives in Stage 13.
