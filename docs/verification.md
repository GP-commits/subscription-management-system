# Verification results — 2026-10-31

Runtime: Windows, Node.js 24.14.1, npm 11.11.0. All results below were executed locally against the delivered source.

| Check                       | Result                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| Backend `npm test`          | 28 passed, 0 failed, 0 skipped; approximately 2.3 seconds                                             |
| Frontend `npm test`         | 17 passed across 2 test files, 0 failed                                                               |
| Frontend `npm run build`    | Passed; static production bundle generated                                                            |
| Backend `npm audit --json`  | 0 known vulnerabilities reported                                                                      |
| Frontend `npm audit --json` | 0 known vulnerabilities reported, including development dependencies                                  |
| Online database backup      | Backup API completed; SQLite integrity check returned `ok`                                            |
| Restore validation          | Application reopened backup; 3 users, 6 subscriptions, 12 invoices, and 8 payments matched the source |

## Backend coverage

Fifteen acceptance scenarios exercise the complete business journeys: unique accounts and password policy; roles and customer isolation; password resets and secure portal invitations; products and the 560 variant surcharge; templates; plan minimums and availability; all four billing cadences; quotation validity; activation, pause, resume, closure, renewal; missed-period recovery; duplicate billing requests; transaction rollback; durable restart; taxes and discount rules; invoice snapshots, printing and sending; partial/final payments and reversals; and financial reporting.

Seven domain tests cover calendar boundaries, exact rounding, password boundaries, variant snapshots, allocating near-total discounts across 100 tiny lines, tax allocation, and escaping invoice markup. Three proxy tests cover limiter isolation and rejection of ambiguous proxy trust. Two SMTP tests exercise actual transport against a local receiver, persisted delivery status, avoiding resend of successful mail, and production/development configuration boundaries.

## Representative load

The load test uses an isolated in-memory SQLite database containing 5,000 subscriptions and 5,000 invoices. One local HTTP client takes five samples per endpoint. Latest maximum observations:

| Endpoint                         |  Maximum |
| -------------------------------- | -------: |
| Subscription first page          |   2.6 ms |
| Filtered subscriptions, page 150 |   5.7 ms |
| Invoice first page               |   1.5 ms |
| Invoices, page 150               |   2.1 ms |
| Report summary                   | 153.9 ms |

This establishes the tested API response times only. It is not a measurement of every browser screen, production network latency, or concurrent-user capacity.

## Frontend coverage

Thirteen jsdom/Testing Library workflows and four utility tests cover authentication, password validation, reset requests, reset completion, role navigation, restricted profile updates, product and variant creation, server validation errors, payment reversal confirmation, loading/error states, invoice detail/confirmation, portal invitations, and money/date formatting. Network responses are mocked in these component tests; the backend is tested separately through real HTTP requests.

## Unverified external conditions

- Interactive browser preview was declined by the browser approval gate, including localhost. No visual screenshot review, browser-driven end-to-end test, or full-page two-second performance claim is made.
- Real external email requires the business's SMTP settings. Local SMTP transport passed; internet mailbox delivery has not been configured or tested.
- Hosting, HTTPS, deployment concurrency, and the teammate's GitHub account are not configured. The source is ready to run locally; it is not an already-hosted production service.
- The Zoho demo was not accessible through the browser approval gate. The frontend follows a billing-dashboard layout with the requested Odoo palette, rather than a verified pixel-exact reproduction.

See [acceptance traceability](acceptance.md) for individual requirement cases and [operations](operations.md) for configuration and deployment steps.
