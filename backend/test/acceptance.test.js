import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/app.js';

const ADMIN = {
  name: 'Acceptance Admin',
  email: 'admin@acceptance.test',
  password: 'AdminPass!123',
};
const PASSWORD = 'CustomerPass!123';

async function environment(t, options = {}) {
  let currentTime = '2026-10-31T12:00:00Z';
  const app = await createApp({
    dbPath: ':memory:',
    now: () => new Date(currentTime),
    bootstrapAdmin: ADMIN,
    disableRateLimit: true,
    frontendUrl: 'http://localhost:5173',
    ...options,
  });
  const server = await new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let closed = false;
  const shutdown = async () => {
    if (!closed) {
      closed = true;
      await new Promise((resolve) => server.close(resolve));
      await app.locals.close?.();
    }
  };
  t.after(shutdown);
  function client() {
    let cookie = '';
    return async (method, path, body, expected = 200) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:5173',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.headers.get('set-cookie'))
        cookie = response.headers.get('set-cookie').split(';')[0];
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      if (expected !== null)
        assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
      return { status: response.status, data, headers: response.headers };
    };
  }
  const admin = client();
  await admin('POST', '/auth/login', ADMIN);
  return {
    app,
    client,
    admin,
    base,
    shutdown,
    setNow: (value) => {
      currentTime = value;
    },
  };
}

async function commercialFixture(env, suffix = '') {
  const customerClient = env.client();
  const registration = await customerClient(
    'POST',
    '/auth/register',
    { name: `Customer ${suffix}`, email: `customer${suffix}@acceptance.test`, password: PASSWORD },
    null,
  );
  assert.ok([200, 201].includes(registration.status));
  const customerId = registration.data.user.customerId;
  const product = (
    await env.admin(
      'POST',
      '/products',
      {
        name: `Business software ${suffix}`,
        type: 'service',
        salesPrice: 100,
        costPrice: 30,
        notes: 'Internal catalog note',
        variants: [{ name: 'Odoo', priceAdjustment: 560 }],
      },
      201,
    )
  ).data;
  const plan = (
    await env.admin(
      'POST',
      '/plans',
      {
        name: `Monthly ${suffix}`,
        price: 0,
        interval: 'monthly',
        minimumQuantity: 1,
        availableFrom: '2026-01-01',
        availableTo: '2028-01-01',
        autoClose: true,
        allowClose: true,
        allowPause: true,
        allowRenew: true,
      },
      201,
    )
  ).data;
  return { customerClient, customerId, product, plan };
}

async function activate(env, fixture, changes = {}) {
  const subscription = (
    await env.admin(
      'POST',
      '/subscriptions',
      {
        customerId: fixture.customerId,
        planId: fixture.plan.id,
        startDate: '2026-10-01',
        expiryDate: '2027-10-01',
        paymentTerms: 7,
        lines: [
          { productId: fixture.product.id, variantId: fixture.product.variants[0].id, quantity: 2 },
        ],
        ...changes,
      },
      201,
    )
  ).data;
  assert.equal(subscription.status, 'Draft');
  for (const [action, status] of [
    ['quote', 'Quotation'],
    ['confirm', 'Confirmed'],
    ['activate', 'Active'],
  ]) {
    const result = (await env.admin('POST', `/subscriptions/${subscription.id}/${action}`, {}))
      .data;
    assert.equal(result.status, status);
  }
  return (await env.admin('GET', `/subscriptions/${subscription.id}`)).data;
}

test('identity: password policy, duplicate email, staff authority, reset and session revocation', async (t) => {
  const env = await environment(t);
  const unauthenticated = env.client();
  await unauthenticated('GET', '/subscriptions', undefined, 401);
  for (const password of ['Abcdef!1', 'abcdefgh!12', 'ABCDEFGH!12', 'Abcdefgh123']) {
    const result = await env.client()(
      'POST',
      '/auth/register',
      { name: 'Invalid', email: 'invalid@acceptance.test', password },
      null,
    );
    assert.ok([400, 422].includes(result.status), `Invalid password accepted: ${password}`);
  }
  const customer = env.client();
  const registered = await customer(
    'POST',
    '/auth/register',
    { name: 'Account', email: 'one@acceptance.test', password: PASSWORD, role: 'admin' },
    null,
  );
  assert.ok([200, 201].includes(registered.status));
  assert.equal(registered.data.user.role, 'customer');
  const duplicate = await env.client()(
    'POST',
    '/auth/register',
    { name: 'Duplicate', email: ' ONE@acceptance.test ', password: PASSWORD },
    null,
  );
  assert.ok([400, 409, 422].includes(duplicate.status));
  await customer(
    'POST',
    '/staff',
    { name: 'Escalation', email: 'bad@acceptance.test', password: PASSWORD },
    403,
  );
  const staff = (
    await env.admin(
      'POST',
      '/staff',
      { name: 'Sales', email: 'staff@acceptance.test', password: PASSWORD },
      201,
    )
  ).data;
  assert.equal(staff.role, 'staff');
  const sales = env.client();
  await sales('POST', '/auth/login', { email: staff.email, password: PASSWORD });
  for (const resource of ['staff', 'taxes', 'discounts', 'plans', 'products'])
    await sales('POST', `/${resource}`, {}, 403);
  const forgot = await unauthenticated('POST', '/auth/forgot-password', {
    email: 'one@acceptance.test',
  });
  const unknown = await unauthenticated('POST', '/auth/forgot-password', {
    email: 'unknown@acceptance.test',
  });
  assert.deepEqual(unknown.data, forgot.data);
  const messages = (await env.admin('GET', '/outbox')).data.items;
  const reset = messages.find((message) => message.to === 'one@acceptance.test');
  assert.ok(reset?.html, 'Password reset email must be queued to registered email');
  const token = /[?&]token=([^"'\s<>&]+)/.exec(reset.html)?.[1];
  assert.ok(token, 'Reset link must contain a token');
  await unauthenticated('POST', '/auth/reset-password', {
    token: decodeURIComponent(token),
    password: 'ChangedPass!123',
  });
  await customer('GET', '/auth/me', undefined, 401);
  const reused = await unauthenticated(
    'POST',
    '/auth/reset-password',
    { token: decodeURIComponent(token), password: PASSWORD },
    null,
  );
  assert.ok([400, 401, 410].includes(reused.status));
  await unauthenticated(
    'POST',
    '/auth/login',
    { email: 'one@acceptance.test', password: PASSWORD },
    401,
  );
  await unauthenticated('POST', '/auth/login', {
    email: 'one@acceptance.test',
    password: 'ChangedPass!123',
  });
});

test('full billing journey: variant price, tax, idempotency, immutable invoice, partial payment and reporting', async (t) => {
  const env = await environment(t);
  const f = await commercialFixture(env);
  const tax = (
    await env.admin(
      'POST',
      '/taxes',
      {
        name: 'Sales tax',
        rate: 10,
        productIds: [f.product.id],
        startDate: '2026-01-01',
        endDate: '2028-01-01',
      },
      201,
    )
  ).data;
  const subscription = await activate(env, f, {
    lines: [
      {
        productId: f.product.id,
        variantId: f.product.variants[0].id,
        quantity: 2,
        taxIds: [tax.id],
      },
    ],
  });
  assert.equal(subscription.lines[0].unitPrice, 660);
  const firstRun = (await env.admin('POST', '/billing/run', { asOf: '2026-10-01' })).data;
  assert.equal(firstRun.errors.length, 0);
  assert.equal(firstRun.created, 1);
  await Promise.all([
    env.admin('POST', '/billing/run', { asOf: '2026-10-01' }),
    env.admin('POST', '/billing/run', { asOf: '2026-10-01' }),
  ]);
  const invoices = (await env.admin('GET', `/invoices?customerId=${f.customerId}`)).data;
  assert.equal(invoices.total, 1);
  const invoice = invoices.items[0];
  assert.equal(invoice.status, 'Draft');
  assert.equal(invoice.subtotal, 1320);
  assert.equal(invoice.taxTotal, 132);
  assert.equal(invoice.total, 1452);
  assert.equal(invoice.periodStart, '2026-10-01');
  assert.equal(invoice.periodEnd, '2026-11-01');
  assert.equal(invoice.dueDate, '2026-10-08');
  await env.admin('PATCH', `/products/${f.product.id}`, {
    salesPrice: 500,
    name: 'Renamed catalog product',
  });
  await env.admin('PATCH', `/taxes/${tax.id}`, { rate: 25 });
  const unchanged = (await env.admin('GET', `/invoices/${invoice.id}`)).data;
  assert.equal(unchanged.total, 1452);
  assert.equal(unchanged.lines[0].unitPrice, 660);
  await env.admin('POST', `/invoices/${invoice.id}/confirm`, {});
  const overdue = (await env.admin('GET', '/reports/summary')).data;
  assert.equal(overdue.overdueCount, 1);
  assert.equal(overdue.overdueAmount, 1452);
  const partial = (
    await env.admin(
      'POST',
      '/payments',
      {
        invoiceId: invoice.id,
        amount: 452,
        method: 'Bank transfer',
        date: '2026-10-10',
        note: 'First installment',
        reference: 'TX-001',
      },
      201,
    )
  ).data;
  assert.equal(partial.amount, 452);
  assert.equal(partial.note, 'First installment');
  let current = (await env.admin('GET', `/invoices/${invoice.id}`)).data;
  assert.equal(current.balance, 1000);
  assert.equal(current.paymentStatus, 'Partially Paid');
  const overpay = await env.admin(
    'POST',
    '/payments',
    { invoiceId: invoice.id, amount: 1001, method: 'Cash', date: '2026-10-11' },
    null,
  );
  assert.ok([400, 409, 422].includes(overpay.status));
  await env.admin(
    'POST',
    '/payments',
    {
      invoiceId: invoice.id,
      amount: 1000,
      method: 'Bank transfer',
      date: '2026-10-11',
      note: 'Final installment',
    },
    201,
  );
  current = (await env.admin('GET', `/invoices/${invoice.id}`)).data;
  assert.equal(current.status, 'Paid');
  assert.equal(current.balance, 0);
  const cancelPaid = await env.admin('POST', `/invoices/${invoice.id}/cancel`, {}, null);
  assert.ok([400, 409, 422].includes(cancelPaid.status));
  const print = await f.customerClient('GET', `/invoices/${invoice.id}/print`);
  assert.match(print.headers.get('content-type'), /text\/html/);
  assert.match(print.data, new RegExp(invoice.number));
  assert.match(print.data, /1[,]?452/);
  await env.admin('POST', `/invoices/${invoice.id}/send`, {});
  const outbox = (await env.admin('GET', '/outbox')).data.items;
  assert.ok(
    outbox.some(
      (message) =>
        message.to === 'customer@acceptance.test' && message.html.includes(invoice.number),
    ),
  );
  const report = (await env.admin('GET', `/reports/summary?customerId=${f.customerId}`)).data;
  assert.equal(report.activeSubscriptions, 1);
  assert.equal(report.invoicedRevenue, 1320);
  assert.equal(report.paymentsReceived, 1452);
  assert.equal(report.outstanding, 0);
  assert.equal(report.overdueCount, 0);
  const payments = (await f.customerClient('GET', '/payments')).data;
  assert.equal(payments.total, 2);
  await env.admin('POST', `/payments/${partial.id}/reverse`, {});
  assert.equal((await env.admin('GET', `/invoices/${invoice.id}`)).data.balance, 452);
});

test('customer isolation applies to lists, detail, print, writes and reporting', async (t) => {
  const env = await environment(t);
  const a = await commercialFixture(env, 'a');
  const b = await commercialFixture(env, 'b');
  const subA = await activate(env, a);
  const subB = await activate(env, b);
  await env.admin('POST', '/billing/run', { asOf: '2026-10-01' });
  const invoiceB = (await env.admin('GET', `/invoices?customerId=${b.customerId}`)).data.items[0];
  const own = (await a.customerClient('GET', '/subscriptions')).data;
  assert.equal(own.total, 1);
  assert.equal(own.items[0].id, subA.id);
  for (const [method, path, body] of [
    ['GET', `/subscriptions/${subB.id}`],
    ['GET', `/invoices/${invoiceB.id}`],
    ['GET', `/invoices/${invoiceB.id}/print`],
    ['POST', `/subscriptions/${subB.id}/close`, {}],
    ['POST', `/invoices/${invoiceB.id}/send`, {}],
    ['PATCH', `/customers/${b.customerId}`, { name: 'Hacked' }],
  ]) {
    const result = await a.customerClient(method, path, body, null);
    assert.ok([403, 404].includes(result.status), `${method} ${path} exposed another customer`);
  }
  const filtered = await a.customerClient(
    'GET',
    `/invoices?customerId=${b.customerId}`,
    undefined,
    null,
  );
  assert.ok([200, 403].includes(filtered.status));
  if (filtered.status === 200)
    assert.ok(filtered.data.items.every((item) => item.customerId === a.customerId));
  const summary = await a.customerClient(
    'GET',
    `/reports/summary?customerId=${b.customerId}`,
    undefined,
    null,
  );
  assert.ok([200, 403].includes(summary.status));
  if (summary.status === 200) assert.equal(summary.data.totalSubscriptions, 1);
  await a.customerClient(
    'POST',
    '/payments',
    { invoiceId: invoiceB.id, amount: 1, method: 'Cash', date: '2026-10-01' },
    403,
  );
  await a.customerClient('GET', '/outbox', undefined, 403);
});

test('discount eligibility, scopes, expiry, usage reservations and cancellation', async (t) => {
  const env = await environment(t);
  const f = await commercialFixture(env);
  const expired = (
    await env.admin(
      'POST',
      '/discounts',
      {
        name: 'Expired',
        type: 'percentage',
        value: 90,
        minAmount: 0,
        minQuantity: 0,
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        scope: 'subscription',
        usageLimit: 1,
      },
      201,
    )
  ).data;
  const discount = (
    await env.admin(
      'POST',
      '/discounts',
      {
        name: 'Seat offer',
        type: 'percentage',
        value: 10,
        minAmount: 1000,
        minQuantity: 2,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        scope: 'product',
        productIds: [f.product.id],
        usageLimit: 1,
      },
      201,
    )
  ).data;
  await activate(env, f);
  await env.admin('POST', '/billing/run', { asOf: '2026-11-01' });
  const invoices = (await env.admin('GET', '/invoices?pageSize=100')).data.items.sort((a, b) =>
    a.periodStart.localeCompare(b.periodStart),
  );
  assert.equal(invoices.length, 2);
  assert.equal(invoices[0].discountTotal, 132);
  assert.equal(invoices[0].total, 1188);
  assert.equal(invoices[1].discountTotal, 0);
  await env.admin('POST', `/invoices/${invoices[0].id}/confirm`, {});
  assert.equal((await env.admin('GET', `/discounts/${discount.id}`)).data.usageCount, 1);
  assert.equal((await env.admin('GET', `/discounts/${expired.id}`)).data.usageCount, 0);
  await env.admin('POST', `/invoices/${invoices[1].id}/cancel`, {});
  await env.admin('POST', '/billing/run', { asOf: '2026-11-01' });
  assert.equal(
    (await env.admin('GET', '/invoices')).data.total,
    2,
    'Cancelled period must not rebill',
  );
});

test('fixed subscription discount, thresholds and taxes use discounted amounts', async (t) => {
  const env = await environment(t);
  const f = await commercialFixture(env);
  const tax = (
    await env.admin('POST', '/taxes', { name: '10 percent', rate: 10, productIds: [] }, 201)
  ).data;
  await env.admin(
    'POST',
    '/discounts',
    {
      name: 'Minimum not reached',
      type: 'percentage',
      value: 90,
      minAmount: 2000,
      minQuantity: 1,
      scope: 'subscription',
    },
    201,
  );
  await env.admin(
    'POST',
    '/discounts',
    {
      name: 'Fixed credit',
      type: 'fixed',
      value: 120,
      minAmount: 1000,
      minQuantity: 2,
      scope: 'subscription',
    },
    201,
  );
  await activate(env, f, {
    lines: [
      {
        productId: f.product.id,
        variantId: f.product.variants[0].id,
        quantity: 2,
        taxIds: [tax.id],
      },
    ],
  });
  await env.admin('POST', '/billing/run', { asOf: '2026-10-01' });
  const invoice = (await env.admin('GET', '/invoices')).data.items[0];
  assert.equal(invoice.discountTotal, 120);
  assert.equal(invoice.taxTotal, 120);
  assert.equal(invoice.total, 1320);
});

test('templates, minimum quantities, lifecycle policy, renewal and missed-period recovery', async (t) => {
  const env = await environment(t);
  const f = await commercialFixture(env);
  await env.admin('PATCH', `/plans/${f.plan.id}`, { minimumQuantity: 2 });
  const tooSmall = await env.admin(
    'POST',
    '/subscriptions',
    {
      customerId: f.customerId,
      planId: f.plan.id,
      startDate: '2026-10-01',
      expiryDate: '2027-10-01',
      paymentTerms: 7,
      lines: [{ productId: f.product.id, quantity: 1 }],
    },
    null,
  );
  assert.ok([400, 422].includes(tooSmall.status));
  const template = (
    await env.admin(
      'POST',
      '/templates',
      {
        name: 'Enterprise offer',
        planId: f.plan.id,
        validityDays: 15,
        paymentTerms: 30,
        notes: 'Template notes',
        lines: [{ productId: f.product.id, variantId: f.product.variants[0].id, quantity: 2 }],
      },
      201,
    )
  ).data;
  const draft = (
    await env.admin(
      'POST',
      '/subscriptions',
      {
        customerId: f.customerId,
        templateId: template.id,
        startDate: '2026-10-01',
        expiryDate: '2027-10-01',
      },
      201,
    )
  ).data;
  assert.equal(draft.planId, f.plan.id);
  assert.equal(draft.paymentTerms, 30);
  assert.equal(draft.lines[0].unitPrice, 660);
  const skip = await env.admin('POST', `/subscriptions/${draft.id}/activate`, {}, null);
  assert.ok([400, 409].includes(skip.status));
  for (const action of ['quote', 'confirm', 'activate'])
    await env.admin('POST', `/subscriptions/${draft.id}/${action}`, {});
  await env.admin('POST', '/billing/run', { asOf: '2026-12-01' });
  assert.equal((await env.admin('GET', '/invoices')).data.total, 3);
  await env.admin('POST', '/billing/run', { asOf: '2026-12-01' });
  assert.equal((await env.admin('GET', '/invoices')).data.total, 3);
  const restrictedPlan = (
    await env.admin(
      'POST',
      '/plans',
      {
        name: 'Restricted contract',
        price: 0,
        interval: 'monthly',
        minimumQuantity: 1,
        autoClose: true,
        allowPause: false,
        allowClose: false,
        allowRenew: false,
      },
      201,
    )
  ).data;
  const restricted = await activate(env, { ...f, plan: restrictedPlan });
  for (const action of ['pause', 'close', 'renew']) {
    const result = await f.customerClient(
      'POST',
      `/subscriptions/${restricted.id}/${action}`,
      { expiryDate: '2028-10-01' },
      null,
    );
    assert.ok([400, 403, 409].includes(result.status), `Disabled ${action} allowed`);
  }
  assert.equal(
    (await f.customerClient('POST', `/subscriptions/${draft.id}/pause`, {})).data.status,
    'Paused',
  );
  assert.equal(
    (await f.customerClient('POST', `/subscriptions/${draft.id}/resume`, {})).data.status,
    'Active',
  );
  assert.equal(
    (
      await f.customerClient('POST', `/subscriptions/${draft.id}/renew`, {
        expiryDate: '2028-10-01',
      })
    ).data.expiryDate,
    '2028-10-01',
  );
  assert.equal(
    (await f.customerClient('POST', `/subscriptions/${draft.id}/close`, {})).data.status,
    'Closed',
  );
});

test('calendar cadences preserve monthly/yearly anchors and auto-close expired terms after catch-up', async (t) => {
  const env = await environment(t);
  const f = await commercialFixture(env);
  const examples = [
    {
      interval: 'daily',
      start: '2026-10-01',
      end: '2026-10-04',
      asOf: '2026-10-04',
      starts: ['2026-10-01', '2026-10-02', '2026-10-03'],
    },
    {
      interval: 'weekly',
      start: '2026-10-01',
      end: '2026-10-29',
      asOf: '2026-10-29',
      starts: ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22'],
    },
    {
      interval: 'monthly',
      start: '2026-01-31',
      end: '2026-04-30',
      asOf: '2026-04-30',
      starts: ['2026-01-31', '2026-02-28', '2026-03-31'],
    },
    {
      interval: 'yearly',
      start: '2024-02-29',
      end: '2028-02-29',
      asOf: '2028-02-29',
      starts: ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28'],
    },
  ];
  for (const sample of examples) {
    env.setNow(`${sample.start}T12:00:00Z`);
    await env.admin('POST', '/auth/login', ADMIN);
    const plan = (
      await env.admin(
        'POST',
        '/plans',
        {
          name: `${sample.interval} calendar`,
          price: 0,
          interval: sample.interval,
          minimumQuantity: 1,
          autoClose: true,
          allowClose: true,
          allowPause: true,
          allowRenew: true,
        },
        201,
      )
    ).data;
    const sub = await activate(
      env,
      { ...f, plan },
      { startDate: sample.start, expiryDate: sample.end },
    );
    env.setNow(`${sample.asOf}T12:00:00Z`);
    await env.admin('POST', '/auth/login', ADMIN);
    const run = (await env.admin('POST', '/billing/run', { asOf: sample.asOf })).data;
    assert.equal(run.errors.length, 0);
    const invoices = (await env.admin('GET', '/invoices?pageSize=100')).data.items
      .filter((invoice) => invoice.subscriptionId === sub.id)
      .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
    assert.deepEqual(
      invoices.map((invoice) => invoice.periodStart),
      sample.starts,
    );
    assert.equal(invoices.at(-1).periodEnd, sample.end);
    assert.equal((await env.admin('GET', `/subscriptions/${sub.id}`)).data.status, 'Closed');
    await env.admin('POST', '/billing/run', { asOf: sample.asOf });
    assert.equal(
      (await env.admin('GET', '/invoices?pageSize=100')).data.items.filter(
        (invoice) => invoice.subscriptionId === sub.id,
      ).length,
      sample.starts.length,
    );
  }
});

test('product discounts leave other products untouched and future/expired rules are excluded', async (t) => {
  const env = await environment(t);
  const f = await commercialFixture(env);
  const other = (
    await env.admin(
      'POST',
      '/products',
      { name: 'Unrelated add-on', type: 'service', salesPrice: 100, costPrice: 20, variants: [] },
      201,
    )
  ).data;
  await env.admin(
    'POST',
    '/discounts',
    {
      name: 'Future offer',
      type: 'percentage',
      value: 99,
      startDate: '2027-01-01',
      scope: 'subscription',
    },
    201,
  );
  await env.admin(
    'POST',
    '/discounts',
    {
      name: 'Only target product',
      type: 'fixed',
      value: 50,
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      scope: 'product',
      productIds: [f.product.id],
    },
    201,
  );
  await activate(env, f, {
    lines: [
      { productId: f.product.id, quantity: 1 },
      { productId: other.id, quantity: 1 },
    ],
  });
  await env.admin('POST', '/billing/run', { asOf: '2026-11-01' });
  const invoices = (await env.admin('GET', '/invoices')).data.items.sort((a, b) =>
    a.periodStart.localeCompare(b.periodStart),
  );
  assert.equal(invoices[0].discountTotal, 50);
  assert.equal(invoices[0].total, 150);
  assert.equal(invoices[0].lines.find((line) => line.productId === other.id).discount, 0);
  assert.equal(invoices[1].discountTotal, 0);
  assert.equal(invoices[1].total, 200);
});

test('quotation validity and unavailable plans reject invalid purchases', async (t) => {
  const env = await environment(t);
  const f = await commercialFixture(env);
  const plan = (
    await env.admin(
      'POST',
      '/plans',
      {
        name: 'Unavailable offering',
        price: 0,
        interval: 'monthly',
        minimumQuantity: 1,
        availableFrom: '2027-01-01',
        availableTo: '2027-12-31',
        autoClose: true,
      },
      201,
    )
  ).data;
  const unavailable = await env.admin(
    'POST',
    '/subscriptions',
    {
      customerId: f.customerId,
      planId: plan.id,
      startDate: '2026-10-01',
      expiryDate: '2027-10-01',
      lines: [{ productId: f.product.id, quantity: 1 }],
    },
    null,
  );
  assert.ok([400, 409, 422].includes(unavailable.status));
  const template = (
    await env.admin(
      'POST',
      '/templates',
      {
        name: 'One-day quote',
        planId: f.plan.id,
        validityDays: 1,
        paymentTerms: 7,
        lines: [{ productId: f.product.id, quantity: 1 }],
      },
      201,
    )
  ).data;
  const draft = (
    await env.admin(
      'POST',
      '/subscriptions',
      {
        customerId: f.customerId,
        templateId: template.id,
        startDate: '2026-10-01',
        expiryDate: '2027-10-01',
      },
      201,
    )
  ).data;
  await env.admin('POST', `/subscriptions/${draft.id}/quote`, {});
  env.setNow('2026-11-03T12:00:00Z');
  const expired = await env.admin('POST', `/subscriptions/${draft.id}/confirm`, {}, null);
  assert.ok([400, 409, 422].includes(expired.status));
});

test('pause spanning a billing boundary can resume without rebilling paused service', async (t) => {
  const env = await environment(t);
  const f = await commercialFixture(env);
  const sub = await activate(env, f);
  await env.admin('POST', '/billing/run', { asOf: '2026-10-01' });
  await f.customerClient('POST', `/subscriptions/${sub.id}/pause`, {});
  env.setNow('2026-11-15T12:00:00Z');
  await env.admin('POST', '/auth/login', ADMIN);
  await f.customerClient('POST', '/auth/login', {
    email: 'customer@acceptance.test',
    password: PASSWORD,
  });
  await env.admin('POST', '/billing/run', { asOf: '2026-11-15' });
  assert.equal(
    (await env.admin('GET', '/invoices')).data.total,
    1,
    'Paused subscription should not bill November',
  );
  const resumed = (await f.customerClient('POST', `/subscriptions/${sub.id}/resume`, {})).data;
  assert.equal(resumed.status, 'Active');
  assert.equal(resumed.nextBillingDate, '2026-12-01');
  await env.admin('POST', '/billing/run', { asOf: '2026-11-15' });
  assert.equal(
    (await env.admin('GET', '/invoices')).data.total,
    1,
    'No partial-period charge on resume',
  );
  await env.admin('POST', '/billing/run', { asOf: '2026-12-01' });
  const invoices = (await env.admin('GET', '/invoices')).data.items;
  assert.equal(invoices.length, 2);
  assert.ok(
    invoices.some((invoice) => invoice.periodStart === '2026-12-01'),
    'Billing should resume on the next original anchor',
  );
  assert.ok(
    !invoices.some((invoice) => invoice.periodStart === '2026-11-01'),
    'Paused service should not backbill',
  );
});

test('invalid foreign variants, expired reset tokens, negative money and untrusted origins are rejected', async (t) => {
  const env = await environment(t);
  const f = await commercialFixture(env);
  const other = (
    await env.admin(
      'POST',
      '/products',
      {
        name: 'Other variant owner',
        type: 'service',
        salesPrice: 1,
        costPrice: 0,
        variants: [{ name: 'Wrong variant', priceAdjustment: 560 }],
      },
      201,
    )
  ).data;
  const invalidVariant = await env.admin(
    'POST',
    '/subscriptions',
    {
      customerId: f.customerId,
      planId: f.plan.id,
      startDate: '2026-10-01',
      expiryDate: '2027-10-01',
      lines: [{ productId: f.product.id, variantId: other.variants[0].id, quantity: 1 }],
    },
    null,
  );
  assert.ok([400, 422].includes(invalidVariant.status));
  for (const body of [
    { name: 'Negative', type: 'service', salesPrice: -1 },
    { name: 'Not a number', type: 'service', salesPrice: 'Infinity' },
  ]) {
    const result = await env.admin('POST', '/products', body, null);
    assert.ok([400, 422].includes(result.status));
  }
  const wrongOrigin = await fetch(env.base + '/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' },
    body: JSON.stringify({ name: 'Cross origin', email: 'cross@example.test', password: PASSWORD }),
  });
  assert.equal(wrongOrigin.status, 403);
  await wrongOrigin.text();
  const anonymous = env.client();
  await anonymous('POST', '/auth/forgot-password', { email: 'customer@acceptance.test' });
  const reset = (await env.admin('GET', '/outbox')).data.items.find(
    (message) => message.to === 'customer@acceptance.test',
  );
  const token = /[?&]token=([^"'\s<>&]+)/.exec(reset.html)[1];
  env.setNow('2026-10-31T12:31:00Z');
  const expired = await anonymous(
    'POST',
    '/auth/reset-password',
    { token: decodeURIComponent(token), password: 'ChangedPass!123' },
    null,
  );
  assert.ok([400, 401, 410].includes(expired.status));
  await anonymous('POST', '/auth/login', { email: 'customer@acceptance.test', password: PASSWORD });
  const ownCatalog = (await f.customerClient('GET', `/products/${f.product.id}`)).data;
  assert.equal(Object.hasOwn(ownCatalog, 'costPrice'), false);
});

test('failed billing transaction rolls back and persisted retries survive application restart', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'brightloop-acceptance-'));
  const dbPath = join(directory, 'recovery.sqlite');
  const env = await environment(t, { dbPath });
  const f = await commercialFixture(env);
  const sub = await activate(env, f);
  env.app.locals.db.exec(
    "CREATE TRIGGER reject_invoice BEFORE INSERT ON invoices BEGIN SELECT RAISE(ABORT,'injected write failure'); END;",
  );
  const failed = (await env.admin('POST', '/billing/run', { asOf: '2026-10-01' })).data;
  assert.equal(failed.created, 0);
  assert.equal(failed.errors.length, 1);
  assert.equal((await env.admin('GET', '/invoices')).data.total, 0);
  assert.equal(
    (await env.admin('GET', `/subscriptions/${sub.id}`)).data.nextBillingDate,
    '2026-10-01',
  );
  env.app.locals.db.exec('DROP TRIGGER reject_invoice');
  assert.equal((await env.admin('POST', '/billing/run', { asOf: '2026-10-01' })).data.created, 1);
  await env.shutdown();
  const restarted = await environment(t, { dbPath });
  assert.equal((await restarted.admin('GET', '/invoices')).data.total, 1);
  assert.equal(
    (await restarted.admin('POST', '/billing/run', { asOf: '2026-10-01' })).data.created,
    0,
  );
  assert.equal(
    (await restarted.admin('GET', `/subscriptions/${sub.id}`)).data.nextBillingDate,
    '2026-11-01',
  );
  await restarted.shutdown();
  for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
  rmdirSync(directory);
});

test('renewing an early-closed subscription never bills its closed service gap', async (t) => {
  const env = await environment(t);
  const f = await commercialFixture(env);
  const sub = await activate(env, f);
  await f.customerClient('POST', `/subscriptions/${sub.id}/close`, {});
  assert.equal(
    (await env.admin('GET', '/invoices')).data.total,
    1,
    'Closing catches up the current service period',
  );
  env.setNow('2027-01-15T12:00:00Z');
  await env.admin('POST', '/auth/login', ADMIN);
  await f.customerClient('POST', '/auth/login', {
    email: 'customer@acceptance.test',
    password: PASSWORD,
  });
  await f.customerClient('POST', `/subscriptions/${sub.id}/renew`, { expiryDate: '2028-10-01' });
  await env.admin('POST', '/billing/run', { asOf: '2027-01-15' });
  const invoices = (await env.admin('GET', '/invoices')).data.items;
  assert.ok(
    !invoices.some((invoice) =>
      ['2026-11-01', '2026-12-01', '2027-01-01'].includes(invoice.periodStart),
    ),
    'Months during closure must not be charged on renewal',
  );
});

test('a subscription discount can bill paid products followed by free add-ons', async (t) => {
  const env = await environment(t);
  const f = await commercialFixture(env);
  const free = (
    await env.admin(
      'POST',
      '/products',
      { name: 'Included support', type: 'service', salesPrice: 0, costPrice: 0, variants: [] },
      201,
    )
  ).data;
  await env.admin(
    'POST',
    '/discounts',
    { name: 'Fixed subscription discount', type: 'fixed', value: 50, scope: 'subscription' },
    201,
  );
  await activate(env, f, {
    lines: [
      { productId: f.product.id, quantity: 1 },
      { productId: free.id, quantity: 1 },
      { productId: free.id, quantity: 1 },
    ],
  });
  const run = (await env.admin('POST', '/billing/run', { asOf: '2026-10-01' })).data;
  assert.deepEqual(run.errors, []);
  assert.equal(run.created, 1);
  const invoice = (await env.admin('GET', '/invoices')).data.items[0];
  assert.equal(invoice.subtotal, 100);
  assert.equal(invoice.discountTotal, 50);
  assert.equal(invoice.total, 50);
  assert.ok(invoice.lines.every((line) => line.total >= 0));
});

test('a verified portal invitation links staff-created billing records without unverified email takeover', async (t) => {
  const env = await environment(t);
  const f = await commercialFixture(env);
  const manual = (
    await env.admin(
      'POST',
      '/customers',
      {
        name: 'Sales-created customer',
        email: 'sales-created@acceptance.test',
        address: 'Existing billing profile',
      },
      201,
    )
  ).data;
  const sub = await activate(env, { ...f, customerId: manual.id });
  await env.admin('POST', '/billing/run', { asOf: '2026-10-01' });
  const unknown = env.client();
  await unknown(
    'POST',
    '/auth/register',
    { name: 'Unverified claimant', email: manual.email, password: PASSWORD },
    409,
  );
  await f.customerClient('POST', `/customers/${manual.id}/invite`, {}, 403);
  const invitation = (await env.admin('POST', `/customers/${manual.id}/invite`, {})).data;
  assert.equal(
    Object.hasOwn(invitation, 'token'),
    false,
    'Invitation tokens must not be returned in API payload',
  );
  const outbox = (await env.admin('GET', '/outbox')).data.items;
  const message = outbox.find((item) => item.to === manual.email);
  assert.ok(message?.html);
  const setupToken = /[?&]token=([^"'\s<>&]+)/.exec(message.html)?.[1];
  assert.ok(setupToken);
  await unknown('POST', '/auth/reset-password', {
    token: decodeURIComponent(setupToken),
    password: PASSWORD,
  });
  const loggedIn = (
    await unknown('POST', '/auth/login', { email: manual.email, password: PASSWORD })
  ).data;
  assert.equal(loggedIn.user.role, 'customer');
  assert.equal(loggedIn.user.customerId, manual.id);
  const subscriptions = (await unknown('GET', '/subscriptions')).data;
  assert.equal(subscriptions.total, 1);
  assert.equal(subscriptions.items[0].id, sub.id);
  assert.equal((await unknown('GET', '/invoices')).data.total, 1);
  await unknown(
    'POST',
    '/auth/reset-password',
    { token: decodeURIComponent(setupToken), password: 'ReusedPassword!123' },
    400,
  );
});
