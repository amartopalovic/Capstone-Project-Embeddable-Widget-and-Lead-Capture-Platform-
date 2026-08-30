# Stage 14 pre-completion security and privacy audit

Audit performed August 30–31, 2026, Europe/Sarajevo. This is the additional security gate requested before completing Stage 14, **not Stage 15**.

## Decision

**Not yet approved for a public push or production launch.** No actual credential was identified, but publication of the existing personal Git identity needs an explicit decision, and two deployment/development exposure risks remain open. No remote is configured, nothing was pushed, no credential was rotated, and no history was rewritten.

Severity follows the supplied audit prompt: Critical means confirmed secret/personal information; High means a potential exploitable disclosure path; Note means an implementation detail, limitation, or non-secret hygiene issue. A Critical here is not a claim of an account compromise.

| Severity | Findings |  Fixed in this audit | Open operator decisions |
| -------- | -------: | -------------------: | ----------------------: |
| Critical |        1 |                    0 |                       1 |
| High     |        5 |                    3 |                       2 |
| Note     |        4 | See individual notes |    See individual notes |

## Scope and reproducibility

Baseline: `main`, HEAD `58e2216907f06ed9e62fad01675cae945a9266d7`. Existing uncommitted Stage 14 work was preserved.

The read-only scanner added for this audit inspects current first-party files, including untracked and ignored environment/build files; all reachable Git blobs; commit/tag messages; and author/committer identities. Values are fingerprinted, not printed. The ordinary scanner now also includes untracked, non-ignored files, but **it is not the history scan**.

```powershell
node scripts/scan-secrets.mjs
node scripts/audit-private-information.mjs
```

Observed quick-scan output:

```text
secret scan: clean
```

Final expanded scan after browser-artifact cleanup (including this report):

```json
{
  "currentFirstPartyFiles": 1251,
  "reachableCommits": 20,
  "uniqueHistoricalBlobs": 799,
  "credentialCandidates": 0,
  "literalCandidateFingerprints": 28,
  "nonReservedEmailFingerprints": 2,
  "currentNonReservedEmailLocations": 0,
  "userSpecificPathLocations": 0
}
```

The 28 distinct literal candidates were reviewed in context: 22 test-only strings, two example placeholders, two non-secret configuration values, and two error-code constants. The two non-reserved historical email fingerprints are the synthetic malformed-submission fixture (N1) and a vendor's no-reply co-author attribution, not customer data. Git author/committer metadata is reported separately under C1.

Excluded directories are `.git` (objects scanned through Git instead), `node_modules`, `.agents`, `.codex`, and `tmp`. Binary/NUL-containing files and current files over 16 MiB are not text-scanned. This is a shape/literal scan with source review, **not proof that every possible secret encoding is absent**, nor a claim that TruffleHog was run locally. CI's history-aware TruffleHog job was inspected but not executed on a remote service. Unreachable objects, reflogs, other repositories, provider accounts, deployed logs, and third-party storage are outside this local audit. The supplied PDF was read and rendered privately, not copied into the repository.

## Findings

### C1 — Personal Git identity in every existing commit — OPEN

The same personal author/committer name and Gmail address occur in all 20 commits. This is real identifying metadata, not a fixture. A public push publishes it even when every source file is clean. The full address is intentionally omitted from this report.

Reproduce without echoing the address:

```powershell
node scripts/audit-private-information.mjs | ConvertFrom-Json | ForEach-Object {
  $_.gitIdentityCandidates | ForEach-Object {
    [pscustomobject]@{ fingerprint=$_.fingerprint; reservedEmail=$_.reservedEmail; commits=$_.commits.Count }
  }
}
```

Observed: fingerprint `b19230bc9052`, `reservedEmail: false`, `commits: 20`. The full scanner lists every affected commit hash; the newest is the baseline HEAD above and the oldest is `f07109d186c6cc1f8e6400444c17278d5bca6695`.

**Operator action:** explicitly accept this identity being public, or request a separate backup-and-history-cleanup plan using the desired no-reply identity. Changing Git configuration only affects future commits. No configuration, commit, attribution, branch, or history was changed by this audit.

### H1 — Failure diagnostics could emit private values — FIXED

Structured logging did not redact direct email/name/value fields or arbitrary provider text under `reason`, `error`, and `detail`. Submission, geo, queue, delivery, retention, and pub/sub failure paths pass such text to the logger. Startup/migration/seed catches printed raw messages, backup helpers echoed tool stderr, and Redis clients without error listeners could use ioredis's raw stderr fallback.

Reproduction command, using synthetic data only:

```powershell
node --import tsx scripts/probe-privacy-leaks.mjs
```

Before: `"loggerLeaksSyntheticPrivateValue": true`. After: `false`.

**Fix:** extended central key redaction; suppressed raw startup/backup error text; stopped configuration validation from echoing invalid values; attached safe Redis/queue/subscriber error listeners. Backup success output no longer prints local paths. Event names, IDs, counts, result categories, and supported structural diagnostics remain. Application decisions and retry classifications were not changed.

Regression commands:

```powershell
node node_modules/vitest/vitest.mjs run --project unit-contracts --project unit-server
node --test scripts/security-audit.test.mjs
```

Tests cover info/warn/error records, nested lead fields, provider errors, invalid environment values, Redis error events, and both child-process stderr and spawn errors. Tool-test output: `tests 2`, `pass 2`, `fail 0`. Future new arbitrary log keys still require review: key redaction is not a general-purpose semantic PII detector.

### H2 — Sentry scrubbers missed errors, breadcrumbs, and trace fields — FIXED

Both scrubbers left synthetic private text in exception messages and other enrichment. Browser breadcrumbs could retain navigation URLs and arbitrary data; server request query/env/context fields also remained. Only error-event hooks were configured; transaction/span paths did not share the privacy policy.

Same reproduction command as H1. Before:

```json
{
  "loggerLeaksSyntheticPrivateValue": true,
  "serverSentryLeaksSyntheticPrivateValue": true,
  "browserSentryLeaksSyntheticPrivateValue": true
}
```

After:

```json
{
  "loggerLeaksSyntheticPrivateValue": false,
  "serverSentryLeaksSyntheticPrivateValue": false,
  "browserSentryLeaksSyntheticPrivateValue": false
}
```

**Fix:** one shared allowlist in `packages/contracts/src/telemetry-privacy.ts`, used by both SDKs. It removes free-text error values, source context/local paths, request bodies/headers/cookies/query/env, unknown context, breadcrumb messages/data, URL origins/query/fragments/unknown path segments, and span attributes/descriptions. User ID and explicitly permitted operational IDs remain. `beforeSend`, `beforeSendTransaction`, and `beforeSendSpan` are wired; SDK log export is rejected. `sendDefaultPii` remains false. Installed SDK hook types were checked in `node_modules/@sentry/core/build/types/types/options.d.ts`.

New contract tests cover errors, transactions, separate spans, unknown SDK enrichment, URL credentials, breadcrumbs, and input immutability. No real Sentry DSN was used and no report was transmitted. This proves the local outbound scrubber policy, not the state of an existing Sentry project. Redaction deliberately reduces free-text monitoring detail.

### H3 — Secret scanner could print prefixes and bypass a whole line — FIXED

The previous scanner printed the first 24 source characters as its “redacted” excerpt. A credential at the beginning of a line would therefore be partially disclosed in CI output. A fixture address or placeholder anywhere on a line exempted that whole line from scanning.

Historical evidence command:

```powershell
git show HEAD:scripts/scan-secrets.mjs
```

Relevant original lines:

```javascript
const head = trimmed.slice(0, 24);
if (ALLOWED.some((allowed) => allowed.test(line))) continue;
```

**Fix:** report only path, line, rule, and SHA-256 fingerprint; apply placeholder checks to each match rather than the whole line; include untracked non-ignored files. The new full-history scanner has no whole-line exemptions.

```powershell
node --test scripts/security-audit.test.mjs
```

Observed: `scanner never prints token prefixes and does not exempt whole placeholder lines` passed. The test builds an obviously synthetic token in memory and checks plain, fixture-email, and placeholder-suffixed lines. These tool regressions are now included in CI. No actual secret was echoed during this audit.

### H4 — Unauthenticated local services published on every interface — OPEN

`docker-compose.yml` publishes MongoDB, Redis, and Mailpit without host-address restrictions or service authentication. Host-run Vite servers also bind all interfaces. An accessible LAN interface can therefore expose local test databases, Redis state, or captured email; actual remote reachability depends on the host/network firewall and was not penetration-tested.

```powershell
docker compose ps --format '{{.Service}} {{.Ports}}'
```

Observed during the local test run:

```text
mailpit 0.0.0.0:1025->1025/tcp, [::]:1025->1025/tcp, 0.0.0.0:8025->8025/tcp, [::]:8025->8025/tcp
mongo 0.0.0.0:27017->27017/tcp, [::]:27017->27017/tcp
redis 0.0.0.0:6379->6379/tcp, [::]:6379->6379/tcp
```

**Operator action:** approve localhost-only host publishing and host-run development-server binding, preserving container-internal reachability. This changes LAN accessibility, so it was requested rather than silently applied. Never put real customer data into these unauthenticated local services. [Docker documents the effect of publishing ports and binding addresses](https://docs.docker.com/engine/network/port-publishing/).

### H5 — Production geo enrichment sends raw visitor IP over HTTP — OPEN

`IpApiGeoProvider.lookup()` places the visitor's IP into an unencrypted outbound HTTP URL. `render.yaml` enables geo enrichment, and the runtime defaults it on in production. The IP need not be persisted locally to be disclosed to a network observer or the vendor. The HTTPS fallback still receives raw IPs as part of the intended enrichment feature.

```powershell
rg -n 'http://ip-api.com|GEO_ENABLED' apps/server/src/infrastructure/geo/providers.ts apps/server/src/config/env.ts render.yaml
```

Relevant source evidence:

```typescript
const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city,timezone`;
```

The Render entry is `GEO_ENABLED` with `value: 'true'`. [The provider's official documentation confirms that its free endpoint does not support HTTPS](https://ip-api.com/docs/api:json).

**Operator action:** approve disabling geo for launch (`GEO_ENABLED=false` and an explicit default-policy decision), or choose an approved HTTPS-capable provider and review the associated IP-data disclosure. No provider was changed, no paid service was selected, and no visitor IP was sent by this audit. All local tests use geo disabled or deterministic fakes.

### N1 — Synthetic fixtures, with a non-reserved address cleaned up

Six malformed-submission fixtures used an address on a non-reserved domain, fingerprint `80305c9bb1bb`. They were visibly synthetic invalid-payload tests, not observed customer records. Current fixtures now use `malformed@example.invalid`; an SSN-shaped dummy field was replaced with `not-a-real-ssn`.

Reproduce with the full scanner. Before: current locations in `apps/server/tests/submission.integration.test.ts` at lines 279, 294, 302, 316, 326, 330. After: zero current non-reserved email locations. Historical occurrences remain in blobs `d3c91a7f3321979e81de6a7e7058a06f00be90bb` and `a97484b206f53c00cc5eda2ba5a9409bf7dcafc0`. No history rewrite is warranted merely for this clearly synthetic fixture.

Other test emails use reserved example domains. Test passwords/keys are tied to synthetic fixtures; this is not permission to reuse them in production. Commit-message fingerprint `cd29c5ac348a` was inspected separately and is a vendor no-reply attribution, not a personal mailbox.

### N2 — Public responses, headers, and build artifacts verified locally

```powershell
node scripts/probe-public-security.mjs
```

This starts the compiled Express application in production mode, binds its HTTP listener to loopback, seeds a unique local synthetic database, and removes only that database/key namespace afterward. It does not exercise a deployed Render service or live external vendors.

Observed response summary:

```json
{
  "authForeignOrigin": { "status": 401, "allowOrigin": null, "allowCredentials": null },
  "demoCors": "* without credentials",
  "widgetAllowed": 200,
  "widgetForeignOrigin": 403,
  "publicProjection": "pass",
  "malformedBodyPrivateEcho": false,
  "firstPartyPublicSourceMaps": 0,
  "swaggerVendorMapStatus": 200
}
```

All of `/` (200), `/api/v1` (200), `/api-reference` (200), `/health/ready` (200), and `/api/does-not-exist` (404) returned:

```text
Strict-Transport-Security: max-age=63072000; includeSubDomains
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: accelerometer=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()
X-Powered-By: absent
```

Actual CSP values:

```text
Dashboard: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'
API: default-src 'none';form-action 'none';base-uri 'none';frame-ancestors 'none';object-src 'none'
Swagger: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'
```

The inline-style allowance is deliberate for React/Swagger; inline scripts remain prohibited. Demo CSP is also exercised by the built-demo browser suite; Render's static HTTP-header configuration was inspected but not live-verified. HSTS over local plain HTTP is header verification, not proof of deployed TLS.

Public widget configuration uses `toPublicConfig`, excluding notification recipients, webhook secrets, and private targeting configuration. Demo config/feed return public IDs, widget descriptions, and aggregate/activity summaries, not captured field values. The public OpenAPI route is `/api/v1/openapi.json`; schemas are not sampled tenant responses. The dedicated production error-handler regression returns the generic 500 envelope without injected email, driver text, stack, or filesystem path. Integration tests cover auth, CSRF, tenant isolation, and failure-response headers.

No `.map` files were found in the three first-party public build directories. Server/package TypeScript maps exist but are not served from those directories. Swagger's publicly served vendor map contains 1,650 vendor source entries, zero first-party source entries, and zero user-specific path entries. It is not an application source-map leak.

### N3 — Environment files and dependency audit

```powershell
git ls-files '*.env' '.env*' '*.pem' '*.key' '*.p12' '*.pfx' '*.log' '*.dump' '*.bson'
npm audit --json
```

Tracked-sensitive-file query output: `.env.example` only. That template contains placeholders/local endpoints, not live values. `render.yaml` uses operator-supplied/generated secrets. README, BUILDLOG, EVIDENCE, deployment/recovery instructions, checklist, source fixtures, and untracked Stage 14 files were included in the content scan. Browser `VITE_` values are public build inputs; never place server credentials in them.

The refreshed dependency audit exited 0:

```json
{
  "vulnerabilities": {},
  "metadata": {
    "vulnerabilities": { "info": 0, "low": 0, "moderate": 0, "high": 0, "critical": 0, "total": 0 },
    "dependencies": {
      "prod": 179,
      "dev": 277,
      "optional": 98,
      "peer": 18,
      "peerOptional": 0,
      "total": 483
    }
  }
}
```

This is a point-in-time advisory result, not a guarantee of vulnerability absence. No dependency upgrade or lockfile rewrite was needed. The network request sent dependency metadata, not application/customer data.

### N4 — Stage 14 deployment verification remains separate

No production credentials, service URLs, cloud-account configuration, deployed access logs, historical Sentry events, real backup archive, or live provider accounts were available to inspect. Consequently this audit cannot certify those surfaces. No real restore, live send, deployment, cold-start measurement, or remote CI run was performed.

The existing deployment verifier also has a known false-negative condition:

```powershell
rg -n 'demo config did not echo|access-control-allow-origin' scripts/verify-deployment.mjs
```

It demands the exact demo origin for `/demo/v1/config`, whereas the live local probe above confirms the intended public `*` response without credentials. Before using that verifier for Stage 14 acceptance, adjust its demo-only expectation while retaining strict widget-origin and no-credentials checks. Public wildcard demo CORS itself is not a private-data disclosure.

The dashboard's current `connect-src 'self'` also does not permit a direct external browser Sentry endpoint. Any future CSP monitoring exception must be narrowly scoped and preserve the new scrubbers; do not broaden it to `*`. This audit did not change the CSP or external reporting behavior.

## Final local verification

Commands are invoked directly with Node on this Windows checkout because npm lifecycle shell handling of the workspace's ampersand is already documented in README section 5.4. This changes invocation, not which tests execute.

```powershell
node node_modules/vitest/vitest.mjs run --project unit-contracts --project unit-runtime --project unit-server --project integration-database --project integration-server
node node_modules/@playwright/test/cli.js test
node --test scripts/security-audit.test.mjs
node scripts/backup-crypto-self-test.mjs
node --import tsx scripts/probe-privacy-leaks.mjs
node scripts/probe-public-security.mjs
node node_modules/eslint/bin/eslint.js .
node node_modules/prettier/bin/prettier.cjs --check .
git diff --check
```

Final combined unit/integration run: **36 files passed, 722 tests passed** (394 unit and 328 integration), duration 315.39 seconds. Final complete browser run: **164 passed (23.6 minutes)**. Both security-tool regressions passed: **888 tests total across these suites**. Package builds, all workspace/E2E typechecks, lint, formatting, and diff checks passed. The final synthetic privacy probe returned three `false` leak flags and the production-mode HTTP probe passed. The backup crypto self-test passed its streaming round trip and rejected the wrong passphrase; it is not a database restore rehearsal. The dashboard build retained its non-fatal large-chunk warning.

The browser run emitted one `request.unhandled_error` with `errorName: MongoServerError` during workspace switching, despite passing every assertion. Its log contained only correlation/class/result metadata, not the raw driver message or private values. Its underlying cause was not determined by this privacy audit; the passing suite is not a claim that no server error occurred.

The final quick scan was clean; the repeated history/current-tree scan returned zero credential-shape findings, zero current non-reserved email locations, and the same open Git-identity finding. The three temporary PDF renders and isolated HTTP-probe databases/key namespaces were removed. The earlier interrupted HTTP probe's exact leftover synthetic database was identified and removed separately. MongoDB, Redis, and Mailpit were stopped after testing, preserving existing volumes/data; `docker compose ps --status running --format '{{.Service}}'` returned no running services. Stopping them mitigates current exposure but does not fix H4's configuration.

An earlier combined run passed 721 of 722 tests; the export-audit assertion raced the deliberately post-stream Mongo write (`expected null not to be null`). Only the test was corrected to poll for its workspace-scoped audit record before asserting. No production export behavior changed. Earlier browser runs were intentionally interrupted to incorporate final Redis/config diagnostics and transaction-timing preservation; none is counted as a passing full run.

## Operator handoff

1. Decide whether the existing personal Git identity may be published, or request a separate cleanup plan (C1).
2. Approve localhost-only development exposure, or document the intentional trusted-network exception (H4).
3. Disable geo for launch or approve an HTTPS-based enrichment/privacy policy (H5).
4. Revisit the Stage 14 deployment-specific checks in N4 with actual operator configuration, then rerun the scanners immediately before publishing.

Until these decisions are resolved, the safe-to-push answer is **no**. Stage 14 remains open and Stage 15 has not started.
