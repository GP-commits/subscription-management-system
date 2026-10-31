# Brightloop Subscription Management

Backend for the subscription-management application described in the supplied PDF: customer accounts, plans and variants, quotations, subscription lifecycle, scheduled recurring invoices, taxes, discounts, payments, and reports.

The React frontend is delivered separately for the teammate's GitHub account. It is intentionally excluded from this repository. It connects through the documented HTTP API and does not import backend source.

## Quick start

Install Node.js 24.14 or a newer Node 24 release, then:

```sh
npm run setup
cd backend
cp .env.example .env
npm run seed
npm run dev
```

On Windows PowerShell, `Copy-Item .env.example .env` also works. The API is available at http://localhost:4000/api. Unpack the separate frontend source, run `npm ci`, then `npm run dev` in its directory. Open http://localhost:5173.

The seed command creates demonstration data and these local-only accounts:

| Role     | Email                    | Demo password   |
| -------- | ------------------------ | --------------- |
| Admin    | admin@brightloop.test    | AdminPass!23    |
| Staff    | staff@brightloop.test    | StaffPass!23    |
| Customer | customer@brightloop.test | CustomerPass!23 |

Never seed a production database. Production bootstraps an administrator from environment variables and requires configured SMTP. Local development records outgoing messages in an administrator-only outbox when SMTP is absent.

## Behavior

- Unique customer emails, the PDF's password rules, hashed passwords, cookie sessions, reset links, and role/ownership checks.
- Admin catalog with products, variant surcharges, all four billing intervals, plan policies, tax rules, discount rules, and quotation templates.
- Draft -> Quotation -> Confirmed -> Active -> Closed subscription workflow, plus plan-controlled pause/resume and renewal.
- Scheduled billing with persistent SQL transactions and a unique subscription/service-period constraint. Retry and outage recovery preserve issued invoices.
- Immutable invoice snapshots, confirmation/cancellation, HTML email, printable invoices, partial payments, and payment reversals.
- Filtered active-subscription, invoiced-revenue, cash-collection, outstanding-balance, and overdue reports.

Read [billing decisions](docs/billing-decisions.md) for defaults where the brief is silent, including the distinction between plan fees and product prices. Invoices start Draft until confirmed by staff.

## Verification

```sh
npm test
```

Tests use isolated databases and a local SMTP receiver. GitHub Actions runs the backend suite. The separate frontend includes its own test/build workflow.

See [acceptance coverage](docs/acceptance.md) and [verification results](docs/verification.md) for executed checks and limits. The PDF's two-second page target must also be validated on the intended deployment, network, and concurrency; API benchmarks alone do not establish every browser page's load time.

## Layout

- `backend/src/`: API, security, database, billing engine, mail delivery, server, and demo data.
- `backend/test/`: domain, API, financial integrity, access, email, and performance tests.
- `backend/scripts/backup.mjs`: verified online SQLite backup.
- `docs/api.md`: frontend integration contract.
- `docs/requirements.md`: PDF traceability checklist.
- `docs/operations.md`: configuration, deployment, backup, and recovery.

SQLite storage must be persistent. The supported deployment is a single backend process behind HTTPS; see [operations](docs/operations.md). No payment gateway or jurisdiction-specific tax filing service is assumed by the brief; payments are recorded against invoices. The brief mandates no particular technology provider. Local operation requires no paid backend service.

## Collaboration

The first commit is `initial commit`. Use focused feature branches and pull requests for subsequent changes. Do not commit `.env`, database files, secrets, or actual customer records. The owner will provide the frontend destination account separately.
