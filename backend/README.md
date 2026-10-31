# Brightloop backend

Independent Node.js 24 application with Express, persistent SQLite, an embedded recurring-billing worker, SMTP delivery, and cookie sessions. Node 24's built-in SQLite API is marked experimental.

## Run locally

```sh
npm ci
cp .env.example .env
npm run seed
npm run dev
```

On Windows, copy `.env.example` to `.env` using your editor or `Copy-Item`. The API listens on `http://127.0.0.1:4000/api`; run the frontend separately at `http://localhost:5173`. Use localhost consistently for frontend/API cookies, or configure the frontend dev proxy to `/api`.

The explicit `seed` command creates demo data only if the catalog is empty. It never runs automatically and refuses `NODE_ENV=production`. Demo credentials:

| Role     | Email                    | Password        |
| -------- | ------------------------ | --------------- |
| Admin    | admin@brightloop.test    | AdminPass!23    |
| Staff    | staff@brightloop.test    | StaffPass!23    |
| Customer | customer@brightloop.test | CustomerPass!23 |

Never load demo accounts into a public deployment. For a fresh production database, set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and optionally `ADMIN_NAME` once to create the initial administrator, then remove the bootstrap password from the environment. Existing admin accounts are not overwritten.

## Commands

- `npm start`: API and one-minute billing/email worker.
- `npm run billing`: one billing and email-delivery pass; suitable for an external scheduler.
- `npm test`: acceptance, arithmetic, calendar, email, access-control, and representative-volume tests.
- `npm run seed`: explicit development seed.

Use either the embedded worker or an external scheduler. Multiple billing workers remain protected by SQL transactions and unique subscription-period keys. Each run processes at most 1,000 periods per subscription; larger backlogs continue on the next run without skipping periods. Do not run multiple email delivery workers against one SQLite file; SMTP transport may deliver twice after an ambiguous crash, and must be reconciled by message ID.

## Environment

`PORT=4000`, `BIND_HOST=127.0.0.1`, `DATABASE_PATH=./data/brightloop.sqlite`, `FRONTEND_URL=http://localhost:5173`, `CURRENCY=INR`, `NODE_ENV=development`. Production needs `NODE_ENV=production`, HTTPS at the reverse proxy, the exact frontend origin, a durable database volume, and SMTP settings. Use same-site frontend/API origins for SameSite cookies; a reverse proxy to `/api` is recommended. `BIND_HOST=0.0.0.0` is needed inside a container.

`TRUST_PROXY=0` is the direct-access default and ignores forwarded IP headers. Set `TRUST_PROXY=1` only when every API request passes through exactly one trusted reverse proxy and the API port is inaccessible directly; it lets authentication rate limits distinguish client IPs. Other values are rejected. Do not enable it with variable proxy paths or publicly accessible direct API ports.

`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` configure real delivery. Port 465 enables implicit TLS; port 587 uses STARTTLS where provided. Production refuses to start without SMTP_HOST. Without SMTP in development, messages remain in the administrator-only development outbox, so reset links can be inspected locally. No email is sent externally by demo seeding.

All reset tokens and session tokens are random, hashed at rest, expiring, and single-use where appropriate. Passwords use scrypt. Resetting a password revokes existing sessions. Only admins create staff or change catalog/tax/discount rules. Customer ownership is checked on lists, details, print views, actions, and reports. Financial writes use database transactions, and confirmed invoices are immutable snapshots.

For customers entered by staff, use **Invite to portal** on their customer record. The setup link goes to their billing email and links the login to their existing subscriptions. Public registration cannot claim an existing billing record just by entering its email address. Profile changes update billing details; login identity email changes require a separate verified support process.

## Billing policies where the brief is silent

- Advance billing with UTC date boundaries. Expiry is exclusive and must align to full billing periods. Daily, weekly, monthly, and yearly intervals are supported. Month-end and leap-year anchors are retained.
- Plan price is an explicit base fee in addition to product lines. Set it to zero when products contain all charges. Selected variants add to the input base unit price.
- Each subscription stores contractual plan and line snapshots; catalog edits do not reprice existing subscriptions or change their lifecycle policy.
- Pause first accounts for any due periods, then suppresses future billing. Resume retains the original calendar anchor and starts billing at the next boundary on or after the resume date. There is no mid-period proration, and skipped paused periods are not billed. Closure preserves unpaid invoices.
- Automatic closure occurs only after all due periods through expiry are recorded. Renewal extends the same subscription with historical invoices preserved. Renewing a previously expired closed term starts on today's date and requires a newly aligned expiry.
- Exclusive tax applies after discounts. Empty tax product selection means all eligible products. Explicit line tax selections restrict the automatic tax rules.
- One eligible discount applies per invoice, in creation order. Fixed and percentage discounts support product/subscription scope, dates, thresholds, and global usage limits. Draft invoices reserve usage; confirmation consumes it; cancelling a draft releases it. A confirmed redemption remains consumed after cancellation, so it cannot be reused to circumvent a usage limit.
- Generated invoices start Draft. Staff confirm them before sending or collecting payments. Cancelled periods remain accounted for and do not silently regenerate.
- Partial payments and payment reversals are supported; overpayments are rejected. External payment references are unique among recorded payments. There is no automatic card charging in the PDF; payments are manually recorded.
- Revenue excludes tax and is reported separately from cash receipts. Outstanding and overdue balances reflect current confirmed invoices, while selected dates filter invoice revenue and cash receipts. MRR is gross contractual recurring price before tax and discounts, normalized as daily ×365/12, weekly ×52/12, monthly ×1, yearly ÷12. It is not formal accounting revenue recognition.

## Database and recovery

The database is created/migrated on startup, versioned by `schema_version`, with foreign keys and WAL enabled. Store its directory on a durable local volume. Use the provided backup script or SQLite's online backup facilities; copying the main `.sqlite` file while WAL writes are active can omit transactions. Test restoration before production use. Billing retries are idempotent, email failures stay visible in the outbox, and sensitive changes are audited. Production SMTP failures require operator monitoring; this repository does not configure external alerting or infrastructure.

## Contract and tests

The shared API documentation is in `../docs/api.md`. `createApp({dbPath,now,bootstrapAdmin,disableRateLimit,frontendUrl,smtp})` provides isolated test databases; it returns an Express application with `app.locals.runBilling`, `app.locals.flushEmails`, and `app.locals.close`. Test timestamps are controlled independently of production scheduling.
