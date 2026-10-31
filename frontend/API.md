# Brightloop API contract

Base URL: `http://localhost:4000/api`. JSON requests, cookie session (`credentials: 'include'`). Money is a JSON number in major currency units, rounded to two decimal places by the server. Dates are `YYYY-MM-DD`; timestamps are UTC ISO. Currency defaults to INR and is configurable with CURRENCY. IDs are UUID strings.

Lists return `{items: [], total, page, pageSize}` and accept `page`, `pageSize` (max 100), `q`, `status`, `customerId`, `from`, `to`. Detail/create/update return the object itself. Errors: `{error: 'Human readable message'}`. Resource mutation: `POST /resource`, `PATCH /resource/:id`. Archive catalog entries by patching `active:false`.

## Authentication

- POST `/auth/register` `{name,email,password}` → `{user:{id,name,email,role,customerId}}` and session cookie; role is always customer.
- POST `/auth/login` `{email,password}` → `{user}` and session cookie.
- GET `/auth/me` → `{user}`. POST `/auth/logout` → `{ok:true}`.
- POST `/auth/forgot-password` `{email}` → neutral `{message}`; email goes to configured SMTP or development outbox.
- POST `/auth/reset-password` `{token,password}` → `{message}`. UI reset route: `/reset-password?token=…`.
- Roles: `admin`, `staff`, `customer`. Only admin manages products/plans/taxes/discounts/templates/staff. Staff manage customers/subscriptions/invoices/payments. Customer reads only own data and uses enabled subscription actions.

## Catalog and customers

- `/customers`: `{id,name,email,phone,address,taxId,active}`. Staff/admin create/edit; customers read/update own profile (no email ownership changes).
- POST `/customers/:id/invite` (staff/admin): send a single-use 30-minute password setup link to the existing customer's billing email. Creates a linked customer login if absent and returns `{message}`. Reissuing invalidates the previous setup link. Public registration refuses existing billing profiles so an unverified registrant cannot claim existing subscriptions. Billing emails are unique; portal-linked billing emails cannot be changed through generic profile edits.
- `/products`: `{id,name,type,salesPrice,costPrice,notes,active,variants:[{id,name,priceAdjustment}]}`. Variant example `{name:'Odoo',priceAdjustment:560}`. Client may omit variant IDs on creation.
- `/plans`: `{id,name,price,interval,minimumQuantity,availableFrom,availableTo,autoClose,allowClose,allowPause,allowRenew,active}`. interval: `daily|weekly|monthly|yearly`. Plan price is an explicit base fee in addition to product lines (use zero when line pricing contains the entire charge).
- `/taxes`: `{id,name,rate,productIds:[],startDate,endDate,active}`. Empty productIds = all products. Taxes are exclusive percentages after discounts.
- `/discounts`: `{id,name,type,value,minAmount,minQuantity,startDate,endDate,usageLimit,usageCount,scope,productIds:[],subscriptionIds:[],active}`. type `fixed|percentage`; scope `product|subscription`; usageLimit null = unlimited. One eligible rule per invoice (first created), per confirmed invoice global redemption. Empty subscriptionIds = all subscriptions.
- `/templates`: `{id,name,planId,validityDays,paymentTerms,notes,lines:[{productId,variantId,quantity,unitPrice,taxIds:[]}]}`. unitPrice optional on input; absent price uses catalog plus variant. paymentTerms = due days (integer).
- `/staff`: `{id,name,email,role:'staff',active}`; POST adds password; PATCH changes name/active only. Admin-only.

## Subscriptions

`/subscriptions`: `{id,number,customerId,customerName,planId,planName,status,startDate,expiryDate,paymentTerms,quotationValidUntil,nextBillingDate,notes,lines,currency,createdAt}`. POST body `{customerId,planId,startDate,expiryDate,paymentTerms,templateId?,notes,lines}`; templateId copies default lines/plan/payment terms if omitted. Lines `{productId,variantId?,quantity,unitPrice?,taxIds?:[]}`. `unitPrice` excludes variant surcharge on input; the stored line contains final unitPrice, variantAdjustment and productName. PATCH is allowed only in Draft and accepts draft commercial fields.

POST `/subscriptions/:id/quote`, `/confirm`, `/activate`, `/pause`, `/resume`, `/close`, `/renew`. Body `{}` except renewal `{expiryDate}` (new future expiry). States `Draft|Quotation|Confirmed|Active|Paused|Closed`. Activation requires startDate reached. Renewal extends term and preserves historical invoices. Pause suppresses billing from the next unbilled period; resume preserves the original calendar anchor and skips elapsed paused periods, with billing restarting at the next boundary on or after today. No mid-period proration applies. Customer may pause/resume/close/renew only its own subscriptions when the plan permits. Staff may run all valid transitions.

## Invoices, billing, payments

- GET `/invoices`, GET `/invoices/:id`. `{id,number,subscriptionId,subscriptionNumber,customerId,customerName,status,paymentStatus,issueDate,dueDate,periodStart,periodEnd,subtotal,discountTotal,taxTotal,total,paidAmount,balance,currency,lines,customer,discounts}`. status `Draft|Confirmed|Paid|Cancelled`; paymentStatus `Unpaid|Partially Paid|Paid`. Lines show `description,quantity,unitPrice,subtotal,discount,tax,total,taxes`.
- POST `/invoices/:id/confirm`, `/cancel`, `/send`. Sending queues real SMTP mail or development outbox. Confirmed unpaid invoices may be cancelled; paid allocations must be reversed first. Cancelled invoices never automatically regenerate.
- GET `/invoices/:id/print` returns printable HTML protected by session cookie; open in a new tab.
- POST `/billing/run` (admin/staff) `{asOf?: 'YYYY-MM-DD'}` → `{created,closed,activated,errors:[]}`. Non-production only supports date override. Scheduler runs every minute. All eligible missed periods catch up; invoice generation and next-date advancement are atomic. Generated invoices start Draft and reserve discount usage; confirm consumes it, cancel releases it.
- `/payments`: GET list and POST `{invoiceId,amount,method,date,note,reference}`; method is free text, date YYYY-MM-DD. Invoice must be Confirmed or partially paid; reject overpayment. Returns payment `{id,invoiceId,invoiceNumber,customerId,amount,method,date,note,reference,status}`. POST `/payments/:id/reverse` reverses allocation and restores invoice balance. Customer reads own only.

## Reporting and operations

- GET `/reports/summary` with `from,to,customerId,planId,status` → `{activeSubscriptions,totalSubscriptions,invoicedRevenue,paymentsReceived,outstanding,overdueAmount,overdueCount,mrr,currency,monthlyRevenue:[{month,invoiced,payments}],subscriptionBreakdown:[{status,count}],recentInvoices:[],overdueInvoices:[]}`. Tax is excluded from invoicedRevenue; cash receipts and invoice revenue are separate. Invoice date filters apply to invoiced metrics; payment date filters to cash metrics. Customer reports are own-only.
- GET `/outbox` admin development-only → list of `{id,to,subject,html,status,createdAt,error}`. Useful for local password-reset/invoice email inspection. Production requires SMTP and never exposes reset links via API.
- GET `/audit` admin-only paginated events.
- GET `/health` → `{status:'ok'}`.

## Configuration and policy

Local frontend origin http://localhost:5173; backend :4000. Cookies are HttpOnly, SameSite=Lax, Secure in production. State mutations enforce configured Origin. Production use HTTPS/reverse proxy, FRONTEND_URL, SMTP settings and an admin bootstrap password. No production demo seed. Billing uses UTC date boundaries, advance billing, anchored calendar months/years, no mid-period proration, partial final periods charged full only when explicitly configured (default validates aligned expiry). Automated taxes and discounts are snapshots; catalog changes do not rewrite issued invoices.
