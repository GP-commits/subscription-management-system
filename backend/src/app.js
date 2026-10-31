import express from 'express';
import Decimal from 'decimal.js';
import { openDatabase, id, record, transaction, nextNumber, audit } from './db.js';
import {
  HttpError,
  assert,
  email,
  text,
  number,
  cents,
  money,
  round,
  date,
  dateOnly,
  addDays,
  nextPeriod,
  normalizeLines,
  passwordHash,
  verifyPassword,
  hashToken,
  token,
  escapeHtml,
} from './domain.js';
import {
  runBilling,
  subscriptionObject,
  invoiceObject,
  paymentObject,
  saveSubscription,
  confirmInvoice,
  cancelInvoice,
  invoiceHtml,
} from './billing.js';
import { createMailer, queueEmail } from './mail.js';

const catalogResources = ['products', 'plans', 'taxes', 'discounts', 'templates'];
const simpleResources = ['customers', ...catalogResources];
const optionalString = (v, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : '');
function boolean(v, fallback = true) {
  return v === undefined ? fallback : v === true || v === 1;
}
function identifiers(v, label) {
  assert(
    Array.isArray(v ?? []) && (v ?? []).every((x) => typeof x === 'string'),
    `${label} must be a list of IDs.`,
  );
  return [...new Set(v ?? [])];
}
function validateRefs(db, table, ids) {
  for (const ref of ids) assert(record(db, table, ref), `Unknown ${table} reference.`);
}
function datesValid(a, b) {
  assert(!a || !b || a <= b, 'End date must not precede start date.');
}
function userObject(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    customerId: row.customer_id,
    active: !!row.active,
  };
}

export async function createApp(options = {}) {
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const proxySetting = options.trustProxy ?? process.env.TRUST_PROXY ?? '0';
  if (![false, 0, 1, '0', '1', 'false'].includes(proxySetting))
    throw new Error(
      'TRUST_PROXY must be 0 (direct access) or 1 (exactly one trusted reverse proxy).',
    );
  const db = openDatabase(
    options.dbPath ?? process.env.DATABASE_PATH ?? './data/brightloop.sqlite',
  );
  const now = options.now ?? (() => new Date());
  const today = () => dateOnly(now());
  const currency = options.currency ?? process.env.CURRENCY ?? 'INR';
  const frontendUrl = options.frontendUrl ?? process.env.FRONTEND_URL ?? 'http://localhost:5173';
  const allowedOrigin = new URL(frontendUrl).origin;
  const mailer = createMailer(db, {
    production,
    smtp: options.smtp ?? {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      user: process.env.SMTP_USER,
      password: process.env.SMTP_PASSWORD,
    },
    from: options.mailFrom ?? process.env.MAIL_FROM,
  });
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', proxySetting === 1 || proxySetting === '1' ? 1 : false);
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Cache-Control': 'no-store',
    });
    if (production) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const origin = req.headers.origin;
    if (origin === allowedOrigin)
      res.set({
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        Vary: 'Origin',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
      });
    if (req.method === 'OPTIONS') return res.sendStatus(origin === allowedOrigin ? 204 : 403);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin && origin !== allowedOrigin)
      return res.status(403).json({ error: 'Request origin is not allowed.' });
    next();
  });
  app.use(express.json({ limit: '256kb' }));
  app.use((req, res, next) => {
    req.body ??= {};
    next();
  });
  const limits = new Map();
  function rateLimit(req, res, next) {
    if (options.disableRateLimit) return next();
    const key = `${req.ip}:${req.path}`,
      timestamp = now().getTime();
    if (limits.size > 10000)
      for (const [k, v] of limits) if (v.until <= timestamp) limits.delete(k);
    const entry = limits.get(key);
    if (!entry || entry.until <= timestamp)
      limits.set(key, { count: 1, until: timestamp + 15 * 60000 });
    else if (++entry.count > 30)
      return res.status(429).json({ error: 'Too many attempts. Please try again in 15 minutes.' });
    next();
  }
  const cookieOptions = { httpOnly: true, secure: production, sameSite: 'lax', path: '/' };
  function startSession(res, userId) {
    const raw = token(),
      expires = new Date(now().getTime() + 7 * 86400000);
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(
      hashToken(raw),
      userId,
      expires.toISOString(),
    );
    res.cookie('brightloop_session', raw, { ...cookieOptions, maxAge: 7 * 86400000 });
  }
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.post('/api/auth/register', rateLimit, async (req, res) => {
    const name = text(req.body.name, 'Name'),
      address = email(req.body.email),
      hash = await passwordHash(req.body.password);
    assert(
      !db.prepare('SELECT id FROM users WHERE email=?').get(address),
      'An account with this email already exists.',
      409,
    );
    assert(
      !db
        .prepare("SELECT id FROM customers WHERE LOWER(json_extract(data,'$.email'))=?")
        .get(address),
      'A billing profile already exists. Ask your Brightloop contact to send a portal invitation.',
      409,
    );
    const user = transaction(db, () => {
      const customerId = id(),
        userId = id();
      db.prepare('INSERT INTO customers VALUES(?,?)').run(
        customerId,
        JSON.stringify({
          name,
          email: address,
          phone: '',
          address: '',
          taxId: '',
          active: true,
          createdAt: now().toISOString(),
        }),
      );
      db.prepare(
        "INSERT INTO users(id,email,name,password_hash,role,customer_id) VALUES(?,?,?,?,'customer',?)",
      ).run(userId, address, name, hash, customerId);
      audit(db, { id: userId }, 'customer.registered', customerId, {}, now());
      return userObject(db.prepare('SELECT * FROM users WHERE id=?').get(userId));
    });
    startSession(res, user.id);
    res.status(201).json({ user });
  });
  app.post('/api/auth/login', rateLimit, async (req, res) => {
    const address = email(req.body.email),
      user = db.prepare('SELECT * FROM users WHERE email=?').get(address);
    assert(
      user && user.active && (await verifyPassword(req.body.password, user.password_hash)),
      'Email or password is incorrect.',
      401,
    );
    startSession(res, user.id);
    res.json({ user: userObject(user) });
  });
  app.post('/api/auth/forgot-password', rateLimit, (req, res) => {
    const address = email(req.body.email),
      user = db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(address);
    if (user) {
      const raw = token();
      transaction(db, () => {
        db.prepare('DELETE FROM reset_tokens WHERE user_id=?').run(user.id);
        db.prepare('INSERT INTO reset_tokens VALUES(?,?,?)').run(
          hashToken(raw),
          user.id,
          new Date(now().getTime() + 30 * 60000).toISOString(),
        );
        const link = `${frontendUrl.replace(/\/$/, '')}/reset-password?token=${raw}`;
        queueEmail(
          db,
          user.email,
          'Reset your Brightloop password',
          `<p>Hello ${escapeHtml(user.name)},</p><p><a href="${escapeHtml(link)}">Reset your password</a>. This single-use link expires in 30 minutes.</p><p>If you did not request this, ignore this email.</p>`,
          now(),
        );
      });
      void mailer.flush();
    }
    res.json({ message: 'If an active account exists, a password reset link has been sent.' });
  });
  app.post('/api/auth/reset-password', rateLimit, async (req, res) => {
    assert(
      typeof req.body.token === 'string' && req.body.token.length === 64,
      'Invalid or expired reset link.',
    );
    const hash = await passwordHash(req.body.password);
    transaction(db, () => {
      const reset = db
        .prepare('SELECT * FROM reset_tokens WHERE token_hash=? AND expires_at>?')
        .get(hashToken(req.body.token), now().toISOString());
      assert(reset, 'Invalid or expired reset link.');
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, reset.user_id);
      db.prepare('DELETE FROM reset_tokens WHERE user_id=?').run(reset.user_id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(reset.user_id);
    });
    res
      .clearCookie('brightloop_session', cookieOptions)
      .json({ message: 'Password updated. Sign in with your new password.' });
  });
  app.use('/api', (req, res, next) => {
    const raw = (req.headers.cookie || '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('brightloop_session='))
      ?.split('=')[1];
    const row =
      raw &&
      db
        .prepare(
          'SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>? AND users.active=1',
        )
        .get(hashToken(raw), now().toISOString());
    if (!row) return res.status(401).json({ error: 'Please sign in.' });
    req.user = userObject(row);
    req.sessionToken = raw;
    next();
  });
  app.get('/api/auth/me', (req, res) => res.json({ user: req.user }));
  app.post('/api/auth/logout', (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(req.sessionToken));
    res.clearCookie('brightloop_session', cookieOptions).json({ ok: true });
  });
  const admin = (req, res, next) => {
    assert(req.user.role === 'admin', 'Administrator access is required.', 403);
    next();
  };
  const internal = (req, res, next) => {
    assert(req.user.role !== 'customer', 'Staff access is required.', 403);
    next();
  };
  function own(req, customerId) {
    assert(
      req.user.role !== 'customer' || req.user.customerId === customerId,
      'Record not found.',
      404,
    );
  }
  function paginate(
    req,
    table,
    { customerColumn = null, statusColumn = null, dateColumn = null, extra = [], params = [] } = {},
  ) {
    const page = number(req.query.page ?? 1, 'Page', { min: 1, max: 100000, integer: true }),
      pageSize = number(req.query.pageSize ?? 25, 'Page size', { min: 1, max: 100, integer: true });
    const clauses = [...extra],
      values = [...params];
    if (customerColumn && req.user.role === 'customer') {
      clauses.push(`${customerColumn}=?`);
      values.push(req.user.customerId);
    } else if (customerColumn && req.query.customerId) {
      clauses.push(`${customerColumn}=?`);
      values.push(req.query.customerId);
    }
    if (req.query.q) {
      clauses.push('LOWER(data) LIKE ?');
      values.push(
        `%${String(req.query.q)
          .toLowerCase()
          .replace(/[\\%_]/g, '\\$&')}%`,
      );
      clauses[clauses.length - 1] += " ESCAPE '\\'";
    }
    if (statusColumn && req.query.status) {
      clauses.push(`${statusColumn}=?`);
      values.push(req.query.status);
    }
    if (dateColumn && req.query.from) {
      clauses.push(`${dateColumn}>=?`);
      values.push(date(req.query.from));
    }
    if (dateColumn && req.query.to) {
      clauses.push(`${dateColumn}<=?`);
      values.push(date(req.query.to));
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS total FROM ${table}${where}`).get(...values).total;
    const items = db
      .prepare(`SELECT * FROM ${table}${where} ORDER BY rowid DESC LIMIT ? OFFSET ?`)
      .all(...values, pageSize, (page - 1) * pageSize);
    return { items, total, page, pageSize };
  }
  function catalogObject(table, row, user) {
    const data = { ...JSON.parse(row.data), id: row.id };
    if (table === 'discounts')
      Object.assign(data, { usageCount: row.usage_count, reservedCount: row.reserved_count });
    if (table === 'products' && user.role === 'customer') delete data.costPrice;
    return data;
  }
  function normalizeResource(table, input, existing = {}) {
    const b = { ...existing, ...input };
    if (table === 'customers')
      return {
        name: text(b.name, 'Customer name'),
        email: email(b.email),
        phone: optionalString(b.phone, 60),
        address: optionalString(b.address, 1000),
        taxId: optionalString(b.taxId, 100),
        active: boolean(b.active),
        createdAt: existing.createdAt ?? now().toISOString(),
      };
    const common = {
      name: text(b.name, 'Name'),
      active: boolean(b.active),
      createdAt: existing.createdAt ?? now().toISOString(),
    };
    if (table === 'products') {
      assert(
        Array.isArray(b.variants ?? []) && (b.variants ?? []).length <= 100,
        'Variants must be an array of at most 100 choices.',
      );
      const variants = (b.variants ?? []).map((v) => ({
        id: typeof v.id === 'string' ? v.id : id(),
        name: text(v.name, 'Variant name'),
        priceAdjustment: round(
          number(v.priceAdjustment ?? 0, 'Variant adjustment', { min: -100000000 }),
        ),
      }));
      assert(
        new Set(variants.map((v) => v.id)).size === variants.length,
        'Variant IDs must be unique.',
      );
      return {
        ...common,
        type: text(b.type ?? 'Service', 'Product type'),
        salesPrice: round(number(b.salesPrice, 'Sales price')),
        costPrice: round(number(b.costPrice ?? 0, 'Cost price')),
        notes: optionalString(b.notes),
        variants,
      };
    }
    if (table === 'plans') {
      assert(
        ['daily', 'weekly', 'monthly', 'yearly'].includes(b.interval),
        'Choose a daily, weekly, monthly or yearly interval.',
      );
      const availableFrom = date(b.availableFrom, 'Available from', true),
        availableTo = date(b.availableTo, 'Available to', true);
      datesValid(availableFrom, availableTo);
      return {
        ...common,
        price: round(number(b.price ?? 0, 'Plan price')),
        interval: b.interval,
        minimumQuantity: number(b.minimumQuantity ?? 1, 'Minimum quantity', {
          min: 1,
          max: 100000,
          integer: true,
        }),
        availableFrom,
        availableTo,
        autoClose: boolean(b.autoClose),
        allowClose: boolean(b.allowClose),
        allowPause: boolean(b.allowPause),
        allowRenew: boolean(b.allowRenew),
      };
    }
    if (table === 'taxes' || table === 'discounts') {
      const startDate = date(b.startDate, 'Start date', true),
        endDate = date(b.endDate, 'End date', true);
      datesValid(startDate, endDate);
      const productIds = identifiers(b.productIds, 'Products');
      validateRefs(db, 'products', productIds);
      if (table === 'taxes')
        return {
          ...common,
          rate: number(b.rate, 'Tax rate', { max: 100 }),
          productIds,
          startDate,
          endDate,
        };
      assert(
        ['fixed', 'percentage'].includes(b.type),
        'Discount type must be fixed or percentage.',
      );
      assert(
        ['product', 'subscription'].includes(b.scope ?? 'subscription'),
        'Discount scope must be product or subscription.',
      );
      const subscriptionIds = identifiers(b.subscriptionIds, 'Subscriptions');
      for (const subId of subscriptionIds)
        assert(
          db.prepare('SELECT id FROM subscriptions WHERE id=?').get(subId),
          'Unknown subscription reference.',
        );
      return {
        ...common,
        type: b.type,
        value: round(
          number(b.value, 'Discount value', { max: b.type === 'percentage' ? 100 : 100000000 }),
        ),
        minAmount: round(number(b.minAmount ?? 0, 'Minimum purchase')),
        minQuantity: number(b.minQuantity ?? 0, 'Minimum quantity', { integer: true }),
        startDate,
        endDate,
        usageLimit:
          b.usageLimit === null || b.usageLimit === undefined || b.usageLimit === ''
            ? null
            : number(b.usageLimit, 'Usage limit', { min: 1, integer: true }),
        scope: b.scope ?? 'subscription',
        productIds,
        subscriptionIds,
      };
    }
    if (table === 'templates') {
      const plan = record(db, 'plans', b.planId);
      assert(plan?.active, 'An available plan is required.');
      return {
        ...common,
        planId: b.planId,
        validityDays: number(b.validityDays ?? 30, 'Validity days', {
          min: 1,
          max: 365,
          integer: true,
        }),
        paymentTerms: number(b.paymentTerms ?? 14, 'Payment terms', { max: 365, integer: true }),
        notes: optionalString(b.notes),
        lines: normalizeLines(db, b.lines, { snapshot: !input.lines && !!existing.lines }),
      };
    }
  }
  for (const resource of simpleResources) {
    app.get(`/api/${resource}`, (req, res) => {
      assert(
        req.user.role !== 'customer' ||
          ['customers', 'products', 'plans', 'taxes'].includes(resource),
        'Staff access is required.',
        403,
      );
      const config =
        resource === 'customers'
          ? { customerColumn: 'id' }
          : req.user.role === 'customer'
            ? { extra: ["json_extract(data,'$.active')=1"] }
            : {};
      const list = paginate(req, resource, config);
      list.items = list.items.map((row) => catalogObject(resource, row, req.user));
      res.json(list);
    });
    app.get(`/api/${resource}/:id`, (req, res) => {
      assert(
        req.user.role !== 'customer' ||
          ['customers', 'products', 'plans', 'taxes'].includes(resource),
        'Staff access is required.',
        403,
      );
      if (resource === 'customers') own(req, req.params.id);
      const row = db.prepare(`SELECT * FROM ${resource} WHERE id=?`).get(req.params.id);
      assert(row, 'Record not found.', 404);
      const object = catalogObject(resource, row, req.user);
      if (resource !== 'customers' && req.user.role === 'customer')
        assert(object.active, 'Record not found.', 404);
      res.json(object);
    });
    app.post(`/api/${resource}`, resource === 'customers' ? internal : admin, (req, res) => {
      const object = normalizeResource(resource, req.body),
        recordId = id();
      if (resource === 'customers')
        assert(
          !db
            .prepare("SELECT id FROM customers WHERE LOWER(json_extract(data,'$.email'))=?")
            .get(object.email),
          'A customer with this billing email already exists.',
          409,
        );
      transaction(db, () => {
        if (resource === 'templates')
          db.prepare('INSERT INTO templates(id,plan_id,data) VALUES(?,?,?)').run(
            recordId,
            object.planId,
            JSON.stringify(object),
          );
        else
          db.prepare(`INSERT INTO ${resource}(id,data) VALUES(?,?)`).run(
            recordId,
            JSON.stringify(object),
          );
        audit(db, req.user, `${resource}.created`, recordId, {}, now());
      });
      res
        .status(201)
        .json(
          catalogObject(
            resource,
            db.prepare(`SELECT * FROM ${resource} WHERE id=?`).get(recordId),
            req.user,
          ),
        );
    });
    app.patch(`/api/${resource}/:id`, (req, res) => {
      if (resource === 'customers') own(req, req.params.id);
      else assert(req.user.role === 'admin', 'Administrator access is required.', 403);
      const existing = record(db, resource, req.params.id);
      assert(existing, 'Record not found.', 404);
      if (resource === 'customers' && req.user.role === 'customer')
        assert(
          req.body.email === undefined || req.body.email.toLowerCase() === existing.email,
          'Contact support to change the billing email.',
        );
      if (resource === 'customers' && req.user.role === 'customer')
        assert(req.body.active === undefined, 'Account status is managed by staff.', 403);
      const object = normalizeResource(resource, req.body, existing);
      if (resource === 'customers') {
        assert(
          !db
            .prepare(
              "SELECT id FROM customers WHERE LOWER(json_extract(data,'$.email'))=? AND id<>?",
            )
            .get(object.email, req.params.id),
          'A customer with this billing email already exists.',
          409,
        );
        if (object.email !== existing.email)
          assert(
            !db.prepare('SELECT id FROM users WHERE customer_id=?').get(req.params.id),
            'A portal-linked email cannot be changed here; update the verified account through support.',
          );
      }
      if (resource === 'discounts' && object.usageLimit !== null) {
        const row = db
          .prepare('SELECT usage_count,reserved_count FROM discounts WHERE id=?')
          .get(req.params.id);
        assert(
          object.usageLimit >= row.usage_count + row.reserved_count,
          'Usage limit cannot be lower than used and reserved redemptions.',
        );
      }
      transaction(db, () => {
        if (resource === 'templates')
          db.prepare('UPDATE templates SET plan_id=?,data=? WHERE id=?').run(
            object.planId,
            JSON.stringify(object),
            req.params.id,
          );
        else
          db.prepare(`UPDATE ${resource} SET data=? WHERE id=?`).run(
            JSON.stringify(object),
            req.params.id,
          );
        audit(db, req.user, `${resource}.updated`, req.params.id, {}, now());
      });
      res.json(
        catalogObject(
          resource,
          db.prepare(`SELECT * FROM ${resource} WHERE id=?`).get(req.params.id),
          req.user,
        ),
      );
    });
  }
  app.post('/api/customers/:id/invite', internal, async (req, res) => {
    const customer = record(db, 'customers', req.params.id);
    assert(customer?.active, 'Active customer not found.', 404);
    const randomPasswordHash = await passwordHash(`Invite!${token()}`);
    transaction(db, () => {
      let user = db.prepare('SELECT * FROM users WHERE email=?').get(customer.email);
      assert(
        !user || (user.role === 'customer' && user.customer_id === customer.id),
        'This email belongs to a different account.',
        409,
      );
      if (!user) {
        const userId = id();
        db.prepare(
          "INSERT INTO users(id,email,name,password_hash,role,customer_id) VALUES(?,?,?,?,'customer',?)",
        ).run(userId, customer.email, customer.name, randomPasswordHash, customer.id);
        user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
      }
      assert(user.active, 'This portal account is inactive.');
      const raw = token();
      db.prepare('DELETE FROM reset_tokens WHERE user_id=?').run(user.id);
      db.prepare('INSERT INTO reset_tokens VALUES(?,?,?)').run(
        hashToken(raw),
        user.id,
        new Date(now().getTime() + 30 * 60000).toISOString(),
      );
      const link = `${frontendUrl.replace(/\/$/, '')}/reset-password?token=${raw}`;
      queueEmail(
        db,
        customer.email,
        'Your Brightloop customer portal invitation',
        `<p>Hello ${escapeHtml(customer.name)},</p><p>Your subscriptions and invoices are ready in the Brightloop portal.</p><p><a href="${escapeHtml(link)}">Set your password and activate portal access</a>. This single-use invitation expires in 30 minutes.</p>`,
        now(),
      );
      audit(db, req.user, 'customer.invited', customer.id, {}, now());
    });
    void mailer.flush();
    res.json({ message: 'Portal invitation queued for the customer billing email.' });
  });
  app.get('/api/staff', admin, (req, res) => {
    const items = db
      .prepare("SELECT * FROM users WHERE role='staff' ORDER BY name")
      .all()
      .map(userObject);
    res.json({ items, total: items.length, page: 1, pageSize: items.length });
  });
  app.post('/api/staff', admin, async (req, res) => {
    const name = text(req.body.name, 'Name'),
      address = email(req.body.email),
      hash = await passwordHash(req.body.password),
      userId = id();
    assert(
      !db.prepare('SELECT id FROM users WHERE email=?').get(address),
      'An account with this email already exists.',
      409,
    );
    db.prepare("INSERT INTO users(id,email,name,password_hash,role) VALUES(?,?,?,?,'staff')").run(
      userId,
      address,
      name,
      hash,
    );
    audit(db, req.user, 'staff.created', userId, {}, now());
    res.status(201).json(userObject(db.prepare('SELECT * FROM users WHERE id=?').get(userId)));
  });
  app.patch('/api/staff/:id', admin, (req, res) => {
    const user = db.prepare("SELECT * FROM users WHERE id=? AND role='staff'").get(req.params.id);
    assert(user, 'Staff account not found.', 404);
    transaction(db, () => {
      db.prepare('UPDATE users SET name=?,active=? WHERE id=?').run(
        text(req.body.name ?? user.name, 'Name'),
        boolean(req.body.active, !!user.active) ? 1 : 0,
        user.id,
      );
      if (req.body.active === false)
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      audit(db, req.user, 'staff.updated', user.id, {}, now());
    });
    res.json(userObject(db.prepare('SELECT * FROM users WHERE id=?').get(user.id)));
  });

  function validateTerm(start, expiry, interval, anchor = start) {
    assert(start < expiry, 'Expiry date must follow start date (expiry is exclusive).');
    assert(expiry <= addDays(start, 7305), 'Subscription term cannot exceed 20 years.');
    let boundary = start;
    while (boundary < expiry) boundary = nextPeriod(boundary, interval, anchor);
    assert(
      boundary === expiry,
      'Expiry must align with the plan billing interval; partial periods are not supported.',
    );
  }
  function makeSubscription(input, existing = null) {
    const template = input.templateId ? record(db, 'templates', input.templateId) : null;
    assert(!input.templateId || template?.active, 'Quotation template is unavailable.');
    const b = {
      ...(template
        ? { planId: template.planId, paymentTerms: template.paymentTerms, notes: template.notes }
        : {}),
      ...existing,
      ...input,
    };
    const customer = record(db, 'customers', b.customerId),
      plan = record(db, 'plans', b.planId);
    assert(customer?.active, 'An active customer is required.');
    assert(plan?.active, 'An available plan is required.');
    assert(
      (!plan.availableFrom || plan.availableFrom <= today()) &&
        (!plan.availableTo || plan.availableTo >= today()),
      'Plan is not currently available.',
    );
    const startDate = date(b.startDate, 'Start date'),
      expiryDate = date(b.expiryDate, 'Expiry date');
    validateTerm(startDate, expiryDate, plan.interval);
    const sourceLines = input.lines ?? existing?.lines ?? template?.lines;
    const lines = normalizeLines(db, sourceLines, {
      snapshot: !input.lines && !!(existing?.lines || template?.lines),
    });
    assert(
      lines.reduce((sum, l) => sum + l.quantity, 0) >= plan.minimumQuantity,
      `This plan requires a minimum quantity of ${plan.minimumQuantity}.`,
    );
    return {
      ...(existing ?? {}),
      customerId: b.customerId,
      planId: b.planId,
      startDate,
      expiryDate,
      paymentTerms: number(b.paymentTerms ?? 14, 'Payment terms', { max: 365, integer: true }),
      lines,
      notes: optionalString(b.notes),
      currency,
      billingAnchor: startDate,
      nextBillingDate: startDate,
      quotationValidUntil: addDays(today(), template?.validityDays ?? 30),
      planSnapshot: { ...plan },
      createdAt: existing?.createdAt ?? now().toISOString(),
    };
  }
  app.get('/api/subscriptions', (req, res) => {
    const list = paginate(req, 'subscriptions', {
      customerColumn: 'customer_id',
      statusColumn: 'status',
      dateColumn: "json_extract(data,'$.startDate')",
    });
    list.items = list.items.map((row) => subscriptionObject(db, row));
    res.json(list);
  });
  app.get('/api/subscriptions/:id', (req, res) => {
    const sub = subscriptionObject(
      db,
      db.prepare('SELECT * FROM subscriptions WHERE id=?').get(req.params.id),
    );
    assert(sub, 'Subscription not found.', 404);
    own(req, sub.customerId);
    res.json(sub);
  });
  app.post('/api/subscriptions', internal, (req, res) => {
    const sub = makeSubscription(req.body);
    sub.id = id();
    sub.status = 'Draft';
    transaction(db, () => {
      sub.number = nextNumber(db, 'subscription', 'SUB');
      const { id: subId, customerId, planId, status, nextBillingDate, ...data } = sub;
      db.prepare('INSERT INTO subscriptions VALUES(?,?,?,?,?,?)').run(
        subId,
        customerId,
        planId,
        status,
        nextBillingDate,
        JSON.stringify(data),
      );
      audit(db, req.user, 'subscription.created', sub.id, {}, now());
    });
    res
      .status(201)
      .json(
        subscriptionObject(db, db.prepare('SELECT * FROM subscriptions WHERE id=?').get(sub.id)),
      );
  });
  app.patch('/api/subscriptions/:id', internal, (req, res) => {
    const existing = subscriptionObject(
      db,
      db.prepare('SELECT * FROM subscriptions WHERE id=?').get(req.params.id),
    );
    assert(existing, 'Subscription not found.', 404);
    assert(existing.status === 'Draft', 'Only draft subscriptions can be edited.');
    const sub = makeSubscription(req.body, existing);
    sub.id = existing.id;
    sub.status = existing.status;
    sub.number = existing.number;
    transaction(db, () => {
      saveSubscription(db, sub);
      audit(db, req.user, 'subscription.updated', sub.id, {}, now());
    });
    res.json(
      subscriptionObject(db, db.prepare('SELECT * FROM subscriptions WHERE id=?').get(sub.id)),
    );
  });
  app.post('/api/subscriptions/:id/:action', (req, res) => {
    if (['pause', 'close'].includes(req.params.action)) {
      const existing = subscriptionObject(
        db,
        db.prepare('SELECT * FROM subscriptions WHERE id=?').get(req.params.id),
      );
      assert(existing, 'Subscription not found.', 404);
      own(req, existing.customerId);
      const allowed =
        req.params.action === 'pause'
          ? existing.planSnapshot.allowPause
          : existing.planSnapshot.allowClose;
      assert(
        allowed,
        `This plan does not permit ${req.params.action === 'pause' ? 'pauses' : 'early closure'}.`,
      );
      const catchup = runBilling(db, today(), now(), existing.id);
      assert(
        catchup.errors.length === 0,
        'Outstanding billing periods must be resolved before changing this subscription.',
      );
      const fresh = subscriptionObject(
        db,
        db.prepare('SELECT * FROM subscriptions WHERE id=?').get(existing.id),
      );
      assert(
        fresh.status !== 'Active' ||
          fresh.nextBillingDate > today() ||
          fresh.nextBillingDate >= fresh.expiryDate,
        'Billing catch-up is still in progress; retry after the next billing run.',
      );
    }
    const result = transaction(db, () => {
      const sub = subscriptionObject(
        db,
        db.prepare('SELECT * FROM subscriptions WHERE id=?').get(req.params.id),
      );
      assert(sub, 'Subscription not found.', 404);
      own(req, sub.customerId);
      const plan = sub.planSnapshot,
        action = req.params.action;
      if (['quote', 'confirm', 'activate'].includes(action))
        assert(req.user.role !== 'customer', 'Staff access is required.', 403);
      if (action === 'quote') {
        assert(sub.status === 'Draft', 'Only drafts can become quotations.');
        assert(
          sub.quotationValidUntil >= today(),
          'Quotation has expired; edit the draft before issuing.',
        );
        sub.status = 'Quotation';
      } else if (action === 'confirm') {
        assert(sub.status === 'Quotation', 'Only quotations can be confirmed.');
        assert(
          sub.quotationValidUntil >= today(),
          'Quotation has expired. Create a revised quotation.',
        );
        sub.status = 'Confirmed';
      } else if (action === 'activate') {
        assert(sub.status === 'Confirmed', 'Only confirmed subscriptions can activate.');
        assert(
          sub.startDate <= today() && sub.expiryDate > today(),
          'Subscription is not within its service dates.',
        );
        sub.status = 'Active';
      } else if (action === 'pause') {
        assert(plan.allowPause, 'This plan does not permit pauses.');
        assert(sub.status === 'Active', 'Only active subscriptions can pause.');
        sub.status = 'Paused';
        sub.pausedAt = today();
      } else if (action === 'resume') {
        assert(plan.allowPause, 'This plan does not permit pauses.');
        assert(sub.status === 'Paused', 'Only paused subscriptions can resume.');
        assert(sub.expiryDate > today(), 'Renew the expired subscription before resuming.');
        sub.status = 'Active';
        while (sub.nextBillingDate < today() && sub.nextBillingDate < sub.expiryDate)
          sub.nextBillingDate = nextPeriod(sub.nextBillingDate, plan.interval, sub.billingAnchor);
        sub.resumedAt = today();
      } else if (action === 'close') {
        assert(plan.allowClose, 'This plan does not permit early closure.');
        assert(
          ['Active', 'Paused', 'Confirmed'].includes(sub.status),
          'This subscription cannot be closed.',
        );
        sub.status = 'Closed';
        sub.closedAt = today();
      } else if (action === 'renew') {
        assert(plan.allowRenew, 'This plan does not permit renewal.');
        assert(
          ['Active', 'Paused', 'Closed'].includes(sub.status),
          'Only active, paused or closed subscriptions can renew.',
        );
        const newExpiry = date(req.body.expiryDate, 'New expiry date');
        assert(
          newExpiry > sub.expiryDate && newExpiry > today(),
          'Renewal expiry must extend the current term and be in the future.',
        );
        let renewalStart = sub.expiryDate;
        if (sub.status === 'Closed') {
          if (renewalStart <= today()) {
            renewalStart = today();
            sub.nextBillingDate = today();
            sub.billingAnchor = today();
          } else
            while (sub.nextBillingDate < today() && sub.nextBillingDate < sub.expiryDate)
              sub.nextBillingDate = nextPeriod(
                sub.nextBillingDate,
                plan.interval,
                sub.billingAnchor,
              );
        }
        validateTerm(renewalStart, newExpiry, plan.interval, sub.billingAnchor);
        sub.expiryDate = newExpiry;
        sub.status = sub.status === 'Paused' ? 'Paused' : 'Active';
      } else throw new HttpError(404, 'Unknown subscription action.');
      saveSubscription(db, sub);
      audit(db, req.user, `subscription.${action}`, sub.id, {}, now());
      return sub;
    });
    res.json(result);
  });

  app.post('/api/billing/run', internal, (req, res) => {
    assert(
      !production || !req.body.asOf || req.body.asOf === today(),
      'Billing date overrides are unavailable in production.',
    );
    const asOf = req.body.asOf ? date(req.body.asOf) : today();
    res.json(runBilling(db, asOf, now()));
  });
  app.get('/api/invoices', (req, res) => {
    const extra =
      req.query.status === 'Overdue'
        ? ["status IN ('Confirmed','Paid')", 'total_cents>paid_cents', 'due_date<?']
        : [];
    const query =
      req.query.status === 'Overdue' ? { ...req, query: { ...req.query, status: undefined } } : req;
    const list = paginate(query, 'invoices', {
      customerColumn: 'customer_id',
      statusColumn: 'status',
      dateColumn: 'issue_date',
      extra,
      params: extra.length ? [today()] : [],
    });
    list.items = list.items.map(invoiceObject);
    res.json(list);
  });
  app.get('/api/invoices/:id', (req, res) => {
    const invoice = invoiceObject(
      db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id),
    );
    assert(invoice, 'Invoice not found.', 404);
    own(req, invoice.customerId);
    res.json(invoice);
  });
  app.get('/api/invoices/:id/print', (req, res) => {
    const invoice = invoiceObject(
      db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id),
    );
    assert(invoice, 'Invoice not found.', 404);
    own(req, invoice.customerId);
    res.type('html').send(invoiceHtml(invoice));
  });
  app.post('/api/invoices/:id/confirm', internal, (req, res) =>
    res.json(transaction(db, () => confirmInvoice(db, req.params.id, req.user, now()))),
  );
  app.post('/api/invoices/:id/cancel', internal, (req, res) =>
    res.json(transaction(db, () => cancelInvoice(db, req.params.id, req.user, now()))),
  );
  app.post('/api/invoices/:id/send', internal, (req, res) => {
    const invoice = invoiceObject(
      db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id),
    );
    assert(invoice, 'Invoice not found.', 404);
    assert(['Confirmed', 'Paid'].includes(invoice.status), 'Confirm this invoice before sending.');
    const mailId = queueEmail(
      db,
      invoice.customer.email,
      `Brightloop invoice ${invoice.number}`,
      invoiceHtml(invoice),
      now(),
    );
    audit(db, req.user, 'invoice.sent', invoice.id, { mailId }, now());
    void mailer.flush();
    res.json({ ...invoice, delivery: mailer.configured ? 'Queued' : 'Development outbox' });
  });
  app.get('/api/payments', (req, res) => {
    const list = paginate(req, 'payments', {
      customerColumn: 'customer_id',
      statusColumn: 'status',
      dateColumn: 'date',
    });
    list.items = list.items.map(paymentObject);
    res.json(list);
  });
  app.post('/api/payments', internal, (req, res) => {
    const amountCents = cents(number(req.body.amount, 'Payment amount', { min: 0.01 })),
      paymentDate = date(req.body.date ?? today(), 'Payment date');
    assert(paymentDate <= today(), 'Payment date cannot be in the future.');
    const payment = transaction(db, () => {
      const invoice = db.prepare('SELECT * FROM invoices WHERE id=?').get(req.body.invoiceId);
      assert(invoice, 'Invoice not found.', 404);
      assert(invoice.status === 'Confirmed', 'Payments require a confirmed, unpaid invoice.');
      assert(
        amountCents <= invoice.total_cents - invoice.paid_cents,
        'Payment exceeds the remaining invoice balance.',
      );
      const reference = optionalString(req.body.reference, 200);
      if (reference)
        assert(
          !db
            .prepare(
              "SELECT id FROM payments WHERE json_extract(data,'$.reference')=? AND status='Recorded'",
            )
            .get(reference),
          'This payment reference has already been recorded.',
          409,
        );
      const paymentId = id(),
        data = {
          invoiceNumber: JSON.parse(invoice.data).number,
          method: text(req.body.method, 'Payment method', 100),
          note: optionalString(req.body.note, 1000),
          reference,
          createdAt: now().toISOString(),
        };
      db.prepare('INSERT INTO payments VALUES(?,?,?,?,?,?,?)').run(
        paymentId,
        invoice.id,
        invoice.customer_id,
        amountCents,
        paymentDate,
        'Recorded',
        JSON.stringify(data),
      );
      const paid = invoice.paid_cents + amountCents;
      db.prepare('UPDATE invoices SET paid_cents=?,status=? WHERE id=?').run(
        paid,
        paid === invoice.total_cents ? 'Paid' : 'Confirmed',
        invoice.id,
      );
      audit(db, req.user, 'payment.recorded', paymentId, {}, now());
      return paymentObject(db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId));
    });
    res.status(201).json(payment);
  });
  app.post('/api/payments/:id/reverse', internal, (req, res) => {
    const payment = transaction(db, () => {
      const row = db.prepare('SELECT * FROM payments WHERE id=?').get(req.params.id);
      assert(row, 'Payment not found.', 404);
      assert(row.status === 'Recorded', 'Payment is already reversed.');
      db.prepare("UPDATE payments SET status='Reversed' WHERE id=?").run(row.id);
      db.prepare("UPDATE invoices SET paid_cents=paid_cents-?,status='Confirmed' WHERE id=?").run(
        row.amount_cents,
        row.invoice_id,
      );
      audit(db, req.user, 'payment.reversed', row.id, {}, now());
      return paymentObject(db.prepare('SELECT * FROM payments WHERE id=?').get(row.id));
    });
    res.json(payment);
  });

  app.get('/api/reports/summary', (req, res) => {
    const from = req.query.from ? date(req.query.from) : null,
      to = req.query.to ? date(req.query.to) : null;
    datesValid(from, to);
    const customerId = req.user.role === 'customer' ? req.user.customerId : req.query.customerId;
    const params = [],
      clauses = [];
    if (customerId) {
      clauses.push('customer_id=?');
      params.push(customerId);
    }
    if (req.query.planId) {
      clauses.push('plan_id=?');
      params.push(req.query.planId);
    }
    if (req.query.status) {
      clauses.push('status=?');
      params.push(req.query.status);
    }
    const subs = db
      .prepare(
        `SELECT * FROM subscriptions${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}`,
      )
      .all(...params)
      .map((row) => subscriptionObject(db, row));
    const subIds = new Set(subs.map((s) => s.id));
    const invoiceRows = db
      .prepare(`SELECT * FROM invoices${customerId ? ' WHERE customer_id=?' : ''}`)
      .all(...(customerId ? [customerId] : []));
    const invoices = invoiceRows.filter((r) => subIds.has(r.subscription_id)).map(invoiceObject);
    const issued = invoices.filter((i) => ['Confirmed', 'Paid'].includes(i.status));
    const inRange = (d) => (!from || d >= from) && (!to || d <= to);
    const periodInvoices = issued.filter((i) => inRange(i.issueDate));
    const selectedInvoices = new Set(issued.map((i) => i.id));
    const payments = db
      .prepare(
        `SELECT * FROM payments WHERE status='Recorded'${customerId ? ' AND customer_id=?' : ''}`,
      )
      .all(...(customerId ? [customerId] : []))
      .filter((p) => selectedInvoices.has(p.invoice_id) && inRange(p.date))
      .map(paymentObject);
    const overdue = issued.filter((i) => i.balance > 0 && i.dueDate < today());
    const monthly = new Map();
    for (const invoice of periodInvoices) {
      const month = invoice.issueDate.slice(0, 7);
      const row = monthly.get(month) ?? { month, invoiced: 0, payments: 0 };
      row.invoiced = round(
        new Decimal(row.invoiced).plus(invoice.subtotal).minus(invoice.discountTotal),
      );
      monthly.set(month, row);
    }
    for (const payment of payments) {
      const month = payment.date.slice(0, 7);
      const row = monthly.get(month) ?? { month, invoiced: 0, payments: 0 };
      row.payments = round(new Decimal(row.payments).plus(payment.amount));
      monthly.set(month, row);
    }
    const active = subs.filter(
      (s) => s.status === 'Active' && s.startDate <= today() && s.expiryDate > today(),
    );
    let mrr = new Decimal(0);
    for (const sub of active) {
      const plan = sub.planSnapshot,
        amount = sub.lines.reduce(
          (sum, l) => sum.plus(new Decimal(l.unitPrice).mul(l.quantity)),
          new Decimal(plan.price),
        );
      const factor = {
        daily: new Decimal(365).div(12),
        weekly: new Decimal(52).div(12),
        monthly: new Decimal(1),
        yearly: new Decimal(1).div(12),
      }[plan.interval];
      mrr = mrr.plus(amount.mul(factor));
    }
    const sum = (arr, fn) => round(arr.reduce((n, v) => n.plus(fn(v)), new Decimal(0)));
    res.json({
      activeSubscriptions: active.length,
      totalSubscriptions: subs.length,
      invoicedRevenue: sum(periodInvoices, (i) => i.subtotal - i.discountTotal),
      paymentsReceived: sum(payments, (p) => p.amount),
      outstanding: sum(issued, (i) => i.balance),
      overdueAmount: sum(overdue, (i) => i.balance),
      overdueCount: overdue.length,
      mrr: round(mrr),
      currency,
      monthlyRevenue: [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)),
      subscriptionBreakdown: ['Draft', 'Quotation', 'Confirmed', 'Active', 'Paused', 'Closed'].map(
        (status) => ({ status, count: subs.filter((s) => s.status === status).length }),
      ),
      recentInvoices: [...invoices]
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate))
        .slice(0, 8),
      overdueInvoices: overdue.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 10),
    });
  });
  app.get('/api/outbox', admin, (req, res) => {
    assert(!production, 'Outbox inspection is disabled in production.', 404);
    const rows = db
      .prepare('SELECT * FROM outbox ORDER BY rowid DESC LIMIT 100')
      .all()
      .map((r) => ({
        id: r.id,
        to: r.recipient,
        subject: r.subject,
        html: r.html,
        status: r.status,
        createdAt: r.created_at,
        error: r.error,
      }));
    res.json({ items: rows, total: rows.length, page: 1, pageSize: 100 });
  });
  app.get('/api/audit', admin, (req, res) => {
    const list = paginate(req, 'audit', { dateColumn: 'created_at' });
    list.items = list.items.map((r) => ({
      id: r.id,
      actorId: r.actor_id,
      action: r.action,
      entityId: r.entity_id,
      createdAt: r.created_at,
      details: JSON.parse(r.data),
    }));
    res.json(list);
  });
  app.use((req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed')
      return res.status(400).json({ error: 'Invalid JSON body.' });
    if (err.type === 'entity.too.large')
      return res.status(413).json({ error: 'Request body exceeds the 256 KB limit.' });
    if (err.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/.test(err.message))
      return res.status(409).json({ error: 'This record already exists.' });
    console.error('API error:', err.message);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  });
  const bootstrap =
    options.bootstrapAdmin ??
    (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD
      ? {
          email: process.env.ADMIN_EMAIL,
          password: process.env.ADMIN_PASSWORD,
          name: process.env.ADMIN_NAME || 'Administrator',
        }
      : null);
  if (bootstrap && !db.prepare("SELECT id FROM users WHERE role='admin'").get()) {
    const hash = await passwordHash(bootstrap.password);
    db.prepare("INSERT INTO users(id,email,name,password_hash,role) VALUES(?,?,?,?,'admin')").run(
      id(),
      email(bootstrap.email),
      text(bootstrap.name ?? 'Administrator', 'Admin name'),
      hash,
    );
  }
  if (production && !db.prepare("SELECT id FROM users WHERE role='admin'").get()) {
    mailer.close();
    db.close();
    throw new Error('A fresh production database requires ADMIN_EMAIL and ADMIN_PASSWORD.');
  }
  app.locals.db = db;
  app.locals.runBilling = (asOf) => runBilling(db, asOf ?? today(), now());
  app.locals.flushEmails = () => mailer.flush();
  app.locals.close = () => {
    mailer.close();
    db.close();
  };
  app.locals.maintenance = () => {
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now().toISOString());
    db.prepare('DELETE FROM reset_tokens WHERE expires_at<=?').run(now().toISOString());
  };
  app.locals.now = now;
  app.locals.currency = currency;
  return app;
}
