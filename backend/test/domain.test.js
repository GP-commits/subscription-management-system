import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { nextPeriod, cents, money, normalizeLines, date, passwordValid } from '../src/domain.js';
import { calculateInvoice, invoiceHtml } from '../src/billing.js';

test('calendar math preserves month-end and leap-year anchors', () => {
  assert.equal(nextPeriod('2026-01-31', 'monthly'), '2026-02-28');
  assert.equal(nextPeriod('2026-02-28', 'monthly', '2026-01-31'), '2026-03-31');
  assert.equal(nextPeriod('2024-02-29', 'yearly'), '2025-02-28');
  assert.equal(nextPeriod('2027-02-28', 'yearly', '2024-02-29'), '2028-02-29');
  assert.equal(nextPeriod('2026-12-31', 'daily'), '2027-01-01');
  assert.equal(nextPeriod('2026-12-28', 'weekly'), '2027-01-04');
  assert.throws(() => date('2026-02-30'));
});

test('money rounds half up without binary floating-point multiplication', () => {
  assert.equal(cents('1.005'), 101);
  assert.equal(money(101), 1.01);
  assert.equal(cents('999.995'), 100000);
});

test('password rule exactly enforces greater-than-eight and required character classes', () => {
  assert.equal(passwordValid('Abcdefg!'), false);
  assert.equal(passwordValid('Abcdefgh!'), true);
  assert.equal(passwordValid('abcdefgh!'), false);
  assert.equal(passwordValid('ABCDEFGH!'), false);
  assert.equal(passwordValid('Abcdefgh1'), false);
  assert.equal(passwordValid('Abcdefgh '), false);
});

test('catalog variant surcharge is applied once and stored snapshot survives catalog change', () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare('INSERT INTO products VALUES(?,?)').run(
      'product',
      JSON.stringify({
        name: 'Suite',
        active: true,
        salesPrice: 1000,
        variants: [{ id: 'odoo', name: 'Odoo', priceAdjustment: 560 }],
      }),
    );
    const lines = normalizeLines(db, [{ productId: 'product', variantId: 'odoo', quantity: 2 }]);
    assert.equal(lines[0].unitPrice, 1560);
    assert.equal(lines[0].amount, 3120);
    assert.equal(normalizeLines(db, lines, { snapshot: true })[0].unitPrice, 1560);
    assert.throws(() =>
      normalizeLines(db, [{ productId: 'product', variantId: 'wrong', quantity: 1 }]),
    );
  } finally {
    db.close();
  }
});

test('near-total discount over many tiny lines never produces negative line totals', () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare('INSERT INTO discounts(id,data) VALUES(?,?)').run(
      'discount',
      JSON.stringify({
        name: 'Ninety-nine cents',
        active: true,
        type: 'fixed',
        value: 0.99,
        scope: 'subscription',
        minAmount: 0,
        minQuantity: 0,
        usageLimit: null,
        productIds: [],
        subscriptionIds: [],
      }),
    );
    const sub = {
      id: 'sub',
      planSnapshot: { name: 'Free base', price: 0 },
      lines: Array.from({ length: 100 }, (_, i) => ({
        productId: `p${i}`,
        productName: `Product ${i}`,
        quantity: 1,
        unitPrice: 0.01,
        taxIds: [],
      })),
    };
    const result = calculateInvoice(db, sub, '2026-10-31');
    assert.equal(result.subtotal, 1);
    assert.equal(result.discountTotal, 0.99);
    assert.equal(result.total, 0.01);
    assert.ok(result.lines.every((line) => line.total >= 0 && line.discount <= line.subtotal));
    assert.equal(
      result.lines.reduce((sum, line) => sum + cents(line.discount), 0),
      99,
    );
  } finally {
    db.close();
  }
});

test('subscription discount allocates before mixed taxes and excludes ineligible product tax', () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare('INSERT INTO discounts(id,data) VALUES(?,?)').run(
      'd',
      JSON.stringify({
        name: 'Half off',
        active: true,
        type: 'percentage',
        value: 50,
        scope: 'subscription',
        minAmount: 0,
        minQuantity: 0,
        usageLimit: null,
        productIds: [],
        subscriptionIds: [],
      }),
    );
    db.prepare('INSERT INTO taxes VALUES(?,?)').run(
      't',
      JSON.stringify({ name: 'Selective', rate: 20, active: true, productIds: ['a'] }),
    );
    const sub = {
      id: 's',
      planSnapshot: { name: 'Base', price: 0 },
      lines: ['a', 'b'].map((productId) => ({
        productId,
        productName: productId,
        quantity: 1,
        unitPrice: 100,
        taxIds: [],
      })),
    };
    const result = calculateInvoice(db, sub, '2026-10-31');
    assert.equal(result.discountTotal, 100);
    assert.equal(result.taxTotal, 10);
    assert.equal(result.total, 110);
  } finally {
    db.close();
  }
});

test('printable invoice escapes stored customer and product markup', () => {
  const invoice = {
    number: '<script>alert(1)</script>',
    status: 'Confirmed',
    customer: { name: '<img src=x>', email: 'a@example.test' },
    lines: [
      {
        description: '<script>x</script>',
        quantity: 1,
        unitPrice: 1,
        discount: 0,
        tax: 0,
        total: 1,
        taxes: [],
      },
    ],
    currency: 'INR',
    subtotal: 1,
    discountTotal: 0,
    taxTotal: 0,
    total: 1,
    paidAmount: 0,
    balance: 1,
  };
  const html = invoiceHtml(invoice);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src=x>'));
});
