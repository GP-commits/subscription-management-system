# Brightloop frontend

An independently runnable React application for Brightloop Software's subscription management system. This directory is a complete standalone frontend project: it has its own package manifest, lockfile, environment example, tests, build configuration, and GitHub Actions workflow. It can be extracted into a new repository without a monorepo dependency.

The interface uses a billing-workspace layout with a neutral sidebar, overview cards, revenue chart, invoice tables, and account screens. Its purple `#714B67`, teal `#017E84`, and neutral gray palette is inspired by the [official Odoo brand assets](https://www.odoo.com/page/brand-assets). Brightloop is the product name; this project is not an official Odoo or Zoho application. Typography requests locally installed Inter with a system-font fallback; no third-party font request is required. See [design notes](DESIGN-NOTES.md) for the approved Unslop direction, attribution, and verification limits.

## Run locally

Requires Node.js 24 or newer and the separate Brightloop backend running on port 4000.

```sh
npm ci
npm run dev
```

Open **http://localhost:5173**. The Vite development proxy sends `/api` requests to `http://127.0.0.1:4000`. The backend's `FRONTEND_URL` must be `http://localhost:5173` so Origin validation matches the browser URL. Do not switch between `localhost` and `127.0.0.1` while signed in; they have separate cookie origins.

The backend requires a database and an administrator account. Its explicit development seed provides these demo-only accounts:

| Role     | Email                    | Password        |
| -------- | ------------------------ | --------------- |
| Admin    | admin@brightloop.test    | AdminPass!23    |
| Staff    | staff@brightloop.test    | StaffPass!23    |
| Customer | customer@brightloop.test | CustomerPass!23 |

These accounts are created only by running the backend's demo seed. They are not embedded authentication bypasses, and they must not be used for production data.

## Test and build

```sh
npm test
npm run build
```

`npm test` runs Vitest with jsdom and Testing Library. All 27 tests pass. The suite exercises login/logout, registration password policy, forgot/reset-password flows, role-based navigation, customer profile restrictions, product/variant submission, API error handling, payment reversal confirmation, loading states, and monetary/date formatting. It also checks dialog keyboard containment and focus restoration, selected navigation announcements, and exact chart data across currencies, large values, zero amounts, and long histories. It mocks the network to verify frontend behavior; backend integration and billing correctness tests belong to the separate API project.

`npm run build` produces the static application in `dist/`. `npm run preview` serves it locally at port 4173; set backend `FRONTEND_URL=http://localhost:4173` before testing mutations from this origin. Browser screenshot and visual regression checks were not performed because the browser approval gate declined access; component tests and the production build were run.

## Screens and behavior

- **Authentication:** customer registration, login/logout, password reset request, and reset-link form.
- **Overview and reports:** server-provided active subscriptions, invoiced revenue, cash received, outstanding balances, overdue invoices, monthly recurring revenue, a scrollable revenue chart with an exact monthly-amount table, and date/customer/plan filters.
- **Customers:** contact and billing details; customers can edit their own permitted profile fields.
- **Catalog:** product types, sales/cost prices, notes, and variants with price adjustments.
- **Plans:** daily/weekly/monthly/yearly cadence, base fee, minimum quantity, sales availability, and closure/pause/renewal flags.
- **Quotation templates:** plans, validity days, payment terms, notes, and product lines.
- **Subscriptions:** creation from templates or custom lines, draft edits, quotation/confirmation/activation, pause/resume, closure, and renewal.
- **Invoices:** line/tax/discount totals, status and overdue filters, confirmation, cancellation, sending, and printable documents.
- **Payments:** invoice allocation, method, amount, date, reference, note, and explicit reversal confirmation.
- **Tax and discount rules:** admin-only configuration, thresholds, dates, scopes, applicability, and usage limits.
- **Team:** admin-only staff creation and activation/deactivation.
- **Customer portal:** own subscriptions, invoices, payments, and account. Backend ownership checks remain authoritative.
- **Development email outbox:** admin-only and shown by the development server. Production builds hide this entry, and the production API forbids access.

All displayed business metrics are obtained from the API. No hard-coded financial data or fake success responses are used. Lists include search, status filters where applicable, pagination, and loading/empty/error states. Dialogs contain real form controls, focus management, keyboard dismissal, and explicit confirmation for financial reversals and closure.

## Integration contract

`VITE_API_URL` defaults to `/api`. Override it at build time if required:

```env
VITE_API_URL=https://billing.example.com/api
```

Prefer serving the frontend and API behind one HTTPS origin with an `/api` reverse proxy. The backend uses `HttpOnly`, `SameSite=Lax` session cookies and Origin checks. Arbitrary cross-site hosting will not authenticate correctly without a reviewed cookie/CORS design. For supported cross-origin same-site hosting, configure the backend's exact frontend origin and credentialed CORS.

The client always uses `credentials: 'include'`. Tokens and passwords are never stored in browser local storage. Auth endpoints return `{user}`; resources return objects; paginated lists return `{items,total,page,pageSize}`; errors return `{error}`. Dates use `YYYY-MM-DD`; amounts are numbers in major currency units. The server is authoritative for taxes, discounts, variant pricing, balances, permissions, and lifecycle transitions.

Main resources: `/auth`, `/customers`, `/products`, `/plans`, `/templates`, `/subscriptions`, `/invoices`, `/payments`, `/taxes`, `/discounts`, `/staff`, `/reports/summary`, and `/billing/run`. State transitions use `POST /resource/:id/action`.

Subscription line input `unitPrice` is the base price before the variant adjustment; response lines contain the final unit price. The editor subtracts the saved adjustment before editing so a variant is not charged twice. The plan's base fee is additional to line charges. Subscriptions use calendar-aligned expiry dates; the server rejects unsupported partial periods. Pause catches up already-due billing; resume continues at the next original calendar boundary and skips paused periods. Customer lifecycle buttons respect the subscription's saved plan policy.

## Shared repository handoff

The team chose to submit frontend and backend in **GP-commits/subscription-management-system**, with independent folders and package manifests. The frontend's original commits have been imported beneath `frontend/`, preserving their authors and feature boundaries. Run `npm run check` from the repository root to verify both applications. The active frontend GitHub Actions workflow is `.github/workflows/frontend-ci.yml` at the repository root; the nested workflow is retained only for standalone extraction.

The prepared `frontend-handoff` branch can be pushed by the teammate after collaborator access is accepted, then reviewed and merged into `main`. Use the complete-repository bundle for this handoff. The older standalone frontend bundle is for a separate repository and must not replace the backend repository history.

Both applications currently run locally; neither has been deployed by this handoff. Set `VITE_API_URL` and the backend `FRONTEND_URL` together if deploying later.
