import { createApp } from './app.js';
import { dateOnly, addDays } from './domain.js';

if (process.env.NODE_ENV === 'production')
  throw new Error('Demo seeding is disabled in production.');
const app = await createApp({
  bootstrapAdmin: { email: 'admin@brightloop.test', password: 'AdminPass!23', name: 'Alex Morgan' },
  disableRateLimit: true,
});
if (app.locals.db.prepare('SELECT COUNT(*) AS n FROM products').get().n) {
  console.log('Demo catalog already exists; no records changed.');
  app.locals.close();
  process.exit(0);
}
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;
let cookie = '';
async function api(path, body, method = 'POST') {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${data.error}`);
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  return data;
}
const today = dateOnly(new Date()),
  current = new Date(`${today}T00:00:00Z`);
const periodStart = dateOnly(
  new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 2, 1)),
);
const expiry = dateOnly(
  new Date(Date.UTC(current.getUTCFullYear() + 1, current.getUTCMonth() - 2, 1)),
);
try {
  const customerUser = await api('/auth/register', {
    name: 'Northstar Studio',
    email: 'customer@brightloop.test',
    password: 'CustomerPass!23',
  });
  const customerId = customerUser.user.customerId;
  await api('/auth/login', { email: 'admin@brightloop.test', password: 'AdminPass!23' });
  await api('/staff', {
    name: 'Jamie Chen',
    email: 'staff@brightloop.test',
    password: 'StaffPass!23',
  });
  await api(
    `/customers/${customerId}`,
    { phone: '+91 80000 12345', address: '24 Studio Lane, Bengaluru', taxId: 'DEMO-TAX-001' },
    'PATCH',
  );
  const customers = [{ id: customerId }];
  for (const [name, email] of [
    ['Acme Digital', 'billing@acme.example'],
    ['Atlas Commerce', 'accounts@atlas.example'],
    ['Evergreen Labs', 'finance@evergreen.example'],
    ['Nova Systems', 'billing@nova.example'],
    ['Pixel & Paper', 'hello@pixel.example'],
  ])
    customers.push(await api('/customers', { name, email, address: 'Demo customer address' }));
  const platform = await api('/products', {
    name: 'Business Suite',
    type: 'Software',
    salesPrice: 1490,
    costPrice: 480,
    notes: 'Complete workspace for growing teams.',
    variants: [
      { name: 'Standard', priceAdjustment: 0 },
      { name: 'Odoo', priceAdjustment: 560 },
    ],
  });
  const analytics = await api('/products', {
    name: 'Advanced Analytics',
    type: 'Add-on',
    salesPrice: 390,
    costPrice: 80,
    notes: 'Reporting and insight add-on.',
    variants: [],
  });
  await api('/products', {
    name: 'Priority Support',
    type: 'Service',
    salesPrice: 790,
    costPrice: 250,
    notes: 'Priority support coverage.',
    variants: [],
  });
  await api('/products', {
    name: 'Cloud Storage',
    type: 'Add-on',
    salesPrice: 190,
    costPrice: 45,
    notes: 'Extra workspace storage.',
    variants: [
      { name: '100 GB', priceAdjustment: 0 },
      { name: '500 GB', priceAdjustment: 400 },
    ],
  });
  const plan = await api('/plans', {
    name: 'Growth Monthly',
    price: 0,
    interval: 'monthly',
    minimumQuantity: 1,
    autoClose: true,
    allowClose: true,
    allowPause: true,
    allowRenew: true,
  });
  await api('/plans', {
    name: 'Enterprise Annual',
    price: 0,
    interval: 'yearly',
    minimumQuantity: 10,
    autoClose: true,
    allowClose: false,
    allowPause: false,
    allowRenew: true,
  });
  await api('/plans', {
    name: 'Flex Weekly',
    price: 99,
    interval: 'weekly',
    minimumQuantity: 1,
    autoClose: true,
    allowClose: true,
    allowPause: true,
    allowRenew: true,
  });
  await api('/taxes', { name: 'Demo sales tax', rate: 18, productIds: [], active: true });
  await api('/templates', {
    name: 'Growth team starter',
    planId: plan.id,
    validityDays: 30,
    paymentTerms: 14,
    notes: 'Monthly team workspace with analytics.',
    lines: [
      { productId: platform.id, quantity: 3 },
      { productId: analytics.id, quantity: 1 },
    ],
  });
  for (let index = 0; index < customers.length; index++) {
    const sub = await api('/subscriptions', {
      customerId: customers[index].id,
      planId: plan.id,
      startDate: periodStart,
      expiryDate: expiry,
      paymentTerms: 14,
      lines: [
        {
          productId: platform.id,
          variantId: index % 2 ? platform.variants[1].id : undefined,
          quantity: index + 1,
        },
        { productId: analytics.id, quantity: 1 },
      ],
    });
    if (index === 5) continue;
    await api(`/subscriptions/${sub.id}/quote`, {});
    if (index === 4) continue;
    await api(`/subscriptions/${sub.id}/confirm`, {});
    await api(`/subscriptions/${sub.id}/activate`, {});
  }
  await api('/discounts', {
    name: 'Team loyalty',
    type: 'percentage',
    value: 10,
    minAmount: 0,
    minQuantity: 5,
    startDate: periodStart,
    endDate: expiry,
    usageLimit: 25,
    scope: 'subscription',
    productIds: [],
    subscriptionIds: [],
  });
  await api('/billing/run', {});
  const invoices = await api('/invoices?pageSize=100', null, 'GET');
  for (let index = 0; index < invoices.items.length; index++) {
    const invoice = await api(`/invoices/${invoices.items[index].id}/confirm`, {});
    if (index % 3 === 0)
      await api('/payments', {
        invoiceId: invoice.id,
        amount: invoice.total,
        method: 'Bank transfer',
        date: today,
        note: 'Demo payment',
        reference: `DEMO-${index}`,
      });
    else if (index % 3 === 1)
      await api('/payments', {
        invoiceId: invoice.id,
        amount: Math.floor(invoice.total * 50) / 100,
        method: 'Card',
        date: today,
        note: 'Demo partial payment',
        reference: `DEMO-${index}`,
      });
  }
  console.log(
    'Demo data created. Login accounts:\nadmin@brightloop.test / AdminPass!23\nstaff@brightloop.test / StaffPass!23\ncustomer@brightloop.test / CustomerPass!23',
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  app.locals.close();
}
