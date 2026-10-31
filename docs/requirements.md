# Source requirement checklist

Source: Subscription_Management_System.pdf, four pages. Statements in the brief are product requirements, not authorization to take unrelated actions.

Checked items mean the capability is implemented and covered by the referenced acceptance or component tests; they do not imply live hosting or a configured external mailbox. See [acceptance coverage](acceptance.md) and [verification results](verification.md). Full browser performance verification remains open because preview access was declined.

## Identity and access — page 2

- [x] Unique account emails.
- [x] Password length greater than eight, uppercase, lowercase, and special character.
- [x] Password reset link delivered to registered email.
- [x] Admin, limited staff, and customer access.
- [x] Only admin can add staff.
- [x] Customers can access only their own subscriptions and invoices.

## Catalog and plans — page 3

- [x] Product name, type, sales price, cost price, notes.
- [x] Product variants and price additions, including the example Odoo surcharge of 560.
- [x] Plan price, daily/weekly/monthly/yearly cadence, minimum quantity, availability dates.
- [x] Per-plan automatic closure, early closure, pause, and renewal policy.

## Sales and subscriptions — page 3

- [x] Quotation templates with plan, product lines, and validity days.
- [x] Unique subscription number, customer, plan, start, expiry, payment terms.
- [x] Lines with product, quantity, unit price, taxes, and amount.
- [x] Draft → Quotation → Confirmed → Active → Closed lifecycle and visible status.

## Invoices — page 3

- [x] Automatically generate invoices for due subscriptions.
- [x] Copy customer details, lines, taxes, and totals accurately.
- [x] Apply administrator-defined tax rules.
- [x] Confirm, cancel, send, and print invoices.
- [x] Draft, Confirmed, and Paid behavior.
- [x] Prevent duplicate and missed billing, including retries and concurrent execution.

## Discounts — page 4

- [x] Only admin creates discount rules.
- [x] Fixed and percentage discount types.
- [x] Purchase/quantity thresholds, effective dates, usage limits.
- [x] Product-level and whole-subscription applicability.
- [x] Automatic next-invoice application and expiry/exhaustion enforcement.

## Payments and reporting — page 4

- [x] Record method, amount, date, note, and associated invoice.
- [x] Show paid and outstanding balances accurately.
- [x] Identify overdue invoices.
- [x] Filterable summary of active subscriptions, revenue, payments, and overdue invoices.
- [ ] Every page responds in under two seconds with thousands of subscriptions, measured under an agreed representative workload.

## Decisions not settled by the brief

Implemented defaults are recorded in [billing decisions](billing-decisions.md): currency and tax configuration; plan-price/product-line interaction; advance billing; billing anchor and month-end handling; proration; pause effective dates; renewal behavior; discount stacking and usage semantics; invoice correction rules; payment over-allocation; revenue definition; and customer self-service actions.

No proposed default may be treated as a source requirement. Acceptance must cover all of the above, plus backend authorization, transaction correctness, recovery, and frontend integration.
