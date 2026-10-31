# Running and operating Brightloop

## Runtime

Use Node.js 24.14 or newer within the Node 24 release line. The backend uses Node's built-in SQLite API, which emits an experimental warning in this runtime. Database files persist on the application server. Run one backend process per database file; the embedded scheduler runs with that process. Use persistent local storage, not an ephemeral serverless filesystem or a network-mounted SQLite file.

## Separate applications

The backend listens on port 4000 by default. The independently delivered React application runs on port 5173 in development and proxies `/api` to the backend. The frontend source is intentionally excluded from this GitHub repository because its destination will be the teammate's account.

For production, serve the frontend build with a web server and reverse-proxy `/api` to the backend under the same HTTPS origin. Set `FRONTEND_URL` to that exact public origin and `NODE_ENV=production`. Secure session cookies require HTTPS. Preserve the request `Origin` header and the `/api` path. Do not use the Vite development server as production hosting.

For exactly one trusted reverse proxy, set `TRUST_PROXY=1` and prevent direct public access to the API port. Keep `TRUST_PROXY=0` for a direct deployment. Configure the frontend web server to fall back to `index.html` for routes such as `/reset-password`.

## Configuration

Copy `backend/.env.example` to `backend/.env`, then set the database path, business currency, email server, public frontend URL, and initial administrator credentials. Keep this file untracked. Start using `npm start` from `backend/`. Production requires SMTP configuration and an initial administrator when the database has no users. Do not run the demo seed against production data.

## Email delivery

Without SMTP, local development records messages in the administrator-only development outbox. This intentionally does not send mail externally. Production uses SMTP and has no development reset-link endpoint. Review SMTP delivery failures and retry failed messages after fixing the service. The automated test suite exercises delivery against a local SMTP receiver; credentials and deliverability for the business's real mailbox must be configured separately.

## Backups

From `backend/`, run:

```sh
node --env-file-if-exists=.env scripts/backup.mjs /absolute/path/to/brightloop-backup.sqlite
```

The tool uses SQLite's online backup API, refuses to overwrite an existing file, and checks the resulting database integrity. This includes committed WAL data, unlike copying only the live database file.

To restore, stop the backend first. Preserve the current database and its `-wal`/`-shm` sidecars together in a separate recovery location. Set `DATABASE_PATH` to the verified backup file or a copy in a new directory, start the backend, and reconcile invoice counts, balances, and the next billing dates before allowing normal billing. Never restore over a running database.

## Billing incidents

Billing creates each subscription/service-period invoice in a transaction and records its next billing date in the same transaction. Re-running the worker is safe for already-recorded periods. Cancelling an invoice does not automatically generate a replacement. For invoice errors, preserve history and apply the supported cancellation/reversal process; never delete financial rows directly.

An outage can cause multiple periods to become due. On recovery, the scheduler catches up eligible periods. Inspect billing errors before manually changing subscription dates. Verify discount usage reservations, received payments, and customer balances after any recovery.

## Verification limits

Local tests cover application behavior and representative load, not every hosting environment. Before using real customer records, configure HTTPS and SMTP, run a backup/restore rehearsal on the deployment host, and repeat response-time measurements with the expected concurrent users and invoice history.
