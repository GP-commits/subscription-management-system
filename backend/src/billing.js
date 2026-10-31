import Decimal from 'decimal.js';
import { id, record, transaction, nextNumber, audit } from './db.js';
import {
  assert,
  cents,
  money,
  round,
  addDays,
  nextPeriod,
  dateOnly,
  escapeHtml as e,
} from './domain.js';

export function subscriptionObject(db, row) {
  if (!row) return null;
  const data = JSON.parse(row.data);
  return {
    ...data,
    id: row.id,
    customerId: row.customer_id,
    planId: row.plan_id,
    status: row.status,
    nextBillingDate: row.next_billing_date,
    customerName: record(db, 'customers', row.customer_id)?.name ?? '',
    planName: record(db, 'plans', row.plan_id)?.name ?? '',
  };
}
export function invoiceObject(row) {
  if (!row) return null;
  return {
    ...JSON.parse(row.data),
    id: row.id,
    subscriptionId: row.subscription_id,
    customerId: row.customer_id,
    status: row.status,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    total: money(row.total_cents),
    paidAmount: money(row.paid_cents),
    balance: money(row.total_cents - row.paid_cents),
    paymentStatus:
      row.total_cents === row.paid_cents && row.status !== 'Cancelled'
        ? 'Paid'
        : row.paid_cents > 0
          ? 'Partially Paid'
          : 'Unpaid',
  };
}
export function paymentObject(row) {
  return row
    ? {
        ...JSON.parse(row.data),
        id: row.id,
        invoiceId: row.invoice_id,
        customerId: row.customer_id,
        amount: money(row.amount_cents),
        date: row.date,
        status: row.status,
      }
    : null;
}
export function saveSubscription(db, sub) {
  const {
    id: subId,
    customerId,
    planId,
    status,
    nextBillingDate,
    customerName,
    planName,
    ...data
  } = sub;
  db.prepare(
    'UPDATE subscriptions SET customer_id=?,plan_id=?,status=?,next_billing_date=?,data=? WHERE id=?',
  ).run(customerId, planId, status, nextBillingDate, JSON.stringify(data), subId);
}
function inDates(rule, asOf) {
  return (!rule.startDate || rule.startDate <= asOf) && (!rule.endDate || rule.endDate >= asOf);
}
export function calculateInvoice(db, sub, asOf) {
  const plan = sub.planSnapshot || record(db, 'plans', sub.planId);
  const lines = sub.lines.map((l) => ({
    ...l,
    description: `${l.productName}${l.variantName ? ` / ${l.variantName}` : ''}`,
    subtotalCents: cents(new Decimal(l.unitPrice).mul(l.quantity)),
  }));
  if (plan.price > 0)
    lines.unshift({
      productId: null,
      productName: plan.name,
      description: `${plan.name} — plan fee`,
      quantity: 1,
      unitPrice: plan.price,
      taxIds: [],
      subtotalCents: cents(plan.price),
    });
  const subtotal = lines.reduce((sum, line) => sum + line.subtotalCents, 0);
  const quantity = sub.lines.reduce((sum, line) => sum + line.quantity, 0);
  let chosen = null;
  let eligible = [];
  for (const row of db.prepare('SELECT * FROM discounts ORDER BY rowid').all()) {
    const rule = JSON.parse(row.data);
    if (
      !rule.active ||
      !inDates(rule, asOf) ||
      (rule.subscriptionIds.length && !rule.subscriptionIds.includes(sub.id))
    )
      continue;
    if (rule.usageLimit !== null && row.usage_count + row.reserved_count >= rule.usageLimit)
      continue;
    const indexes = lines
      .map((l, index) => ({ l, index }))
      .filter(
        ({ l }) =>
          rule.scope === 'subscription' ||
          (l.productId && (!rule.productIds.length || rule.productIds.includes(l.productId))),
      )
      .map(({ index }) => index);
    const eligibleTotal = indexes.reduce((sum, index) => sum + lines[index].subtotalCents, 0);
    const eligibleQuantity =
      rule.scope === 'subscription'
        ? quantity
        : indexes.reduce((sum, index) => sum + lines[index].quantity, 0);
    if (
      !indexes.length ||
      eligibleTotal < cents(rule.minAmount) ||
      eligibleQuantity < rule.minQuantity ||
      eligibleTotal === 0
    )
      continue;
    chosen = { ...rule, id: row.id };
    eligible = indexes;
    break;
  }
  const eligibleTotal = eligible.reduce((sum, index) => sum + lines[index].subtotalCents, 0);
  const discountCents = chosen
    ? Math.min(
        eligibleTotal,
        chosen.type === 'fixed'
          ? cents(chosen.value)
          : new Decimal(eligibleTotal)
              .mul(chosen.value)
              .div(100)
              .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
              .toNumber(),
      )
    : 0;
  let allocated = 0,
    remainingSubtotal = eligibleTotal;
  for (let n = 0; n < eligible.length; n++) {
    const index = eligible[n];
    const allocation =
      n === eligible.length - 1
        ? discountCents - allocated
        : new Decimal(discountCents - allocated)
            .mul(lines[index].subtotalCents)
            .div(remainingSubtotal)
            .floor()
            .toNumber();
    lines[index].discountCents = allocation;
    allocated += allocation;
    remainingSubtotal -= lines[index].subtotalCents;
  }
  const taxRules = db
    .prepare('SELECT * FROM taxes')
    .all()
    .map((r) => ({ ...JSON.parse(r.data), id: r.id }))
    .filter((r) => r.active && inDates(r, asOf));
  let taxTotal = 0;
  const resultLines = lines.map((line) => {
    const discount = line.discountCents || 0,
      net = line.subtotalCents - discount;
    const applicable = taxRules.filter(
      (t) =>
        (!line.taxIds.length || line.taxIds.includes(t.id)) &&
        (!t.productIds.length || t.productIds.includes(line.productId)),
    );
    const taxes = applicable.map((t) => ({
      id: t.id,
      name: t.name,
      rate: t.rate,
      amount: money(
        new Decimal(net).mul(t.rate).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(),
      ),
    }));
    const tax = taxes.reduce((sum, t) => sum + cents(t.amount), 0);
    taxTotal += tax;
    const { subtotalCents, discountCents: ignored, ...rest } = line;
    return {
      ...rest,
      subtotal: money(subtotalCents),
      discount: money(discount),
      tax: money(tax),
      total: money(net + tax),
      taxes,
    };
  });
  return {
    lines: resultLines,
    subtotal: money(subtotal),
    discountTotal: money(discountCents),
    taxTotal: money(taxTotal),
    total: money(subtotal - discountCents + taxTotal),
    discounts: chosen ? [{ id: chosen.id, name: chosen.name, amount: money(discountCents) }] : [],
    discountId: chosen?.id ?? null,
  };
}
export function runBilling(db, asOf, now = new Date(), subscriptionId = null) {
  const result = { created: 0, activated: 0, closed: 0, errors: [] };
  const rows = db
    .prepare(
      `SELECT id FROM subscriptions WHERE status IN ('Confirmed','Active','Paused')${subscriptionId ? ' AND id=?' : ''} ORDER BY next_billing_date`,
    )
    .all(...(subscriptionId ? [subscriptionId] : []));
  for (const { id: subId } of rows) {
    try {
      const counts = transaction(db, () => {
        const sub = subscriptionObject(
          db,
          db.prepare('SELECT * FROM subscriptions WHERE id=?').get(subId),
        );
        const plan = sub.planSnapshot || record(db, 'plans', sub.planId);
        const count = { created: 0, activated: 0, closed: 0 };
        if (sub.status === 'Confirmed' && sub.startDate <= asOf && sub.startDate < sub.expiryDate) {
          sub.status = 'Active';
          count.activated++;
        }
        let processed = 0;
        if (sub.status === 'Active') {
          while (
            sub.nextBillingDate &&
            sub.nextBillingDate <= asOf &&
            sub.nextBillingDate < sub.expiryDate &&
            processed < 1000
          ) {
            const periodStart = sub.nextBillingDate;
            const next = nextPeriod(periodStart, plan.interval, sub.billingAnchor || sub.startDate);
            const periodEnd = next > sub.expiryDate ? sub.expiryDate : next;
            const existing = db
              .prepare(
                'SELECT id FROM invoices WHERE subscription_id=? AND period_start=? AND period_end=?',
              )
              .get(sub.id, periodStart, periodEnd);
            if (!existing) {
              const totals = calculateInvoice(db, sub, periodStart);
              const invoiceId = id(),
                customer = record(db, 'customers', sub.customerId);
              const { discountId, ...amounts } = totals;
              const data = {
                number: nextNumber(db, 'invoice', 'INV'),
                subscriptionNumber: sub.number,
                customerName: customer.name,
                customer: { ...customer },
                currency: sub.currency,
                paymentTerms: sub.paymentTerms,
                ...amounts,
                createdAt: now.toISOString(),
              };
              db.prepare(
                'INSERT INTO invoices(id,subscription_id,customer_id,status,period_start,period_end,issue_date,due_date,total_cents,discount_id,discount_state,data) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
              ).run(
                invoiceId,
                sub.id,
                sub.customerId,
                'Draft',
                periodStart,
                periodEnd,
                periodStart,
                addDays(periodStart, sub.paymentTerms),
                cents(totals.total),
                discountId,
                discountId ? 'Reserved' : null,
                JSON.stringify(data),
              );
              if (discountId)
                db.prepare('UPDATE discounts SET reserved_count=reserved_count+1 WHERE id=?').run(
                  discountId,
                );
              audit(
                db,
                null,
                'invoice.generated',
                invoiceId,
                { subscriptionId: sub.id, periodStart, periodEnd },
                now,
              );
              count.created++;
            }
            sub.nextBillingDate = periodEnd;
            processed++;
          }
        }
        // Close only once every billable period has been recorded, including catch-up after downtime.
        if (
          plan.autoClose &&
          sub.expiryDate <= asOf &&
          (sub.status === 'Paused' ||
            (sub.status === 'Active' && sub.nextBillingDate >= sub.expiryDate))
        ) {
          sub.status = 'Closed';
          count.closed++;
        }
        saveSubscription(db, sub);
        return count;
      });
      result.created += counts.created;
      result.activated += counts.activated;
      result.closed += counts.closed;
    } catch (err) {
      result.errors.push({ subscriptionId: subId, error: err.message });
    }
  }
  return result;
}
export function confirmInvoice(db, invoiceId, actor, now) {
  const row = db.prepare('SELECT * FROM invoices WHERE id=?').get(invoiceId);
  assert(row, 'Invoice not found.', 404);
  assert(row.status === 'Draft', 'Only draft invoices can be confirmed.');
  db.prepare('UPDATE invoices SET status=? WHERE id=?').run(
    row.total_cents === 0 ? 'Paid' : 'Confirmed',
    invoiceId,
  );
  if (row.discount_id && row.discount_state === 'Reserved') {
    db.prepare(
      'UPDATE discounts SET reserved_count=reserved_count-1,usage_count=usage_count+1 WHERE id=?',
    ).run(row.discount_id);
    db.prepare("UPDATE invoices SET discount_state='Used' WHERE id=?").run(invoiceId);
  }
  audit(db, actor, 'invoice.confirmed', invoiceId, {}, now);
  return invoiceObject(db.prepare('SELECT * FROM invoices WHERE id=?').get(invoiceId));
}
export function cancelInvoice(db, invoiceId, actor, now) {
  const row = db.prepare('SELECT * FROM invoices WHERE id=?').get(invoiceId);
  assert(row, 'Invoice not found.', 404);
  assert(row.status !== 'Cancelled', 'Invoice is already cancelled.');
  assert(row.paid_cents === 0, 'Reverse allocated payments before cancelling this invoice.');
  if (row.discount_id && row.discount_state === 'Reserved')
    db.prepare('UPDATE discounts SET reserved_count=reserved_count-1 WHERE id=?').run(
      row.discount_id,
    );
  db.prepare(
    "UPDATE invoices SET status='Cancelled',discount_state=CASE WHEN discount_state='Reserved' THEN 'Released' ELSE discount_state END WHERE id=?",
  ).run(invoiceId);
  audit(db, actor, 'invoice.cancelled', invoiceId, {}, now);
  return invoiceObject(db.prepare('SELECT * FROM invoices WHERE id=?').get(invoiceId));
}
export function invoiceHtml(invoice) {
  const fmt = (value) => `${e(invoice.currency)} ${Number(value).toFixed(2)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${e(invoice.number)}</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#142e32;max-width:900px;margin:48px auto;padding:20px}h1{font-size:36px;margin:0}header{display:flex;justify-content:space-between;border-bottom:3px solid #714B67;padding-bottom:24px}table{border-collapse:collapse;width:100%;margin:32px 0}td,th{padding:12px 6px;border-bottom:1px solid #ddd;text-align:right}td:first-child,th:first-child{text-align:left}.totals{margin-left:auto;max-width:340px}.totals p{display:flex;justify-content:space-between}.muted{color:#54696c}@media print{body{margin:0;font-size:12px}button{display:none}}</style></head><body><header><div><h1>Brightloop</h1><p>Subscription services</p></div><div><h2>${e(invoice.number)}</h2><p>${e(invoice.status)}</p></div></header><section><h3>Bill to ${e(invoice.customer.name)}</h3><p>${e(invoice.customer.email)}<br>${e(invoice.customer.address || '')}<br>${e(invoice.customer.taxId || '')}</p><p>Issued ${e(invoice.issueDate)} · Due ${e(invoice.dueDate)}<br>Service ${e(invoice.periodStart)} to ${e(invoice.periodEnd)} (end exclusive)<br>Subscription ${e(invoice.subscriptionNumber)}</p></section><table><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Discount</th><th>Tax</th><th>Total</th></tr></thead><tbody>${invoice.lines.map((l) => `<tr><td>${e(l.description)}${l.taxes.length ? `<br><small>${l.taxes.map((t) => `${e(t.name)} ${e(t.rate)}%`).join(', ')}</small>` : ''}</td><td>${e(l.quantity)}</td><td>${fmt(l.unitPrice)}</td><td>${fmt(l.discount)}</td><td>${fmt(l.tax)}</td><td>${fmt(l.total)}</td></tr>`).join('')}</tbody></table><div class="totals"><p><span>Subtotal</span><span>${fmt(invoice.subtotal)}</span></p><p><span>Discount</span><span>−${fmt(invoice.discountTotal)}</span></p><p><span>Tax</span><span>${fmt(invoice.taxTotal)}</span></p><p><strong>Total</strong><strong>${fmt(invoice.total)}</strong></p><p><span>Paid</span><span>${fmt(invoice.paidAmount)}</span></p><p><strong>Balance due</strong><strong>${fmt(invoice.balance)}</strong></p></div><p class="muted">Thank you for choosing Brightloop. Please quote your invoice number with payment.</p><button onclick="window.print()">Print invoice</button></body></html>`;
}
