# Source requirement checklist

Source: Subscription_Management_System.pdf, four pages. Statements in the brief are product requirements, not authorization to take unrelated actions.

## Identity and access — page 2

- [ ] Unique account emails.
- [ ] Password length greater than eight, uppercase, lowercase, and special character.
- [ ] Password reset link delivered to registered email.
- [ ] Admin, limited staff, and customer access.
- [ ] Only admin can add staff.
- [ ] Customers can access only their own subscriptions and invoices.

## Catalog and plans — page 3

- [ ] Product name, type, sales price, cost price, notes.
- [ ] Product variants and price additions, including the example Odoo surcharge of 560.
- [ ] Plan price, daily/weekly/monthly/yearly cadence, minimum quantity, availability dates.
- [ ] Per-plan automatic closure, early closure, pause, and renewal policy.

## Sales and subscriptions — page 3

- [ ] Quotation templates with plan, product lines, and validity days.
- [ ] Unique subscription number, customer, plan, start, expiry, payment terms.
- [ ] Lines with product, quantity, unit price, taxes, and amount.
- [ ] Draft → Quotation → Confirmed → Active → Closed lifecycle and visible status.

## Invoices — page 3

- [ ] Automatically generate invoices for due subscriptions.
- [ ] Copy customer details, lines, taxes, and totals accurately.
- [ ] Apply administrator-defined tax rules.
- [ ] Confirm, cancel, send, and print invoices.
- [ ] Draft, Confirmed, and Paid behavior.
- [ ] Prevent duplicate and missed billing, including retries and concurrent execution.

## Discounts — page 4

- [ ] Only admin creates discount rules.
- [ ] Fixed and percentage discount types.
- [ ] Purchase/quantity thresholds, effective dates, usage limits.
- [ ] Product-level and whole-subscription applicability.
- [ ] Automatic next-invoice application and expiry/exhaustion enforcement.

## Payments and reporting — page 4

- [ ] Record method, amount, date, note, and associated invoice.
- [ ] Show paid and outstanding balances accurately.
- [ ] Identify overdue invoices.
- [ ] Filterable summary of active subscriptions, revenue, payments, and overdue invoices.
- [ ] Every page responds in under two seconds with thousands of subscriptions, measured under an agreed representative workload.

## Decisions not settled by the brief

Record agreed answers before implementing dependent behavior: currency and tax jurisdiction; plan-price/product-line interaction; advance versus arrears; billing anchor and month-end handling; proration; pause effective dates; renewal behavior; discount stacking and usage semantics; invoice correction rules; payment over-allocation; revenue definition; and customer self-service actions.

No proposed default may be treated as a source requirement. Acceptance must cover all of the above, plus backend authorization, transaction correctness, recovery, and frontend integration.
