import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const id = () => randomUUID();
export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY);
    INSERT OR IGNORE INTO schema_version VALUES(1);
    CREATE TABLE IF NOT EXISTS customers(id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS customers_email ON customers(LOWER(json_extract(data,'$.email')));
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','staff','customer')), customer_id TEXT REFERENCES customers(id), active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reset_tokens(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS taxes(id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS discounts(id TEXT PRIMARY KEY, data TEXT NOT NULL, usage_count INTEGER NOT NULL DEFAULT 0, reserved_count INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS templates(id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans(id), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS subscriptions(id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), plan_id TEXT NOT NULL REFERENCES plans(id), status TEXT NOT NULL, next_billing_date TEXT, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS subscriptions_due ON subscriptions(status,next_billing_date);
    CREATE INDEX IF NOT EXISTS subscriptions_customer ON subscriptions(customer_id,status);
    CREATE TABLE IF NOT EXISTS invoices(id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL REFERENCES subscriptions(id), customer_id TEXT NOT NULL REFERENCES customers(id), status TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, issue_date TEXT NOT NULL, due_date TEXT NOT NULL, total_cents INTEGER NOT NULL, paid_cents INTEGER NOT NULL DEFAULT 0, discount_id TEXT REFERENCES discounts(id), discount_state TEXT, data TEXT NOT NULL, UNIQUE(subscription_id,period_start,period_end));
    CREATE INDEX IF NOT EXISTS invoices_customer ON invoices(customer_id,status);
    CREATE INDEX IF NOT EXISTS invoices_due ON invoices(status,due_date);
    CREATE INDEX IF NOT EXISTS invoices_issue ON invoices(issue_date);
    CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id), customer_id TEXT NOT NULL REFERENCES customers(id), amount_cents INTEGER NOT NULL CHECK(amount_cents>0), date TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS payments_customer_date ON payments(customer_id,date);
    CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY, recipient TEXT NOT NULL, subject TEXT NOT NULL, html TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Pending', created_at TEXT NOT NULL, error TEXT, attempts INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY, actor_id TEXT, action TEXT NOT NULL, entity_id TEXT, created_at TEXT NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS audit_date ON audit(created_at);
    CREATE TABLE IF NOT EXISTS sequences(name TEXT PRIMARY KEY, value INTEGER NOT NULL);
  `);
  return db;
}
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
export function nextNumber(db, name, prefix) {
  db.prepare(
    'INSERT INTO sequences(name,value) VALUES(?,1) ON CONFLICT(name) DO UPDATE SET value=value+1',
  ).run(name);
  return `${prefix}-${String(db.prepare('SELECT value FROM sequences WHERE name=?').get(name).value).padStart(6, '0')}`;
}
export function record(db, table, recordId) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(recordId);
  return row ? { ...JSON.parse(row.data), id: row.id } : null;
}
export function audit(db, actor, action, entityId, details = {}, now = new Date()) {
  db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?)').run(
    id(),
    actor?.id ?? null,
    action,
    entityId ?? null,
    now.toISOString(),
    JSON.stringify(details),
  );
}
