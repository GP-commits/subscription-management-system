import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createApp } from '../src/app.js';

test('representative API pages remain below 2 seconds with 5,000 subscriptions and invoices', async (t) => {
  const admin = { name: 'Load Admin', email: 'load-admin@example.test', password: 'LoadAdmin!123' };
  const app = await createApp({
    dbPath: ':memory:',
    now: () => new Date('2026-10-31T12:00:00Z'),
    bootstrapAdmin: admin,
    disableRateLimit: true,
    frontendUrl: 'http://localhost:5173',
  });
  const server = await new Promise((resolve) => {
    const value = app.listen(0, '127.0.0.1', () => resolve(value));
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await app.locals.close?.();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = '';
  async function request(method, path, body) {
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
    const data = await response.json();
    assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  }
  await request('POST', '/auth/login', admin);
  const customer = await request('POST', '/customers', {
    name: 'Load customer',
    email: 'load-customer@example.test',
    address: 'Load fixture only',
  });
  const product = await request('POST', '/products', {
    name: 'Load product',
    type: 'service',
    salesPrice: 100,
    costPrice: 30,
    variants: [],
  });
  const plan = await request('POST', '/plans', {
    name: 'Monthly load plan',
    price: 0,
    interval: 'monthly',
    minimumQuantity: 1,
    autoClose: true,
    allowClose: true,
    allowPause: true,
    allowRenew: true,
  });
  const original = await request('POST', '/subscriptions', {
    customerId: customer.id,
    planId: plan.id,
    startDate: '2026-10-01',
    expiryDate: '2027-10-01',
    paymentTerms: 7,
    lines: [{ productId: product.id, quantity: 1 }],
  });
  for (const action of ['quote', 'confirm', 'activate'])
    await request('POST', `/subscriptions/${original.id}/${action}`, {});
  await request('POST', '/billing/run', { asOf: '2026-10-01' });
  const invoice = (await request('GET', '/invoices')).items[0];
  await request('POST', `/invoices/${invoice.id}/confirm`, {});

  // Fixture insertion keeps setup separate from the HTTP latency measurements.
  // All rows use the exact shape of API-created records and retain foreign keys.
  const db = app.locals.db;
  const subRow = db.prepare('SELECT * FROM subscriptions WHERE id=?').get(original.id);
  const invRow = db.prepare('SELECT * FROM invoices WHERE id=?').get(invoice.id);
  const insertSub = db.prepare(
    'INSERT INTO subscriptions(id,customer_id,plan_id,status,next_billing_date,data) VALUES(?,?,?,?,?,?)',
  );
  const insertInv = db.prepare(
    'INSERT INTO invoices(id,subscription_id,customer_id,status,period_start,period_end,issue_date,due_date,total_cents,paid_cents,discount_id,discount_state,data) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
  );
  db.exec('BEGIN IMMEDIATE');
  try {
    for (let n = 1; n < 5000; n++) {
      const subId = `performance-sub-${n}`,
        invId = `performance-invoice-${n}`;
      const subData = { ...JSON.parse(subRow.data), number: `LOAD-SUB-${n}` };
      const invData = {
        ...JSON.parse(invRow.data),
        number: `LOAD-INV-${n}`,
        subscriptionNumber: subData.number,
      };
      insertSub.run(
        subId,
        subRow.customer_id,
        subRow.plan_id,
        subRow.status,
        subRow.next_billing_date,
        JSON.stringify(subData),
      );
      insertInv.run(
        invId,
        subId,
        invRow.customer_id,
        invRow.status,
        invRow.period_start,
        invRow.period_end,
        invRow.issue_date,
        invRow.due_date,
        invRow.total_cents,
        0,
        null,
        null,
        JSON.stringify(invData),
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  assert.equal(db.prepare('SELECT count(*) AS total FROM subscriptions').get().total, 5000);
  assert.equal(db.prepare('SELECT count(*) AS total FROM invoices').get().total, 5000);

  for (const path of [
    '/subscriptions?page=1&pageSize=25',
    '/subscriptions?page=150&pageSize=25&q=LOAD',
    '/invoices?page=1&pageSize=25',
    '/invoices?page=150&pageSize=25',
    '/reports/summary',
  ]) {
    const samples = [];
    for (let iteration = 0; iteration < 5; iteration++) {
      const started = performance.now();
      const result = await request('GET', path);
      samples.push(performance.now() - started);
      if (path.includes('pageSize'))
        assert.ok(result.items.length <= 25, 'Response must be paginated');
      else {
        assert.equal(result.activeSubscriptions, 5000);
        assert.equal(result.invoicedRevenue, 500000);
      }
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const max = sorted.at(-1);
    t.diagnostic(
      `${path}: median ${sorted[2].toFixed(1)} ms; max/p95 of 5 samples ${max.toFixed(1)} ms; 5,000 subscriptions + 5,000 invoices, local single-client HTTP`,
    );
    assert.ok(max < 2000, `${path} exceeded 2 seconds: ${max.toFixed(1)} ms`);
  }
});
