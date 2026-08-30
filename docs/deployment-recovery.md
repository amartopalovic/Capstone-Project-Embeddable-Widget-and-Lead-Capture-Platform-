# Production-demo deployment and recovery rehearsal

Status: repository preparation complete; live provider setup and the five deployed checks are not
yet performed. Do not mark Stage 14 complete or replace any `TBD` URL until every result below is
recorded.

This runbook deploys exactly one public environment. There is no staging environment. Provider
secrets belong in Render environment variables and nowhere in Git, shell history, screenshots, or
evidence transcripts.

## 1. Current provider facts that shape this deployment

- Render free web services sleep after 15 minutes without inbound traffic and take about a minute to
  wake. They have no shell, one-off jobs, persistent disks, or paid pre-deploy command. Static sites
  are free. See [Render free instances](https://render.com/docs/free) and
  [Render deploys](https://render.com/docs/deploys).
- `render.yaml` uses `autoDeployTrigger: checksPass`, the current Blueprint field for deploying only
  after the linked branch's CI checks pass. See the
  [Render Blueprint specification](https://render.com/docs/blueprint-spec).
- Atlas Free clusters have no managed backup. MongoDB explicitly directs Free-cluster users to
  `mongodump` and `mongorestore`. See
  [Atlas backup and restore](https://www.mongodb.com/docs/atlas/backup-restore-cluster/) and
  [MongoDB Database Tools](https://www.mongodb.com/docs/database-tools/mongodump/).
- Upstash's current free allowance is 256 MB and 500,000 commands per month. Persistence is enabled,
  but free databases do not have paid-tier redundancy. Eviction must remain disabled so a queue or
  session write fails visibly at capacity instead of silently deleting durable work. See
  [Upstash pricing](https://upstash.com/pricing/redis),
  [durability](https://upstash.com/docs/redis/features/durability), and
  [eviction](https://upstash.com/docs/redis/features/eviction).
- Brevo Free permits 300 sends per day; this app reserves 100 for auth/privacy and caps side effects
  at 200. See [Brevo's Free-plan limit](https://help.brevo.com/hc/en-us/articles/8292912279954-Add-or-remove-emails-from-your-plan).

## 2. Accounts and values the operator must create

Choose a free plan at every step. Stop if a dashboard asks for a card or a paid upgrade.

1. **GitHub:** create one public repository, add it as `origin`, push `main`, and require the CI jobs
   in `.github/workflows/ci.yml` before merge. Record the repository URL.
2. **Atlas:** create one Free cluster in the closest EU region offered by the Free-cluster UI. Create
   an application database user scoped to `readWrite` on `leadcapture`. After Render creates the web
   service, copy its Frankfurt outbound CIDR ranges from **Connect -> Outbound** into Atlas's IP
   access list; do not use `0.0.0.0/0`. Render documents these shared regional ranges at
   [Outbound IP addresses](https://render.com/docs/outbound-ip-addresses), and Atlas documents its
   [IP access list](https://www.mongodb.com/docs/atlas/security/add-ip-address-to-list/).
3. **Upstash:** create one Free Redis database in the closest EU region, require TLS, leave eviction
   disabled, and copy the `rediss://` endpoint. The BullMQ-specific TLS shape is documented by
   [Upstash](https://upstash.com/docs/redis/integrations/bullmq).
4. **Brevo:** create a Free account, verify the sending address/domain, create an API key, and record
   the exact verified sender email. The API requires a registered sender; see
   [Brevo transactional email setup](https://developers.brevo.com/docs/send-a-transactional-email).
5. **Sentry:** create a JavaScript/Node project on the free Developer plan and copy its DSN. The same
   ingest-only DSN is used for `SENTRY_DSN` and `VITE_SENTRY_DSN`; no Sentry auth token is needed.
6. Generate the application encryption key locally and store it in the password manager before
   entering it in Render:

   ```text
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
   ```

## 3. Render Blueprint values

Create a Blueprint from `render.yaml`. It defines one Frankfurt Free Web Service and one free Static
Site. Render prompts for every `sync: false` value:

| Render key                      | Exact value/source                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `APP_BASE_URL`                  | Final `https://...onrender.com` origin of `lead-capture-platform`, no trailing slash |
| `DEMO_ORIGIN`                   | Final `https://...onrender.com` origin of `lead-capture-demo`, no trailing slash     |
| `VITE_API_ORIGIN`               | Same value as `APP_BASE_URL` (on both services)                                      |
| `MONGODB_URI`                   | Atlas SRV URI for the scoped app user; never paste into evidence                     |
| `REDIS_URL`                     | Upstash `rediss://` URI                                                              |
| `ENCRYPTION_MASTER_KEY`         | 32-byte base64 value generated above                                                 |
| `BREVO_API_KEY`                 | Brevo transactional API key                                                          |
| `BREVO_SENDER_EMAIL`            | Exact verified Brevo sender                                                          |
| `SENTRY_DSN`, `VITE_SENTRY_DSN` | Sentry project DSN                                                                   |
| `PLATFORM_OPERATOR_EMAILS`      | Verified operator login email                                                        |

`SESSION_SECRET` and `IP_HMAC_SECRET` are generated by Render. `RENDER_GIT_COMMIT` is the release
identifier; the backend reads it directly and the build maps it to `VITE_RELEASE`.

The free plan cannot use Render's paid pre-deploy command. The build command therefore runs
`npm run release` after compiling and before Render starts the new instance. `release` executes the
compiled migration and seed entrypoints. Migrations are repeatable; the seed only resets the
synthetic public sandbox and never creates or edits an ordinary workspace. Keeping it out of the
start command is deliberate: a cold wake must not reseed the sandbox and mask whether the delayed
BullMQ reset survived the sleep.

## 4. Local gate before the first deploy

From a clean clone whose path does not contain `&`:

```text
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test
docker compose up -d --wait mongo redis mailpit
npm run test:integration
npm run test:e2e
npm run build
npm run backup:self-test
npm run scan:secrets
docker compose down
```

Record every command's actual result in `EVIDENCE.md`. A local pass is not deployed proof.

## 5. Deployed checks - record pass or fail

Set `PRODUCTION_URL` and `DEMO_URL`, then run `npm run verify:deployment`. It checks readiness, the
React application, Swagger UI, the separate static site, cross-origin widget configuration, and a
real sandbox submission. Record its elapsed readiness time and output.

The remaining checks require operator state and cannot be replaced by local tests:

| Gate         | Procedure and required observation                                                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Smoke        | `/health/ready` returns 200 with MongoDB, Redis, and migration probes ready; `/`, `/api-reference`, and the demo origin render.                                                                                                                                                |
| Cross-origin | `npm run verify:deployment` receives 202 for a submission whose `Origin` is the separate demo site and the demo feed shows the event.                                                                                                                                          |
| Auth         | Register the operator email, receive the real Brevo verification message, verify, log out, log in again, and load a workspace page with a working session.                                                                                                                     |
| Queue        | In a non-demo workspace, configure a notification recipient at the operator's address, submit a published widget from an allowed origin, and observe both a `sent` delivery in the dashboard and the real Brevo message. Record the delivery id, not the recipient or content. |
| Restore      | Run the encrypted rehearsal below into the isolated `_restore_rehearsal` database, then point a temporary local process at that database and require readiness plus the expected collection/document counts. Never repoint the public service.                                 |

## 6. Encrypted export and isolated restore rehearsal

Install the current MongoDB Database Tools on the operator machine. The scripts put the URI in a
mode-0600 temporary config file instead of a command-line argument, stream `mongodump --archive
--gzip` through AES-256-GCM, and authenticate the complete ciphertext before `mongorestore` receives
any bytes.

Use a new backup passphrase from the password manager. Do not reuse the application encryption key.
In PowerShell, enter the secrets interactively so they do not land in shell history:

```powershell
$env:MONGODB_URI = Read-Host 'Atlas connection string'
$env:MONGODB_DB_NAME = 'leadcapture'
$env:BACKUP_PASSPHRASE = Read-Host 'New backup passphrase'
$env:BACKUP_FILE = Join-Path $PWD ('backups/leadcapture-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.lcpbak')
npm run backup:export
npm run backup:self-test
```

Create a separate Atlas database user with `readWrite` only on
`leadcapture_restore_rehearsal`, set `MONGODB_RESTORE_URI`, and explicitly opt into the guarded
rehearsal:

```powershell
$env:MONGODB_RESTORE_URI = Read-Host 'Restricted rehearsal-user connection string'
$env:BACKUP_REHEARSAL = 'true'
$env:BACKUP_SOURCE_DB_NAME = 'leadcapture'
$env:MONGODB_RESTORE_DB_NAME = 'leadcapture_restore_rehearsal'
npm run backup:restore
```

Clear the secret-bearing variables from the shell after recording the result:

```powershell
Remove-Item Env:MONGODB_URI, Env:MONGODB_RESTORE_URI, Env:BACKUP_PASSPHRASE
```

The restore script refuses a target that does not end in `_restore_rehearsal`, refuses the source
database as a target, verifies the authentication tag before mutation, restores with namespace
mapping, and fails if the restored database has no application documents. Keep the rehearsal
database until the result is recorded. Deleting it later is a separate destructive action requiring
explicit operator approval.

## 7. Cold-start and delayed-queue rehearsal

1. Record `/demo/v1/config`'s `seededAt` and `resetsAt`, and the authenticated diagnostics snapshot.
2. Send no traffic for at least 65 minutes. Render sleeps after 15; the hourly BullMQ sandbox-reset
   job becomes due while no process is running.
3. Request `/health/ready` and time the response. About a minute is expected on the free plan; record
   the actual value, not the expectation.
4. Poll `/demo/v1/config` until `seededAt` advances. This proves the delayed BullMQ scheduler entry
   survived in Upstash and ran after the process woke.
5. Read diagnostics again. Confirm the startup retention catch-up timestamp advanced and no queue is
   unexpectedly stuck. Run the public deployment check once more.

Do not use keep-awake traffic. A failure is recorded as a failure and investigated; it is never
converted into a paid-tier workaround.

## 8. Completion record

Only after all five deployed checks and the cold-start rehearsal have actual results:

- replace `TBD` production URLs and repository URL in `README.md` and `capstone.yaml`;
- set `project.stage_completed` to 14;
- check Stage 14 in `docs/stage-checklist.md`;
- append the exact result table and restore counts to `EVIDENCE.md` and `BUILDLOG.md`;
- record provider, region, plan, service names, release commit, and check timestamps - never secrets.
