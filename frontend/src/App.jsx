import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Download,
  FileText,
  Layers3,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  Package,
  Percent,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { api, API_BASE } from './api.js';
import Modal from './components/Modal.jsx';
import RevenueChart from './components/RevenueChart.jsx';
import { money, date, today, passwordValid, query, initials } from './utils.js';

const NAV = [
  ['overview', 'Overview', LayoutDashboard],
  ['customers', 'Customers', Users],
  ['products', 'Products', Package],
  ['plans', 'Plans', Layers3],
  ['templates', 'Quotation templates', ClipboardList],
  ['subscriptions', 'Subscriptions', RefreshCw],
  ['invoices', 'Invoices', FileText],
  ['payments', 'Payments', Wallet],
  ['reports', 'Reports', BarChart3],
  ['taxes', 'Tax rules', Percent],
  ['discounts', 'Discounts', CircleDollarSign],
  ['staff', 'Team members', ShieldCheck],
  ['outbox', 'Email outbox', Mail],
];
const ADMIN_ONLY = ['taxes', 'discounts', 'staff', 'outbox'];
const ADMIN_WRITE = ['products', 'plans', 'templates', 'taxes', 'discounts', 'staff'];
const CUSTOMER_NAV = ['overview', 'subscriptions', 'invoices', 'payments', 'profile'];
const labels = {
  overview: 'Billing overview',
  reports: 'Revenue & reports',
  profile: 'Your account',
  ...Object.fromEntries(NAV.map(([id, name]) => [id, name])),
};
labels.overview = 'Billing overview';
const descriptions = {
  overview: 'Subscriptions, invoices, and receivables',
  customers: 'Customer contacts and billing details',
  products: 'Products, prices, and variants',
  plans: 'Billing intervals and subscription policies',
  templates: 'Reusable plans and product lines for quotations',
  subscriptions: 'Contracts, billing dates, and lifecycle actions',
  invoices: 'Issued charges and outstanding balances',
  payments: 'Receipts recorded against customer invoices',
  reports: 'Invoiced revenue, cash received, and balances due',
  taxes: 'Tax rates, applicable products, and effective dates',
  discounts: 'Offers, eligibility, and redemption limits',
  staff: 'Staff accounts and access',
  outbox: 'Email queued in this development environment',
  profile: 'Your contact and billing details',
};
const moneyKeys = [
  'salesPrice',
  'costPrice',
  'price',
  'minAmount',
  'subtotal',
  'discountTotal',
  'taxTotal',
  'total',
  'amount',
  'balance',
  'paidAmount',
  'unitPrice',
];
const col = (key, label, format) => ({ key, label, format });
const COLUMNS = {
  customers: [
    col('name', 'Customer'),
    col('email', 'Email'),
    col('phone', 'Phone'),
    col('active', 'Status', 'active'),
  ],
  products: [
    col('name', 'Product'),
    col('type', 'Type'),
    col('salesPrice', 'Sales price', 'money'),
    col('variants', 'Variants', 'count'),
    col('active', 'Status', 'active'),
  ],
  plans: [
    col('name', 'Plan'),
    col('price', 'Base price', 'money'),
    col('interval', 'Billing interval'),
    col('minimumQuantity', 'Min. quantity'),
    col('active', 'Status', 'active'),
  ],
  templates: [
    col('name', 'Template'),
    col('planId', 'Plan', 'plan'),
    col('validityDays', 'Valid for', 'days'),
    col('paymentTerms', 'Payment terms', 'days'),
  ],
  subscriptions: [
    col('number', 'Subscription'),
    col('customerName', 'Customer'),
    col('planName', 'Plan'),
    col('status', 'Status', 'status'),
    col('nextBillingDate', 'Next billing', 'date'),
    col('expiryDate', 'Expiry', 'date'),
  ],
  invoices: [
    col('number', 'Invoice'),
    col('customerName', 'Customer'),
    col('status', 'Status', 'status'),
    col('dueDate', 'Due date', 'date'),
    col('total', 'Total', 'money'),
    col('balance', 'Balance', 'money'),
  ],
  payments: [
    col('invoiceNumber', 'Invoice'),
    col('method', 'Method'),
    col('date', 'Payment date', 'date'),
    col('amount', 'Amount', 'money'),
    col('status', 'Status', 'status'),
  ],
  taxes: [
    col('name', 'Tax rule'),
    col('rate', 'Rate', 'percent'),
    col('startDate', 'Starts', 'date'),
    col('endDate', 'Ends', 'date'),
    col('active', 'Status', 'active'),
  ],
  discounts: [
    col('name', 'Discount'),
    col('type', 'Type'),
    col('value', 'Value'),
    col('scope', 'Applies to'),
    col('usageCount', 'Used'),
    col('usageLimit', 'Usage limit'),
    col('active', 'Status', 'active'),
  ],
  staff: [
    col('name', 'Team member'),
    col('email', 'Email'),
    col('role', 'Role'),
    col('active', 'Status', 'active'),
  ],
  outbox: [
    col('to', 'Recipient'),
    col('subject', 'Subject'),
    col('status', 'Status', 'status'),
    col('createdAt', 'Created', 'date'),
  ],
};
const field = (name, label, type = 'text', extra = {}) => ({ name, label, type, ...extra });
const SCHEMAS = {
  customers: [
    field('name', 'Customer name', 'text', { required: true }),
    field('email', 'Email address', 'email', { required: true }),
    field('phone', 'Phone'),
    field('taxId', 'Tax identification'),
    field('address', 'Billing address', 'textarea'),
    field('active', 'Active customer', 'checkbox'),
  ],
  products: [
    field('name', 'Product name', 'text', { required: true }),
    field('type', 'Product type', 'text', { required: true }),
    field('salesPrice', 'Sales price', 'number', { required: true, min: 0, step: '.01' }),
    field('costPrice', 'Cost price', 'number', { required: true, min: 0, step: '.01' }),
    field('notes', 'Notes', 'textarea'),
    field('active', 'Available for new sales', 'checkbox'),
  ],
  plans: [
    field('name', 'Plan name', 'text', { required: true }),
    field('price', 'Recurring base fee', 'number', {
      required: true,
      min: 0,
      step: '.01',
      help: 'Added to product line charges. Use 0 when the lines contain the full price.',
    }),
    field('interval', 'Billing interval', 'select', {
      options: ['daily', 'weekly', 'monthly', 'yearly'],
    }),
    field('minimumQuantity', 'Minimum total quantity', 'number', {
      min: 1,
      step: 1,
      required: true,
    }),
    field('availableFrom', 'Available from', 'date'),
    field('availableTo', 'Available until', 'date'),
    field('autoClose', 'Close automatically at expiry', 'checkbox'),
    field('allowClose', 'Allow early closure', 'checkbox'),
    field('allowPause', 'Allow pausing', 'checkbox'),
    field('allowRenew', 'Allow renewal', 'checkbox'),
    field('active', 'Available for new sales', 'checkbox'),
  ],
  taxes: [
    field('name', 'Tax name', 'text', { required: true }),
    field('rate', 'Tax rate (%)', 'number', { min: 0, max: 100, step: '.01', required: true }),
    field('startDate', 'Effective from', 'date'),
    field('endDate', 'Effective until', 'date'),
    field('productIds', 'Applicable products', 'multi', {
      source: 'products',
      help: 'Leave empty to apply to all products.',
    }),
    field('active', 'Active tax rule', 'checkbox'),
  ],
  discounts: [
    field('name', 'Discount name', 'text', { required: true }),
    field('type', 'Discount type', 'select', { options: ['percentage', 'fixed'] }),
    field('value', 'Discount value', 'number', { min: 0, step: '.01', required: true }),
    field('scope', 'Discount scope', 'select', { options: ['subscription', 'product'] }),
    field('minAmount', 'Minimum purchase amount', 'number', { min: 0, step: '.01' }),
    field('minQuantity', 'Minimum quantity', 'number', { min: 0, step: 1 }),
    field('startDate', 'Starts on', 'date'),
    field('endDate', 'Expires on', 'date'),
    field('usageLimit', 'Maximum uses', 'number', {
      min: 1,
      step: 1,
      help: 'Leave empty for unlimited uses.',
    }),
    field('productIds', 'Applicable products', 'multi', { source: 'products' }),
    field('subscriptionIds', 'Applicable subscriptions', 'multi', {
      source: 'subscriptions',
      help: 'Leave empty for all eligible subscriptions.',
    }),
    field('active', 'Active discount', 'checkbox'),
  ],
  templates: [
    field('name', 'Template name', 'text', { required: true }),
    field('planId', 'Plan', 'reference', { source: 'plans', required: true }),
    field('validityDays', 'Quotation validity (days)', 'number', {
      required: true,
      min: 1,
      step: 1,
    }),
    field('paymentTerms', 'Payment due within (days)', 'number', {
      required: true,
      min: 0,
      step: 1,
    }),
    field('notes', 'Quotation notes', 'textarea'),
  ],
  subscriptions: [
    field('customerId', 'Customer', 'reference', { source: 'customers', required: true }),
    field('templateId', 'Start from a template', 'template', { source: 'templates' }),
    field('planId', 'Plan', 'reference', { source: 'plans', required: true }),
    field('startDate', 'Start date', 'date', { required: true }),
    field('expiryDate', 'Expiry date', 'date', { required: true }),
    field('paymentTerms', 'Payment due within (days)', 'number', {
      required: true,
      min: 0,
      step: 1,
    }),
    field('notes', 'Notes', 'textarea'),
  ],
  payments: [
    field('invoiceId', 'Invoice', 'reference', { source: 'invoices', required: true }),
    field('amount', 'Payment amount', 'number', { required: true, min: '.01', step: '.01' }),
    field('method', 'Payment method', 'select', {
      options: ['Bank transfer', 'Card', 'Cash', 'Cheque', 'Other'],
    }),
    field('date', 'Payment date', 'date', { required: true }),
    field('reference', 'Transaction reference'),
    field('note', 'Payment note', 'textarea'),
  ],
  staff: [
    field('name', 'Full name', 'text', { required: true }),
    field('email', 'Email address', 'email', { required: true }),
    field('password', 'Initial password', 'password', {
      required: true,
      minLength: 9,
      help: 'At least 9 characters, including uppercase, lowercase, and a special character.',
    }),
    field('active', 'Active team member', 'checkbox'),
  ],
};
const DEFAULTS = {
  customers: { active: true },
  products: { type: 'Software', salesPrice: 0, costPrice: 0, active: true, variants: [] },
  plans: {
    price: 0,
    interval: 'monthly',
    minimumQuantity: 1,
    autoClose: true,
    allowClose: true,
    allowPause: true,
    allowRenew: true,
    active: true,
  },
  taxes: { rate: 0, active: true, productIds: [] },
  discounts: {
    type: 'percentage',
    value: 10,
    scope: 'subscription',
    minAmount: 0,
    minQuantity: 0,
    active: true,
    productIds: [],
    subscriptionIds: [],
  },
  templates: { validityDays: 30, paymentTerms: 14, lines: [] },
  subscriptions: { startDate: today(), paymentTerms: 14, lines: [] },
  payments: { date: today(), method: 'Bank transfer' },
  staff: { active: true },
};

function Brand({ light = false }) {
  return (
    <div className={`brand ${light ? 'light' : ''}`}>
      <span className="brand-symbol">
        b<span />
      </span>
      <span>
        brightloop<span className="brand-sub">Billing</span>
      </span>
    </div>
  );
}
function Badge({ value }) {
  return (
    <span className={`badge badge-${String(value).toLowerCase().replace(/\s/g, '-')}`}>
      {value || '—'}
    </span>
  );
}
function Loading({ text = 'Loading your workspace…' }) {
  return (
    <div className="loading" role="status">
      <RefreshCw className="spin" size={22} />
      <span>{text}</span>
    </div>
  );
}
function Alert({ children, kind = 'error' }) {
  return children ? (
    <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  ) : null;
}
function Auth({ onLogin }) {
  const params = new URLSearchParams(location.search);
  const initial = location.pathname === '/reset-password' ? 'reset' : 'login';
  const [mode, setMode] = useState(initial),
    [form, setForm] = useState({
      name: '',
      email: '',
      password: '',
      token: params.get('token') || '',
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const change = (key, value) => setForm((p) => ({ ...p, [key]: value }));
  const switchMode = (next) => {
    setMode(next);
    setError('');
    setMessage('');
  };
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    if (['register', 'reset'].includes(mode) && !passwordValid(form.password)) {
      setError(
        'Use at least 9 characters with an uppercase letter, lowercase letter, and special character.',
      );
      return;
    }
    setBusy(true);
    try {
      const path = {
        login: 'login',
        register: 'register',
        forgot: 'forgot-password',
        reset: 'reset-password',
      }[mode];
      const body =
        mode === 'forgot'
          ? { email: form.email }
          : mode === 'reset'
            ? { token: form.token, password: form.password }
            : form;
      const result = await api(`/auth/${path}`, { method: 'POST', body });
      if (result.user) onLogin(result.user);
      else {
        setMessage(result.message || 'Request completed.');
        if (mode === 'reset') {
          setMode('login');
          history.replaceState({}, '', '/');
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-page">
      <aside className="auth-story">
        <Brand light />
        <div>
          <span className="context-label">Brightloop Software</span>
          <h1>
            From subscription
            <br />
            to settled invoice
          </h1>
          <p>Manage recurring contracts, issue invoices, and keep customer balances in view</p>
          <div className="story-cards">
            <div>
              <RefreshCw />
              <span>
                Subscriptions
                <br />
                <strong>Quote, activate, renew</strong>
              </span>
              <Check size={18} />
            </div>
            <div>
              <FileText />
              <span>
                Recurring billing
                <br />
                <strong>Scheduled invoices and taxes</strong>
              </span>
              <Check size={18} />
            </div>
            <div>
              <BarChart3 />
              <span>
                Receivables
                <br />
                <strong>Payments and outstanding balances</strong>
              </span>
              <Check size={18} />
            </div>
          </div>
        </div>
        <small>Built for Brightloop Software</small>
      </aside>
      <main className="auth-main">
        <div className="auth-mobile-brand">
          <Brand />
        </div>
        <form className="auth-card" onSubmit={submit}>
          <span className="context-label">Account access</span>
          <h2>
            {
              {
                login: 'Sign in to Brightloop',
                register: 'Create your account',
                forgot: 'Reset your password',
                reset: 'Choose a new password',
              }[mode]
            }
          </h2>
          <p>
            {
              {
                login: 'Access your subscriptions, invoices, and payments',
                register: 'View and manage your Brightloop subscriptions',
                forgot: 'We’ll email a reset link if an account exists',
                reset: 'Use a password you haven’t used before',
              }[mode]
            }
          </p>
          <Alert>{error}</Alert>
          <Alert kind="success">{message}</Alert>
          {mode === 'register' && (
            <label>
              Full name
              <input
                autoComplete="name"
                required
                value={form.name}
                onChange={(e) => change('name', e.target.value)}
              />
            </label>
          )}
          {mode !== 'reset' && (
            <label>
              Email address
              <input
                type="email"
                autoComplete="email"
                required
                value={form.email}
                onChange={(e) => change('email', e.target.value)}
                placeholder="you@company.com"
              />
            </label>
          )}
          {mode !== 'forgot' && (
            <label>
              Password
              <input
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={mode === 'login' ? undefined : 9}
                value={form.password}
                onChange={(e) => change('password', e.target.value)}
              />
              {mode !== 'login' && (
                <small>9+ characters, uppercase, lowercase, and a special character.</small>
              )}
            </label>
          )}
          {mode === 'login' && (
            <button
              className="text-button forgot"
              type="button"
              onClick={() => switchMode('forgot')}
            >
              Forgot password?
            </button>
          )}
          <button className="button primary full" disabled={busy}>
            {busy ? <RefreshCw className="spin" size={17} /> : <ArrowRight size={17} />}
            {
              {
                login: 'Sign in',
                register: 'Create account',
                forgot: 'Send reset link',
                reset: 'Update password',
              }[mode]
            }
          </button>
          <div className="auth-switch">
            {mode === 'login' ? (
              <>
                New to Brightloop?{' '}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => switchMode('register')}
                >
                  Create an account
                </button>
              </>
            ) : (
              <button type="button" className="text-button" onClick={() => switchMode('login')}>
                Back to sign in
              </button>
            )}
          </div>
        </form>
        <small className="auth-foot">Brightloop Software · Subscription management</small>
      </main>
    </div>
  );
}

function ReferenceInput({
  source,
  value,
  onChange,
  required = false,
  multiple = false,
  lookups = {},
}) {
  const [search, setSearch] = useState(''),
    [items, setItems] = useState(lookups[source] || []),
    [error, setError] = useState('');
  useEffect(() => {
    setItems(lookups[source] || []);
  }, [lookups, source]);
  useEffect(() => {
    if (!search) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      api(`/${source}?${query({ q: search, pageSize: 100 })}`, { signal: abort.signal })
        .then((r) => {
          setItems(r.items);
          setError('');
        })
        .catch((e) => {
          if (e.name !== 'AbortError') setError(e.message);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [search, source]);
  const selected = (multiple ? value || [] : [value]).filter(Boolean);
  const options = [...items];
  for (const id of selected) {
    if (!options.some((x) => x.id === id)) {
      const existing = (lookups[source] || []).find((x) => x.id === id);
      options.push(existing || { id, name: id });
    }
  }
  return (
    <div className="reference">
      <input
        aria-label={`Search ${source}`}
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search"
      />
      <select
        aria-label={`Select ${source}`}
        required={required}
        multiple={multiple}
        value={multiple ? value || [] : value || ''}
        onChange={(e) =>
          onChange(multiple ? Array.from(e.target.selectedOptions, (x) => x.value) : e.target.value)
        }
      >
        {!multiple && <option value="">Select {source.replace(/s$/, '')}</option>}
        {options.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name || x.number || x.email}
            {x.customerName ? ` · ${x.customerName}` : ''}
            {source === 'invoices' ? ` · ${money(x.balance, x.currency || 'INR')} due` : ''}
          </option>
        ))}
      </select>
      {multiple && (
        <small>Hold Ctrl / ⌘ to select multiple. Leave empty for all where applicable.</small>
      )}
      {error && <small className="field-error">{error}</small>}
    </div>
  );
}
function LineEditor({ lines, onChange, lookups }) {
  const [selectedProducts, setSelectedProducts] = useState({});
  useEffect(() => {
    let active = true;
    const missing = lines
      .map((l) => l.productId)
      .filter((id) => id && !lookups.products?.some((p) => p.id === id));
    Promise.all(
      [...new Set(missing)].map(async (id) => {
        try {
          return [id, await api('/products/' + id)];
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (active)
        setSelectedProducts((prev) => ({
          ...prev,
          ...Object.fromEntries(entries.filter(Boolean)),
        }));
    });
    return () => {
      active = false;
    };
  }, [lines.map((l) => l.productId).join(','), lookups.products]);
  const update = (i, key, value) =>
    onChange(lines.map((line, index) => (index === i ? { ...line, [key]: value } : line)));
  const chooseProduct = async (i, id) => {
    const p =
      lookups.products?.find((x) => x.id === id) ||
      (await api('/products/' + id).catch(() => null));
    if (p) setSelectedProducts((prev) => ({ ...prev, [id]: p }));
    onChange(
      lines.map((line, index) =>
        index === i
          ? { ...line, productId: id, variantId: '', unitPrice: p?.salesPrice ?? '', taxIds: [] }
          : line,
      ),
    );
  };
  return (
    <section className="line-editor">
      <div className="section-label">
        <div>
          <h3>Product lines</h3>
          <p>Unit prices exclude the selected variant’s surcharge.</p>
        </div>
        <button
          type="button"
          className="button secondary small"
          onClick={() =>
            onChange([
              ...lines,
              { productId: '', variantId: '', quantity: 1, unitPrice: '', taxIds: [] },
            ])
          }
        >
          <Plus size={15} />
          Add line
        </button>
      </div>
      {!lines.length && <div className="empty-mini">Add at least one product to this offer.</div>}
      {lines.map((line, i) => {
        const product =
          selectedProducts[line.productId] ||
          lookups.products?.find((x) => x.id === line.productId);
        return (
          <div className="line-card" key={i}>
            <div className="line-count">
              Line {i + 1}
              <button
                type="button"
                className="icon-button danger"
                aria-label={`Remove line ${i + 1}`}
                onClick={() => onChange(lines.filter((_, j) => i !== j))}
              >
                <Trash2 size={16} />
              </button>
            </div>
            <div className="line-fields">
              <label>
                Product
                <ReferenceInput
                  source="products"
                  value={line.productId}
                  onChange={(id) => chooseProduct(i, id)}
                  required
                  lookups={lookups}
                />
              </label>
              <label>
                Variant
                <select
                  value={line.variantId || ''}
                  onChange={(e) => update(i, 'variantId', e.target.value)}
                >
                  <option value="">Standard</option>
                  {product?.variants?.map((v) => (
                    <option value={v.id} key={v.id}>
                      {v.name} (+{money(v.priceAdjustment, 'INR')})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Quantity
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={line.quantity}
                  onChange={(e) => update(i, 'quantity', e.target.value)}
                />
              </label>
              <label>
                Base unit price
                <input
                  type="number"
                  min="0"
                  step=".01"
                  value={line.unitPrice ?? ''}
                  placeholder="Catalog price"
                  onChange={(e) => update(i, 'unitPrice', e.target.value)}
                />
              </label>
            </div>
            <label className="line-tax">
              Tax rules
              <select
                multiple
                value={line.taxIds || []}
                onChange={(e) =>
                  update(
                    i,
                    'taxIds',
                    Array.from(e.target.selectedOptions, (x) => x.value),
                  )
                }
              >
                {lookups.taxes?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.rate}%)
                  </option>
                ))}
              </select>
              <small>No selection uses applicable tax rules automatically.</small>
            </label>
          </div>
        );
      })}
    </section>
  );
}
function ResourceForm({ resource, item, lookups, onClose, onSave, isCustomer = false }) {
  const [form, setForm] = useState(() => ({
      ...structuredClone(DEFAULTS[resource] || {}),
      ...item,
      lines:
        item?.lines?.map((l) => ({
          ...l,
          unitPrice: Number(l.unitPrice) - Number(l.variantAdjustment || 0),
        })) || structuredClone(DEFAULTS[resource]?.lines || []),
    })),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const set = async (name, value) => {
    setForm((p) => ({ ...p, [name]: value }));
    if (name === 'templateId' && value) {
      const t =
        lookups.templates?.find((x) => x.id === value) ||
        (await api('/templates/' + value).catch((e) => {
          setError(e.message);
          return null;
        }));
      if (t)
        setForm((p) => ({
          ...p,
          planId: t.planId,
          paymentTerms: t.paymentTerms,
          notes: t.notes || '',
          lines: t.lines.map((l) => ({
            ...l,
            unitPrice: Number(l.unitPrice) - Number(l.variantAdjustment || 0),
          })),
        }));
    }
  };
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (resource === 'staff' && !item && !passwordValid(form.password || '')) {
      setError('Password needs 9+ characters, uppercase, lowercase, and a special character.');
      return;
    }
    if (['templates', 'subscriptions'].includes(resource) && !form.lines?.length) {
      setError('Add at least one product line.');
      return;
    }
    const body = {};
    for (const f of SCHEMAS[resource] || []) {
      if (isCustomer && resource === 'customers' && ['active', 'email'].includes(f.name)) continue;
      if (item && resource === 'staff' && ['email', 'password'].includes(f.name)) continue;
      const value = form[f.name];
      body[f.name] =
        f.type === 'number'
          ? value === '' || value == null
            ? f.name === 'usageLimit'
              ? null
              : 0
            : Number(value)
          : f.type === 'checkbox'
            ? Boolean(value)
            : ['date', 'template'].includes(f.type) && !value
              ? null
              : (value ?? '');
    }
    if (['templates', 'subscriptions'].includes(resource))
      body.lines = form.lines.map((l) => ({
        productId: l.productId,
        variantId: l.variantId || null,
        quantity: Number(l.quantity),
        ...(l.unitPrice !== '' && l.unitPrice != null ? { unitPrice: Number(l.unitPrice) } : {}),
        taxIds: l.taxIds || [],
      }));
    if (resource === 'products')
      body.variants = (form.variants || []).map((v) => ({
        ...v,
        priceAdjustment: Number(v.priceAdjustment || 0),
      }));
    setBusy(true);
    try {
      await api(`/${resource}${item ? '/' + item.id : ''}`, {
        method: item ? 'PATCH' : 'POST',
        body,
      });
      onSave();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`${item ? 'Edit' : 'New'} ${resource === 'staff' ? 'team member' : resource === 'templates' ? 'quotation template' : resource.replace(/ies$/, 'y').replace(/s$/, '')}`}
      subtitle="Changes are validated and saved securely to your workspace."
      onClose={onClose}
      wide={['templates', 'subscriptions', 'products'].includes(resource)}
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <Alert>{error}</Alert>
          <div className="form-grid">
            {SCHEMAS[resource]
              ?.filter(
                (f) =>
                  !(item && resource === 'staff' && ['email', 'password'].includes(f.name)) &&
                  !(isCustomer && resource === 'customers' && ['active', 'email'].includes(f.name)),
              )
              .map((f) => (
                <label
                  key={f.name}
                  className={`${f.type === 'textarea' ? 'span-two' : ''} ${f.type === 'checkbox' ? 'check-field' : ''}`}
                >
                  {f.type === 'checkbox' ? (
                    <>
                      <input
                        type="checkbox"
                        checked={Boolean(form[f.name])}
                        onChange={(e) => set(f.name, e.target.checked)}
                      />
                      <span>{f.label}</span>
                    </>
                  ) : (
                    <>
                      <span>
                        {f.label}
                        {f.required && <span className="required"> *</span>}
                      </span>
                      {['reference', 'multi', 'template'].includes(f.type) ? (
                        <ReferenceInput
                          source={f.source}
                          value={form[f.name]}
                          onChange={(v) => set(f.name, v)}
                          lookups={lookups}
                          required={f.required}
                          multiple={f.type === 'multi'}
                        />
                      ) : f.type === 'select' ? (
                        <select
                          value={form[f.name] || f.options[0]}
                          onChange={(e) => set(f.name, e.target.value)}
                        >
                          {f.options.map((o) => (
                            <option key={o} value={o}>
                              {o[0].toUpperCase() + o.slice(1)}
                            </option>
                          ))}
                        </select>
                      ) : f.type === 'textarea' ? (
                        <textarea
                          rows="3"
                          value={form[f.name] || ''}
                          onChange={(e) => set(f.name, e.target.value)}
                        />
                      ) : (
                        <input
                          type={f.type}
                          required={f.required}
                          min={f.min}
                          max={f.name === 'value' && form.type === 'percentage' ? 100 : f.max}
                          step={f.step}
                          minLength={f.minLength}
                          value={form[f.name] ?? ''}
                          onChange={(e) => set(f.name, e.target.value)}
                        />
                      )}{' '}
                      {f.help && <small>{f.help}</small>}
                    </>
                  )}
                </label>
              ))}
          </div>
          {resource === 'products' && (
            <section className="line-editor">
              <div className="section-label">
                <div>
                  <h3>Product variants</h3>
                  <p>Optional choices and their price adjustments.</p>
                </div>
                <button
                  className="button secondary small"
                  type="button"
                  onClick={() =>
                    set('variants', [...(form.variants || []), { name: '', priceAdjustment: 0 }])
                  }
                >
                  <Plus size={15} />
                  Add variant
                </button>
              </div>
              {form.variants?.map((v, i) => (
                <div className="variant-row" key={i}>
                  <label>
                    Variant name
                    <input
                      required
                      value={v.name}
                      onChange={(e) =>
                        set(
                          'variants',
                          form.variants.map((x, j) =>
                            i === j ? { ...x, name: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Price adjustment
                    <input
                      type="number"
                      min="0"
                      step=".01"
                      required
                      value={v.priceAdjustment}
                      onChange={(e) =>
                        set(
                          'variants',
                          form.variants.map((x, j) =>
                            i === j ? { ...x, priceAdjustment: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    className="icon-button danger"
                    type="button"
                    aria-label={`Remove variant ${i + 1}`}
                    onClick={() =>
                      set(
                        'variants',
                        form.variants.filter((_, j) => i !== j),
                      )
                    }
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              ))}
            </section>
          )}
          {['templates', 'subscriptions'].includes(resource) && (
            <LineEditor
              lines={form.lines || []}
              onChange={(v) => set('lines', v)}
              lookups={lookups}
            />
          )}
        </div>
        <footer className="modal-footer">
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? <RefreshCw size={16} className="spin" /> : <Check size={16} />}{' '}
            {item
              ? 'Save changes'
              : 'Create ' +
                (resource === 'staff' ? 'member' : resource.replace(/ies$/, 'y').replace(/s$/, ''))}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function Table({ resource, items, lookups, onSelect, compact = false, currency = 'INR' }) {
  let columns = COLUMNS[resource] || [];
  if (compact)
    columns = columns.filter((c) => !['customerName', 'periodStart'].includes(c.key)).slice(0, 5);
  const display = (row, c) => {
    const value = row[c.key];
    if (c.format === 'money') return money(value, row.currency || currency);
    if (c.format === 'date') return date(value);
    if (c.format === 'status') return <Badge value={value} />;
    if (c.format === 'active') return <Badge value={value ? 'Active' : 'Archived'} />;
    if (c.format === 'count') return `${value?.length || 0} variants`;
    if (c.format === 'percent') return `${value}%`;
    if (c.format === 'days') return `${value} days`;
    if (c.format === 'plan') return lookups?.plans?.find((x) => x.id === value)?.name || '—';
    return value === null || value === undefined || value === '' ? '—' : String(value);
  };
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.format === 'money' ? 'numeric' : undefined}>
                {c.label}
              </th>
            ))}
            {onSelect && (
              <th className="row-action">
                <span className="sr-only">Open details</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.id}>
              {columns.map((c, i) => (
                <td
                  key={c.key}
                  className={`${i === 0 ? 'primary-cell' : ''} ${c.format === 'money' ? 'numeric' : ''}`}
                >
                  {i === 0 && onSelect ? (
                    <button
                      className={`table-link ${c.key === 'number' ? 'invoice-reference' : ''}`}
                      onClick={() => onSelect(row)}
                    >
                      {display(row, c)}
                    </button>
                  ) : (
                    display(row, c)
                  )}
                </td>
              ))}
              {onSelect && (
                <td>
                  <button
                    className="icon-button"
                    aria-label={`View ${row.number || row.name || row.subject || 'record'}`}
                    onClick={() => onSelect(row)}
                  >
                    <ChevronRight size={16} />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Empty({ label, action }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Layers3 size={27} />
      </div>
      <h3>No {label.toLowerCase()} found</h3>
      <p>Try changing the filters or add your first record.</p>
      {action}
    </div>
  );
}

function Detail({ resource, item, user, lookups, onClose, onEdit, onChanged, notify }) {
  const [record, setRecord] = useState(item),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [renew, setRenew] = useState(false),
    [expiry, setExpiry] = useState(''),
    [confirmAction, setConfirmAction] = useState(null);
  useEffect(() => {
    if (!['outbox', 'staff', 'payments'].includes(resource))
      api(`/${resource}/${item.id}`)
        .then(setRecord)
        .catch((e) => setError(e.message));
  }, [resource, item.id]);
  const action = async (name, body = {}) => {
    setBusy(true);
    setError('');
    try {
      const result = await api(`/${resource}/${record.id}/${name}`, { method: 'POST', body });
      if (name === 'send') notify('Invoice email queued.');
      else if (name === 'invite') notify(result.message || 'Portal invitation queued.');
      else notify(`${name[0].toUpperCase() + name.slice(1)} completed.`);
      if (result.id) setRecord(result);
      else if (!['outbox', 'staff', 'payments'].includes(resource))
        setRecord(await api(`/${resource}/${record.id}`));
      setConfirmAction(null);
      setRenew(false);
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const internal = user.role !== 'customer',
    plan = record.planSnapshot || lookups.plans?.find((p) => p.id === record.planId);
  let actions = [];
  if (resource === 'subscriptions') {
    if (internal) {
      if (record.status === 'Draft') actions.push('quote');
      if (record.status === 'Quotation') actions.push('confirm');
      if (record.status === 'Confirmed') actions.push('activate');
    }
    if (record.status === 'Active' && plan?.allowPause !== false) actions.push('pause');
    if (record.status === 'Paused') actions.push('resume');
    if (['Active', 'Paused'].includes(record.status) && plan?.allowClose !== false)
      actions.push('close');
    if (['Active', 'Paused', 'Closed'].includes(record.status) && plan?.allowRenew !== false)
      actions.push('renew');
  }
  if (resource === 'invoices' && internal) {
    if (record.status === 'Draft') actions.push('confirm');
    if (['Draft', 'Confirmed'].includes(record.status) && !Number(record.paidAmount))
      actions.push('cancel');
    if (['Confirmed', 'Paid'].includes(record.status)) actions.push('send');
  }
  if (resource === 'payments' && internal && record.status !== 'Reversed') actions.push('reverse');
  if (resource === 'customers' && internal) actions.push('invite');
  const editable =
    SCHEMAS[resource] &&
    (internal
      ? !ADMIN_WRITE.includes(resource) || user.role === 'admin'
      : resource === 'customers') &&
    (!['payments', 'staff'].includes(resource) || resource === 'staff') &&
    (resource !== 'subscriptions' || record.status === 'Draft');
  const hidden = [
    'id',
    'lines',
    'variants',
    'customer',
    'discounts',
    'productIds',
    'subscriptionIds',
    'passwordHash',
    'password',
    'token',
    'html',
    'error',
  ];
  const print = () =>
    window.open(`${API_BASE}/invoices/${record.id}/print`, '_blank', 'noopener,noreferrer');
  return (
    <Modal
      title={record.number || record.name || record.subject || 'Record details'}
      subtitle={resource === 'invoices' ? `Invoice · ${date(record.issueDate)}` : labels[resource]}
      onClose={onClose}
      wide
    >
      <div className="detail-actions">
        {record.status && <Badge value={record.status} />}
        {record.status && <span className="action-spacer" />}
        {editable && (
          <button className="button secondary small" onClick={() => onEdit(record)}>
            <Settings2 size={15} />
            Edit
          </button>
        )}
        {resource === 'invoices' && (
          <button className="button secondary small" onClick={print}>
            <Download size={15} />
            Print / PDF
          </button>
        )}
        {actions.map((a) => (
          <button
            disabled={busy}
            className={`button small ${['cancel', 'close', 'reverse'].includes(a) ? 'danger-button' : 'secondary'}`}
            key={a}
            onClick={() =>
              a === 'renew'
                ? setRenew(true)
                : ['cancel', 'close', 'reverse', 'pause'].includes(a)
                  ? setConfirmAction(a)
                  : action(a)
            }
          >
            {a === 'invite' ? 'Invite to portal' : a[0].toUpperCase() + a.slice(1)}
          </button>
        ))}
      </div>
      <div className="modal-body">
        <Alert>{error}</Alert>
        {confirmAction && (
          <div className="confirm-panel">
            <h3>Confirm {confirmAction}</h3>
            <p>
              {confirmAction === 'close'
                ? 'This closes the subscription and stops future billing. Existing unpaid invoices remain due.'
                : confirmAction === 'cancel'
                  ? 'This invoice will be cancelled. Its billing period will not be billed again automatically.'
                  : confirmAction === 'reverse'
                    ? 'This reverses the payment and restores the invoice balance.'
                    : 'Any billing already due is completed before pausing. Billing then pauses from the next period. On resume, billing restarts at the next original calendar boundary; paused periods are skipped. Already issued invoices remain due.'}
            </p>
            <div className="button-row">
              <button
                className="button danger-button"
                disabled={busy}
                onClick={() => action(confirmAction)}
              >
                Confirm {confirmAction}
              </button>
              <button className="button secondary" onClick={() => setConfirmAction(null)}>
                Go back
              </button>
            </div>
          </div>
        )}
        {renew && (
          <form
            className="confirm-panel"
            onSubmit={(e) => {
              e.preventDefault();
              action('renew', { expiryDate: expiry });
            }}
          >
            <h3>Renew subscription</h3>
            <label>
              New expiry date
              <input
                type="date"
                min={today()}
                required
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
              />
            </label>
            <small>Choose a date aligned to the plan’s billing interval.</small>
            <div className="button-row">
              <button className="button primary" disabled={busy}>
                Renew
              </button>
              <button type="button" className="button secondary" onClick={() => setRenew(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
        {resource === 'invoices' && (
          <div className="invoice-summary">
            <div>
              <span>Total invoice</span>
              <strong>{money(record.total, record.currency || 'INR')}</strong>
            </div>
            <div>
              <span>Payments received</span>
              <strong>{money(record.paidAmount, record.currency || 'INR')}</strong>
            </div>
            <div>
              <span>Balance due</span>
              <strong>{money(record.balance, record.currency || 'INR')}</strong>
            </div>
          </div>
        )}
        <dl className="detail-grid">
          {Object.entries(record)
            .filter(
              ([k, v]) =>
                !hidden.includes(k) &&
                !k.endsWith('Id') &&
                !k.endsWith('Ids') &&
                typeof v !== 'object' &&
                v != null,
            )
            .map(([key, value]) => (
              <div key={key}>
                <dt>{key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}</dt>
                <dd>
                  {typeof value === 'boolean'
                    ? value
                      ? 'Yes'
                      : 'No'
                    : moneyKeys.includes(key)
                      ? money(value, record.currency || 'INR')
                      : key.endsWith('Date') || key.endsWith('At') || key === 'quotationValidUntil'
                        ? date(value)
                        : String(value)}
                </dd>
              </div>
            ))}
        </dl>
        {record.lines?.length > 0 && (
          <section className="detail-lines">
            <h3>Product lines</h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Product / description</th>
                    <th>Quantity</th>
                    <th>Unit price</th>
                    <th>Tax</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {record.lines.map((l, i) => (
                    <tr key={i}>
                      <td>
                        {l.description ||
                          l.productName ||
                          lookups.products?.find((p) => p.id === l.productId)?.name ||
                          'Product'}
                      </td>
                      <td>{l.quantity}</td>
                      <td>{money(l.unitPrice, record.currency || 'INR')}</td>
                      <td>
                        {l.tax != null
                          ? money(l.tax, record.currency || 'INR')
                          : (l.taxIds || [])
                              .map((id) => lookups.taxes?.find((t) => t.id === id)?.name)
                              .filter(Boolean)
                              .join(', ') || 'Automatic'}
                      </td>
                      <td>
                        {money(
                          l.total ?? Number(l.quantity) * Number(l.unitPrice),
                          record.currency || 'INR',
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        {record.variants?.length > 0 && (
          <section>
            <h3>Variants</h3>
            {record.variants.map((v) => (
              <div className="simple-row" key={v.id || v.name}>
                <span>{v.name}</span>
                <strong>+{money(v.priceAdjustment, 'INR')}</strong>
              </div>
            ))}
          </section>
        )}
        {resource === 'outbox' && (
          <section>
            <h3>Email preview</h3>
            <iframe
              title="Email message preview"
              className="email-preview"
              sandbox=""
              srcDoc={record.html}
            />
            {record.error && <Alert>{record.error}</Alert>}
          </section>
        )}
      </div>
      <footer className="modal-footer">
        <button className="button secondary" onClick={onClose}>
          Close
        </button>
      </footer>
    </Modal>
  );
}

function Dashboard({
  report,
  busy,
  error,
  user,
  onNavigate,
  onInvoice,
  filters,
  setFilters,
  lookups,
  refresh,
  reports = false,
}) {
  const currency = report?.currency || 'INR';
  const monthly = report?.monthlyRevenue || [];
  const status = report?.subscriptionBreakdown || [];
  const total = status.reduce((n, s) => n + s.count, 0);
  return (
    <>
      <div className="billing-context">
        <div>
          <span className="context-label">
            {reports ? 'Financial summary' : 'Subscription accounts'}
          </span>
          <h2>{reports ? 'Revenue and collections' : 'Billing at a glance'}</h2>
          <p>
            {reports
              ? 'Revenue and receipts use the selected dates; receivables show current balances'
              : 'Review active contracts, recent invoices, and overdue accounts'}
          </p>
        </div>
        <button className="button secondary" onClick={refresh}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>
      <div className="filter-strip">
        <span>
          <CalendarDays size={16} />
          Reporting period
        </span>
        <label className="sr-only" htmlFor="report-from">
          From date
        </label>
        <input
          id="report-from"
          aria-label="From date"
          type="date"
          value={filters.from}
          onChange={(e) => setFilters((p) => ({ ...p, from: e.target.value }))}
        />
        <span>to</span>
        <label className="sr-only" htmlFor="report-to">
          To date
        </label>
        <input
          id="report-to"
          aria-label="To date"
          type="date"
          value={filters.to}
          onChange={(e) => setFilters((p) => ({ ...p, to: e.target.value }))}
        />
        {user.role !== 'customer' && (
          <select
            aria-label="Filter by customer"
            value={filters.customerId}
            onChange={(e) => setFilters((p) => ({ ...p, customerId: e.target.value }))}
          >
            <option value="">All customers</option>
            {lookups.customers?.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Filter by plan"
          value={filters.planId}
          onChange={(e) => setFilters((p) => ({ ...p, planId: e.target.value }))}
        >
          <option value="">All plans</option>
          {lookups.plans?.map((p) => (
            <option value={p.id} key={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {(filters.from || filters.to || filters.customerId || filters.planId) && (
          <button
            className="text-button"
            onClick={() => setFilters({ from: '', to: '', customerId: '', planId: '' })}
          >
            Reset
          </button>
        )}
      </div>
      <Alert>{error}</Alert>
      {busy && !report ? (
        <Loading />
      ) : (
        report && (
          <>
            <div className="kpi-grid">
              {[
                ['Active subscriptions', report.activeSubscriptions, 'subscriptions'],
                ['Invoiced revenue', money(report.invoicedRevenue, currency), 'invoices'],
                ['Payments received', money(report.paymentsReceived, currency), 'payments'],
                ['Outstanding balance', money(report.outstanding, currency), 'invoices'],
              ].map(([label, value, target]) => (
                <button className="kpi-card" key={label} onClick={() => onNavigate(target)}>
                  <div className="kpi-top">
                    <span>{label}</span>
                  </div>
                  <strong>{value ?? 0}</strong>
                  <div className="kpi-foot">
                    <span>
                      {label === 'Active subscriptions'
                        ? `${report.totalSubscriptions} total subscriptions`
                        : label === 'Invoiced revenue'
                          ? 'Excludes tax · confirmed invoices'
                          : label === 'Payments received'
                            ? 'Recorded receipts less reversals'
                            : `${report.overdueCount} overdue invoices`}
                    </span>
                  </div>
                </button>
              ))}
            </div>
            <div className="dashboard-grid">
              <section className="panel revenue-panel">
                <header className="panel-header">
                  <div>
                    <h3>Revenue overview</h3>
                    <p>Invoiced revenue compared with cash received</p>
                  </div>
                  <span className="chart-legend">
                    <i />
                    Invoiced <i />
                    Collected
                  </span>
                </header>
                {monthly.length ? (
                  <RevenueChart monthly={monthly} currency={currency} />
                ) : (
                  <div className="empty-chart">
                    <BarChart3 size={34} />
                    <p>No invoiced revenue or payments for this period</p>
                  </div>
                )}
                <footer className="panel-foot">
                  <span>Monthly recurring revenue</span>
                  <strong>{money(report.mrr, currency)}</strong>
                </footer>
              </section>
              <section className="panel subscription-panel">
                <header className="panel-header">
                  <div>
                    <h3>Subscription health</h3>
                    <p>Current lifecycle breakdown</p>
                  </div>
                  <RefreshCw size={18} />
                </header>
                <div className="subscription-total">
                  <span>Total subscriptions</span>
                  <strong>{total}</strong>
                </div>
                <div className="status-bars">
                  {status.length ? (
                    status.map((s) => (
                      <div key={s.status}>
                        <div>
                          <span>
                            <i className={`status-dot status-${s.status.toLowerCase()}`} />
                            {s.status}
                          </span>
                          <strong>{s.count}</strong>
                        </div>
                        <div className="track">
                          <span
                            className={`fill-${s.status.toLowerCase()}`}
                            style={{ width: `${total ? (s.count / total) * 100 : 0}%` }}
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="muted">No subscriptions in this selection</p>
                  )}
                </div>
                <button className="panel-link" onClick={() => onNavigate('subscriptions')}>
                  View all subscriptions
                  <ArrowRight size={15} />
                </button>
              </section>
            </div>
            <div className="dashboard-grid lower">
              <section className="panel">
                <header className="panel-header">
                  <div>
                    <h3>Recent invoices</h3>
                    <p>Open an invoice to review its lines and balance</p>
                  </div>
                  <button className="text-button" onClick={() => onNavigate('invoices')}>
                    View all
                    <ArrowRight size={14} />
                  </button>
                </header>
                {report.recentInvoices?.length ? (
                  <Table
                    resource="invoices"
                    items={report.recentInvoices}
                    onSelect={onInvoice}
                    compact
                    currency={currency}
                  />
                ) : (
                  <Empty label="invoices" />
                )}
              </section>
              <section className="panel receivables-panel">
                <header className="panel-header">
                  <div>
                    <h3>Overdue accounts</h3>
                    <p>Confirmed invoices past their due dates</p>
                  </div>
                  <Bell size={18} />
                </header>
                <span className="overdue-label">Overdue receivables</span>
                <strong className="overdue-value">{money(report.overdueAmount, currency)}</strong>
                <span className="muted">
                  Across {report.overdueCount} unpaid{' '}
                  {report.overdueCount === 1 ? 'invoice' : 'invoices'}
                </span>
                <div className="attention-list">
                  {report.overdueInvoices?.slice(0, 4).map((i) => (
                    <button key={i.id} onClick={() => onInvoice(i)}>
                      <span>
                        {i.number}
                        <small>{i.customerName}</small>
                      </span>
                      <strong>{money(i.balance, currency)}</strong>
                    </button>
                  ))}
                </div>
                <button className="button secondary full" onClick={() => onNavigate('invoices')}>
                  Review invoices
                  <ArrowRight size={15} />
                </button>
              </section>
            </div>
          </>
        )
      )}
    </>
  );
}

export default function App() {
  const [user, setUser] = useState(null),
    [boot, setBoot] = useState(true),
    [page, setPage] = useState('overview'),
    [mobile, setMobile] = useState(false),
    [lookups, setLookups] = useState({}),
    [data, setData] = useState({ items: [], total: 0, page: 1, pageSize: 15 }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState(''),
    [pageNo, setPageNo] = useState(1),
    [version, setVersion] = useState(0),
    [form, setForm] = useState(null),
    [detail, setDetail] = useState(null),
    [toast, setToast] = useState(''),
    [report, setReport] = useState(null),
    [reportFilters, setReportFilters] = useState({ from: '', to: '', customerId: '', planId: '' }),
    [billingBusy, setBillingBusy] = useState(false),
    [currency, setCurrency] = useState('INR');
  const notify = (text) => {
    setToast(text);
  };
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    api('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => {})
      .finally(() => setBoot(false));
  }, []);
  const refresh = () => setVersion((v) => v + 1);
  useEffect(() => {
    if (!user) return;
    let active = true;
    const sources =
      user.role === 'customer'
        ? ['plans', 'customers']
        : ['products', 'plans', 'taxes', 'customers', 'templates', 'subscriptions', 'invoices'];
    Promise.all(
      sources.map(async (key) => {
        try {
          const r = await api(`/${key}?pageSize=100`);
          return [key, r.items];
        } catch {
          return [key, []];
        }
      }),
    ).then((entries) => {
      if (active) setLookups(Object.fromEntries(entries));
    });
    return () => {
      active = false;
    };
  }, [user, version]);
  useEffect(() => {
    if (!user) return;
    const abort = new AbortController();
    setError('');
    setBusy(true);
    const t = setTimeout(
      async () => {
        try {
          if (['overview', 'reports'].includes(page)) {
            const r = await api(`/reports/summary?${query(reportFilters)}`, {
              signal: abort.signal,
            });
            setReport(r);
            setCurrency(r.currency || 'INR');
          } else if (page === 'profile') {
            const r = await api('/customers?pageSize=1', { signal: abort.signal });
            setData(r);
          } else {
            const r = await api(
              `/${page}?${query({ q: search, status: filter, page: pageNo, pageSize: 15 })}`,
              { signal: abort.signal },
            );
            setData(r);
          }
        } catch (e) {
          if (e.name !== 'AbortError') {
            setError(e.message);
            if (e.status === 401) setUser(null);
          }
        } finally {
          if (!abort.signal.aborted) setBusy(false);
        }
      },
      search ? 250 : 0,
    );
    return () => {
      clearTimeout(t);
      abort.abort();
    };
  }, [user, page, search, filter, pageNo, version, reportFilters]);
  const navigate = (next) => {
    setPage(next);
    setPageNo(1);
    setSearch('');
    setFilter('');
    setError('');
    setMobile(false);
  };
  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST', body: {} });
      setUser(null);
      setReport(null);
      setLookups({});
      navigate('overview');
    } catch (e) {
      notify(e.message);
    }
  };
  const canCreate =
    user &&
    SCHEMAS[page] &&
    user.role !== 'customer' &&
    (!ADMIN_WRITE.includes(page) || user.role === 'admin');
  const runBilling = async () => {
    setBillingBusy(true);
    try {
      const result = await api('/billing/run', { method: 'POST', body: {} });
      notify(
        `Billing complete: ${result.created} invoices created${result.errors?.length ? `; ${result.errors.length} need attention` : '.'}`,
      );
      if (result.errors?.length)
        setError(
          result.errors
            .map((e) => (typeof e === 'string' ? e : e.error || e.message || JSON.stringify(e)))
            .join(' · '),
        );
      refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBillingBusy(false);
    }
  };
  if (boot)
    return (
      <div className="boot">
        <Brand />
        <Loading />
      </div>
    );
  if (!user)
    return (
      <Auth
        onLogin={(u) => {
          setUser(u);
          navigate('overview');
        }}
      />
    );
  const navItems = NAV.filter(([id]) => id !== 'outbox' || import.meta.env.DEV).filter(([id]) =>
    user.role === 'customer'
      ? CUSTOMER_NAV.includes(id)
      : !ADMIN_ONLY.includes(id) || user.role === 'admin',
  );
  return (
    <div className="app-shell">
      {mobile && (
        <button
          className="mobile-shade"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? 'open' : ''}`}>
        <Brand />
        <div className="workspace-switch">
          <span className="workspace-avatar">B</span>
          <div>
            <strong>Brightloop Software</strong>
            <small>{user.role === 'customer' ? 'Customer portal' : 'Organization workspace'}</small>
          </div>
        </div>
        <nav id="workspace-navigation" aria-label="Main navigation">
          {navItems.map(([id, label, Icon]) => (
            <React.Fragment key={id}>
              {id === 'customers' && <span className="nav-section">Workspace</span>}
              {id === 'taxes' && <span className="nav-section">Configuration</span>}
              <button
                className={page === id ? 'selected' : ''}
                aria-current={page === id ? 'page' : undefined}
                onClick={() => navigate(id)}
              >
                <Icon size={18} />
                <span>{label}</span>
                {page === id && <span className="nav-active-dot" />}
              </button>
            </React.Fragment>
          ))}
          {user.role === 'customer' && (
            <button
              className={page === 'profile' ? 'selected' : ''}
              aria-current={page === 'profile' ? 'page' : undefined}
              onClick={() => navigate('profile')}
            >
              <Building2 size={18} />
              <span>Your account</span>
            </button>
          )}
        </nav>
        <div className="sidebar-bottom">
          <button className="user-button" aria-label="Sign out" onClick={logout}>
            <span className="avatar">{initials(user.name)}</span>
            <span>
              <strong>{user.name}</strong>
              <small>{user.role}</small>
            </span>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              aria-expanded={mobile}
              aria-controls="workspace-navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb">Workspace</span>
            <ChevronRight size={14} />
            <strong>{labels[page]}</strong>
          </div>
          <div className="topbar-right">
            <span className="workspace-date">
              <CalendarDays size={15} />
              {date(today())}
            </span>
            <span className="role-label">
              {user.role === 'customer' ? 'Customer portal' : 'Organization'}
            </span>
            <span className="avatar small">{initials(user.name)}</span>
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <h1>{labels[page]}</h1>
              <p>{descriptions[page]}</p>
            </div>
            <div className="button-row">
              {['overview', 'subscriptions', 'invoices'].includes(page) &&
                user.role !== 'customer' && (
                  <button className="button secondary" onClick={runBilling} disabled={billingBusy}>
                    <RefreshCw size={16} className={billingBusy ? 'spin' : ''} />
                    {billingBusy ? 'Running billing…' : 'Run billing'}
                  </button>
                )}
              {canCreate && (
                <button
                  className="button primary"
                  onClick={() => setForm({ resource: page, item: null })}
                >
                  <Plus size={17} />
                  New{' '}
                  {page === 'staff'
                    ? 'member'
                    : page === 'templates'
                      ? 'template'
                      : page.replace(/ies$/, 'y').replace(/s$/, '')}
                </button>
              )}
            </div>
          </div>
          {['overview', 'reports'].includes(page) ? (
            <Dashboard
              report={report}
              busy={busy}
              error={error}
              user={user}
              onNavigate={navigate}
              onInvoice={(item) => setDetail({ resource: 'invoices', item })}
              filters={reportFilters}
              setFilters={setReportFilters}
              lookups={lookups}
              refresh={refresh}
              reports={page === 'reports'}
            />
          ) : page === 'profile' ? (
            <section className="panel profile-panel">
              <Alert>{error}</Alert>
              {busy ? (
                <Loading />
              ) : data.items[0] ? (
                <>
                  <div className="profile-header">
                    <span className="avatar large">{initials(data.items[0].name)}</span>
                    <div>
                      <h2>{data.items[0].name}</h2>
                      <p>{user.email}</p>
                    </div>
                    <button
                      className="button secondary"
                      onClick={() => setForm({ resource: 'customers', item: data.items[0] })}
                    >
                      Edit profile
                    </button>
                  </div>
                  <dl className="detail-grid">
                    {['email', 'phone', 'address', 'taxId'].map((k) => (
                      <div key={k}>
                        <dt>
                          {k === 'taxId' ? 'Tax identification' : k[0].toUpperCase() + k.slice(1)}
                        </dt>
                        <dd>{data.items[0][k] || 'Not provided'}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              ) : (
                <Empty label="customer profile" />
              )}
            </section>
          ) : (
            <section className="panel resource-panel">
              <div className="list-toolbar">
                <div className="search-field">
                  <Search size={17} />
                  <input
                    aria-label={`Search ${labels[page].toLowerCase()}`}
                    placeholder="Search"
                    type="search"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPageNo(1);
                    }}
                  />
                </div>
                <div className="list-filters">
                  {['subscriptions', 'invoices', 'payments'].includes(page) && (
                    <select
                      aria-label="Filter by status"
                      value={filter}
                      onChange={(e) => {
                        setFilter(e.target.value);
                        setPageNo(1);
                      }}
                    >
                      <option value="">All statuses</option>
                      {(page === 'subscriptions'
                        ? ['Draft', 'Quotation', 'Confirmed', 'Active', 'Paused', 'Closed']
                        : page === 'invoices'
                          ? ['Draft', 'Confirmed', 'Paid', 'Cancelled', 'Overdue']
                          : ['Recorded', 'Reversed']
                      ).map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  )}
                  <button className="icon-button" aria-label="Refresh list" onClick={refresh}>
                    <RefreshCw size={17} />
                  </button>
                  <span className="record-count">{data.total} records</span>
                </div>
              </div>
              <Alert>{error}</Alert>
              {busy ? (
                <Loading text={`Loading ${labels[page].toLowerCase()}…`} />
              ) : error ? null : data.items.length ? (
                <Table
                  resource={page}
                  items={data.items}
                  lookups={lookups}
                  onSelect={(item) => setDetail({ resource: page, item })}
                  currency={currency}
                />
              ) : (
                <Empty
                  label={labels[page]}
                  action={
                    canCreate ? (
                      <button
                        className="button primary"
                        onClick={() => setForm({ resource: page, item: null })}
                      >
                        <Plus size={16} />
                        Create first record
                      </button>
                    ) : null
                  }
                />
              )}
              <footer className="pagination">
                <span>
                  {data.total
                    ? `${(pageNo - 1) * 15 + 1}–${Math.min(pageNo * 15, data.total)} of ${data.total}`
                    : '0 records'}
                </span>
                <div>
                  <button
                    className="icon-button"
                    aria-label="Previous page"
                    disabled={pageNo === 1 || busy}
                    onClick={() => setPageNo((p) => p - 1)}
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <span>
                    Page {pageNo} of {Math.max(1, Math.ceil(data.total / 15))}
                  </span>
                  <button
                    className="icon-button"
                    aria-label="Next page"
                    disabled={pageNo * 15 >= data.total || busy}
                    onClick={() => setPageNo((p) => p + 1)}
                  >
                    <ChevronRight size={17} />
                  </button>
                </div>
              </footer>
            </section>
          )}
          <footer className="workspace-footer">
            <span>Brightloop Software</span>
            <span>Subscription management</span>
          </footer>
        </main>
      </div>
      {form && (
        <ResourceForm
          resource={form.resource}
          item={form.item}
          lookups={lookups}
          isCustomer={user.role === 'customer'}
          onClose={() => setForm(null)}
          onSave={() => {
            setForm(null);
            setDetail(null);
            refresh();
            notify('Saved successfully.');
          }}
        />
      )}
      {detail && !form && (
        <Detail
          resource={detail.resource}
          item={detail.item}
          user={user}
          lookups={lookups}
          onClose={() => setDetail(null)}
          onEdit={(item) => setForm({ resource: detail.resource, item })}
          onChanged={refresh}
          notify={notify}
        />
      )}{' '}
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast('')}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
