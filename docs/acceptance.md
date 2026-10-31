# Acceptance and verification

This matrix traces the supplied four-page brief to checks. A planned check is not a passing result. The test-run evidence at the end records what was actually executed; live SMTP delivery and production deployment need configured external services.

## Source traceability

| ID      | Brief requirement                                                     | Concrete acceptance scenario                                                                                                                                                                           |
| ------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AUTH-01 | Unique account email                                                  | Register once; register a case/whitespace-normalized duplicate and expect rejection.                                                                                                                   |
| AUTH-02 | Password longer than eight; uppercase, lowercase, special character   | Reject an eight-character password and passwords missing each class; accept a compliant password.                                                                                                      |
| AUTH-03 | Email password reset                                                  | Request reset; verify recipient and link in development outbox; consume token once, reject reuse, log in with new password. With SMTP configured, confirm delivery to a controlled mailbox.            |
| AUTH-04 | Admin, limited staff, customer roles                                  | Admin can create staff and rules; staff/customer cannot escalate themselves or create staff, taxes, discounts, or plans. Unauthenticated reads fail.                                                   |
| AUTH-05 | Customer portal ownership                                             | Create two customers. Customer A cannot list, read, modify, print, send, or pay customer B's records by changing an ID.                                                                                |
| CAT-01  | Product fields                                                        | Create and retrieve name, type, sales price, cost price, and notes. Customer responses do not expose internal cost price.                                                                              |
| CAT-02  | Variant price additions                                               | Product base 100 plus Odoo variant 560 yields unit price 660 and a two-unit subtotal of 1,320. Reject variant from another product.                                                                    |
| PLAN-01 | Price, cadence, minimum quantity, availability                        | Persist all plan fields; test daily, weekly, monthly, yearly periods; reject quantity below minimum and unavailable plan purchases.                                                                    |
| PLAN-02 | Auto-close, early close, pause, renew                                 | Enable each policy and verify transition; disable it and verify rejection. Expired auto-closing subscriptions stop future billing.                                                                     |
| SALE-01 | Templates with plan, lines, validity                                  | Create template and generate quotation; verify copied plan/lines and expiry. Template edits do not change existing quotations.                                                                         |
| SUB-01  | Subscription identity and fields                                      | Unique number, customer, plan, start/expiry, payment terms, line quantity/unit price/taxes/amount persist.                                                                                             |
| SUB-02  | Draft → Quotation → Confirmed → Active → Closed                       | Complete sequence; reject skipped/invalid transitions and expired quotation acceptance.                                                                                                                |
| BILL-01 | Automatic due invoices                                                | Activate subscription, run due work, verify period, snapshot, tax and total. Scheduler invokes the same production billing service.                                                                    |
| BILL-02 | No duplicates or skipped periods                                      | Repeat billing run, run concurrent requests, and rerun after missed periods. Exactly one invoice per eligible period; schedule advances only after durable invoice creation.                           |
| TAX-01  | Admin tax rules                                                       | Apply a 10% rule to discounted taxable subtotal; verify rounding and frozen issued values after changing the rule.                                                                                     |
| INV-01  | Confirm, cancel, send, print                                          | Draft confirms, unpaid confirmed invoice can cancel under documented policy; paid invoice cannot silently cancel. Send produces email; print is readable HTML with correct totals.                     |
| INV-02  | Draft, Confirmed, Paid                                                | New invoice starts Draft; confirmation leaves unpaid balance; partial payment leaves balance; exact remaining payment produces Paid.                                                                   |
| DISC-01 | Admin-only fixed and percentage discounts                             | Staff creation rejected; fixed amount and percentage calculations correct.                                                                                                                             |
| DISC-02 | Thresholds, dates, usage limits                                       | Below-threshold, future and expired rules are ignored; eligible rule applies; exhausted usage does not apply again.                                                                                    |
| DISC-03 | Product and subscription scopes                                       | Product rule only reduces eligible product lines; whole-subscription discount allocates across eligible lines.                                                                                         |
| DISC-04 | Automatic next-invoice application and expiry                         | Attach an eligible rule, generate the next invoice, verify automatic discount; subsequent invoices stop at expiry/exhaustion.                                                                          |
| PAY-01  | Method, amount, date, note, invoice                                   | Record partial and final payments; retrieve all submitted fields; reject negative and over-allocated amounts.                                                                                          |
| PAY-02  | Paid, outstanding, overdue                                            | Past-due unpaid invoice appears overdue; partial settlement reduces outstanding; full settlement removes it.                                                                                           |
| RPT-01  | Active subscriptions, revenue, payments, overdue; filters and summary | Compare report to independently calculated invoice/payment fixtures; apply customer/status/date filters and verify no unrelated records.                                                               |
| PERF-01 | Under-two-second pages with thousands of subscriptions                | Seed at least 3,000 subscriptions; measure representative paginated API and report response times. Separately verify browser loading/render time under an agreed network and concurrent-user workload. |

## Financial and calendar edge cases

- Monthly anchor 31 January → 28/29 February → 31 March; yearly leap-day behavior is explicit.
- Billing periods are start-inclusive and end-exclusive; UTC date boundaries are deterministic.
- Discount never produces a negative taxable amount; percentage is between 0 and 100.
- Rounding occurs at the documented currency precision using decimal arithmetic.
- Immutable invoice/customer/product snapshots survive catalog edits.
- Email retries do not create another invoice.
- Pause/resume and expiry behavior do not silently rebill a previously invoiced period.
- Invoice cancellation remains auditable and does not reopen a period for accidental duplicate billing.

## Execution

From `backend/`, run `npm test`. Independent acceptance coverage lives in `test/acceptance.test.js`; load checks live in `test/performance.test.js`. Tests use isolated databases and local HTTP servers rather than a production database or email recipients.

Frontend build, component tests, browser journeys, and production email delivery are separate validation layers. Passing API tests alone does not establish that every page meets the PDF's performance requirement.

## Run evidence

Executed on 2026-10-31 with Node 24.14.1 on Windows:

```text
cd backend
npm test
25 tests passed; 0 failed; 0 skipped (2.23 seconds)
```

That run includes 15 independent acceptance scenarios in `test/acceptance.test.js`, seven domain checks in `test/domain.test.js`, the load check in `test/performance.test.js`, and two local SMTP-transport checks in `test/smtp.test.js`. Test totals may increase as additional checks are added; rerun the command for current evidence.

The acceptance scenarios exercised:

- Registration password rules, normalized duplicate rejection, roles, session revocation, single-use and expired reset links, untrusted-origin rejection, and verified invitations linking staff-created billing profiles to portal identities (AUTH-01 through AUTH-05).
- The 560 variant surcharge, rejected foreign variants, hidden internal cost, catalog snapshots, minimum quantity, unavailable plans, all four billing cadences, calendar anchors and expired-term closure (CAT-01/02, PLAN-01/02).
- Template copying, quotation expiry, invalid/valid lifecycle transitions, pause across a billing boundary, no backbilling of a closed gap on renewal, and permitted/forbidden customer lifecycle actions (SALE-01, SUB-01/02).
- Duplicate and concurrent billing requests, missed-period catch-up, an injected SQL write failure with rollback, and safe retries after closing/reopening a persistent database (BILL-01/02).
- Fixed and percentage discounts, product/subscription scopes, amount/quantity thresholds, future/expired rules, limited-use reservations, cancellation and immutable tax calculations (TAX-01, DISC-01 through DISC-04).
- Invoice confirmation/cancellation, protected printable HTML and queued email, partial/final payments, overpayment rejection, reversals, overdue balances, and financial summaries (INV-01/02, PAY-01/02, RPT-01).

Load fixture: 5,000 subscriptions and 5,000 confirmed invoices; isolated in-memory SQL database; local HTTP server; one client; five samples per endpoint.

| Endpoint                       |   Median | Maximum / nearest-rank p95 of five samples |
| ------------------------------ | -------: | -----------------------------------------: |
| Subscription first page        |   1.2 ms |                                     2.4 ms |
| Subscription filtered page 150 |   4.8 ms |                                     5.3 ms |
| Invoice first page             |   1.0 ms |                                     1.1 ms |
| Invoice page 150               |   1.1 ms |                                     2.3 ms |
| Reports summary                | 136.1 ms |                                   150.5 ms |

These measurements pass the local API check; they do not establish production browser performance, concurrent-user capacity, network latency, or every screen's end-to-end loading time. SMTP tests use a controlled local mail server and verify transport and persisted delivery status; production mailbox delivery still depends on real SMTP configuration.
