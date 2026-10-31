import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App.jsx';

const admin = { id: 'u1', name: 'Alex Admin', email: 'admin@example.test', role: 'admin' };
const report = {
  activeSubscriptions: 3,
  totalSubscriptions: 5,
  invoicedRevenue: 15000,
  paymentsReceived: 10000,
  outstanding: 5000,
  overdueAmount: 1200,
  overdueCount: 1,
  mrr: 3500,
  currency: 'INR',
  monthlyRevenue: [{ month: '2026-10', invoiced: 15000, payments: 10000 }],
  subscriptionBreakdown: [
    { status: 'Active', count: 3 },
    { status: 'Draft', count: 2 },
  ],
  recentInvoices: [],
  overdueInvoices: [],
};
function mockServer({
  user = admin,
  resources = {},
  postError = null,
  unauthenticated = false,
} = {}) {
  const calls = [];
  global.fetch = vi.fn(async (url, options = {}) => {
    const path = new URL(url, 'http://localhost').pathname.replace('/api', '');
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, body, method: options.method || 'GET' });
    let result,
      status = 200;
    if (path === '/auth/me') {
      if (unauthenticated) {
        status = 401;
        result = { error: 'Please sign in.' };
      } else result = { user };
    } else if (path === '/auth/login') result = { user };
    else if (path === '/auth/register')
      result = { user: { ...user, role: 'customer', name: body.name, email: body.email } };
    else if (path === '/auth/forgot-password')
      result = { message: 'If an active account exists, a password reset link has been sent.' };
    else if (path === '/auth/reset-password')
      result = { message: 'Password updated. Sign in with your new password.' };
    else if (path === '/reports/summary') result = report;
    else if (options.method === 'POST' || options.method === 'PATCH') {
      if (postError) {
        status = 400;
        result = { error: postError };
      } else result = { id: 'created', ...body };
    } else {
      const key = path.split('/')[1],
        items = resources[key] || [];
      result =
        path.split('/').length > 2
          ? items.find((x) => x.id === path.split('/')[2]) || { id: 'x' }
          : { items, total: items.length, page: 1, pageSize: 15 };
    }
    return { ok: status >= 200 && status < 300, status, json: async () => result };
  });
  return calls;
}
describe('authentication workflows', () => {
  it('logs in with cookie credentials and renders live metrics', async () => {
    const calls = mockServer({ unauthenticated: true });
    render(<App />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email address'), 'alex@example.test');
    await user.type(screen.getByLabelText('Password'), 'SecurePass!23');
    await user.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
    await screen.findByRole('heading', { name: 'Billing at a glance' });
    expect(calls.find((c) => c.path === '/auth/login').body).toEqual({
      name: '',
      email: 'alex@example.test',
      password: 'SecurePass!23',
      token: '',
    });
    expect(
      global.fetch.mock.calls.find(([url]) => url.endsWith('/auth/login'))[1].credentials,
    ).toBe('include');
    expect(
      await screen.findByRole('button', { name: /Active subscriptions 3/ }),
    ).toBeInTheDocument();
  });
  it('validates the full registration password rule before sending', async () => {
    const calls = mockServer({ unauthenticated: true });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Create an account' }));
    await user.type(screen.getByLabelText('Full name'), 'New Customer');
    await user.type(screen.getByLabelText('Email address'), 'customer@example.test');
    await user.type(screen.getByLabelText(/Password/), 'lowercase-only');
    await user.click(screen.getByRole('button', { name: 'Create account', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('uppercase');
    expect(calls.some((c) => c.path === '/auth/register')).toBe(false);
  });
  it('submits forgot-password request and displays neutral response', async () => {
    const calls = mockServer({ unauthenticated: true });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Forgot password?' }));
    await user.type(screen.getByLabelText('Email address'), 'customer@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('status')).toHaveTextContent('If an active account exists');
    expect(calls.find((c) => c.path === '/auth/forgot-password').body).toEqual({
      email: 'customer@example.test',
    });
  });
  it('uses reset token from URL and returns to login after success', async () => {
    window.history.replaceState({}, '', '/reset-password?token=reset-token');
    const calls = mockServer({ unauthenticated: true });
    render(<App />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Password/), 'NewSecure!23');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(
      await screen.findByRole('heading', { name: 'Sign in to Brightloop' }),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/auth/reset-password').body).toEqual({
      token: 'reset-token',
      password: 'NewSecure!23',
    });
    expect(window.location.pathname).toBe('/');
  });
});
describe('workspace permissions and real mutations', () => {
  it('limits customer navigation and omits protected fields from profile updates', async () => {
    const customer = { ...admin, role: 'customer', customerId: 'c1' };
    const calls = mockServer({
      user: customer,
      resources: {
        customers: [
          {
            id: 'c1',
            name: 'Customer',
            email: 'customer@example.test',
            active: true,
            phone: '',
            address: '',
            taxId: '',
          },
        ],
      },
    });
    render(<App />);
    const user = userEvent.setup();
    const nav = await screen.findByRole('navigation');
    expect(within(nav).queryByRole('button', { name: 'Team members' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('button', { name: 'Products' })).not.toBeInTheDocument();
    await user.click(within(nav).getByRole('button', { name: 'Your account' }));
    await user.click(await screen.findByRole('button', { name: 'Edit profile' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByLabelText('Active customer')).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Phone'), '123456');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const payload = calls.find((c) => c.method === 'PATCH').body;
    expect(payload.phone).toBe('123456');
    expect(payload).not.toHaveProperty('active');
    expect(payload).not.toHaveProperty('email');
  });
  it('hides admin-only creation for staff while allowing operational work', async () => {
    mockServer({ user: { ...admin, role: 'staff' } });
    render(<App />);
    const user = userEvent.setup();
    const nav = await screen.findByRole('navigation');
    expect(within(nav).queryByRole('button', { name: 'Tax rules' })).not.toBeInTheDocument();
    await user.click(within(nav).getByRole('button', { name: 'Products' }));
    expect(screen.queryByRole('button', { name: 'New product' })).not.toBeInTheDocument();
    await user.click(within(nav).getByRole('button', { name: 'Customers' }));
    expect(screen.getByRole('button', { name: 'New customer' })).toBeInTheDocument();
  });
  it('creates a product and a variant with numeric pricing and closes dialog', async () => {
    const calls = mockServer();
    render(<App />);
    const user = userEvent.setup();
    await user.click(
      within(await screen.findByRole('navigation')).getByRole('button', { name: 'Products' }),
    );
    await user.click(screen.getByRole('button', { name: 'New product' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Product name/), 'Business suite');
    const price = within(dialog).getByLabelText(/Sales price/);
    await user.clear(price);
    await user.type(price, '1200');
    await user.click(within(dialog).getByRole('button', { name: 'Add variant' }));
    await user.type(within(dialog).getByLabelText('Variant name'), 'Odoo');
    const adjustment = within(dialog).getByLabelText('Price adjustment');
    await user.clear(adjustment);
    await user.type(adjustment, '560');
    await user.click(within(dialog).getByRole('button', { name: 'Create product' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const payload = calls.find((c) => c.path === '/products' && c.method === 'POST').body;
    expect(payload.salesPrice).toBe(1200);
    expect(payload.variants).toEqual([{ name: 'Odoo', priceAdjustment: 560 }]);
    expect(await screen.findByRole('status')).toHaveTextContent('Saved successfully');
  });
  it('keeps form input and reports a rejected API mutation', async () => {
    mockServer({ postError: 'A product with this name already exists.' });
    render(<App />);
    const user = userEvent.setup();
    await user.click(
      within(await screen.findByRole('navigation')).getByRole('button', { name: 'Products' }),
    );
    await user.click(screen.getByRole('button', { name: 'New product' }));
    await user.type(screen.getByLabelText(/Product name/), 'Duplicate product');
    await user.click(screen.getByRole('button', { name: 'Create product' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A product with this name already exists.',
    );
    expect(screen.getByLabelText(/Product name/)).toHaveValue('Duplicate product');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('requires explicit confirmation before reversing payment', async () => {
    const calls = mockServer({
      resources: {
        payments: [
          {
            id: 'p1',
            invoiceNumber: 'INV-001',
            amount: 100,
            method: 'Cash',
            date: '2026-10-31',
            status: 'Recorded',
          },
        ],
      },
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(
      within(await screen.findByRole('navigation')).getByRole('button', {
        name: 'Payments',
        exact: true,
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'INV-001', exact: true }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Reverse', exact: true }),
    );
    expect(calls.some((c) => c.path.endsWith('/reverse'))).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Confirm reverse' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/payments/p1/reverse' && c.method === 'POST')).toBe(
        true,
      ),
    );
  });
  it('uses the subscription plan snapshot to hide forbidden lifecycle actions', async () => {
    mockServer({
      resources: {
        plans: [
          {
            id: 'plan1',
            name: 'Changed plan',
            allowPause: true,
            allowClose: true,
            allowRenew: true,
          },
        ],
        subscriptions: [
          {
            id: 's1',
            number: 'SUB-001',
            planId: 'plan1',
            status: 'Active',
            planSnapshot: { allowPause: false, allowClose: false, allowRenew: false },
            lines: [],
          },
        ],
      },
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(
      within(await screen.findByRole('navigation')).getByRole('button', {
        name: 'Subscriptions',
        exact: true,
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'SUB-001', exact: true }));
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).queryByRole('button', { name: 'Pause', exact: true }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Renew', exact: true }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Close', exact: true }),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByRole('button', { name: 'Close', exact: true })).toHaveLength(1);
  });
  it('does not offer email sending for a draft invoice', async () => {
    mockServer({
      resources: {
        invoices: [
          {
            id: 'i1',
            number: 'INV-002',
            status: 'Draft',
            paidAmount: 0,
            total: 100,
            balance: 100,
            currency: 'INR',
            lines: [],
          },
        ],
      },
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(
      within(await screen.findByRole('navigation')).getByRole('button', {
        name: 'Invoices',
        exact: true,
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'INV-002', exact: true }));
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).queryByRole('button', { name: 'Send', exact: true }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Confirm', exact: true }),
    ).toBeInTheDocument();
  });
  it('invites an existing customer to their portal without showing credentials', async () => {
    const calls = mockServer({
      resources: {
        customers: [
          { id: 'c2', name: 'Sales customer', email: 'sales@example.test', active: true },
        ],
      },
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(
      within(await screen.findByRole('navigation')).getByRole('button', {
        name: 'Customers',
        exact: true,
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Sales customer', exact: true }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Invite to portal' }),
    );
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/customers/c2/invite' && c.method === 'POST')).toBe(
        true,
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Portal invitation queued.');
  });
  it('shows loading while session request is pending', () => {
    global.fetch = vi.fn(() => new Promise(() => {}));
    render(<App />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading your workspace');
  });
});
