import Decimal from 'decimal.js';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { id, record } from './db.js';
const scrypt = promisify(scryptCallback);
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function assert(condition, message, status = 400) {
  if (!condition) throw new HttpError(status, message);
}
export const hashToken = (token) => createHash('sha256').update(token).digest('hex');
export const token = () => randomBytes(32).toString('hex');
export function passwordValid(value) {
  return (
    typeof value === 'string' &&
    value.length >= 9 &&
    value.length <= 128 &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /[^A-Za-z0-9\s]/.test(value)
  );
}
export async function passwordHash(password) {
  assert(
    passwordValid(password),
    'Password must contain at least 9 characters, uppercase, lowercase and a special character (maximum 128).',
  );
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${derived.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [salt, key] = stored.split(':');
  const derived = await scrypt(password, salt, 64);
  return timingSafeEqual(derived, Buffer.from(key, 'hex'));
}
export function email(value) {
  assert(
    typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    'A valid email is required.',
  );
  return value.trim().toLowerCase();
}
export function text(value, label, max = 200) {
  assert(
    typeof value === 'string' && value.trim().length > 0 && value.length <= max,
    `${label} is required (maximum ${max} characters).`,
  );
  return value.trim();
}
export function number(value, label, { min = 0, max = 100000000, integer = false } = {}) {
  const n = Number(value);
  assert(
    value !== null &&
      value !== '' &&
      Number.isFinite(n) &&
      n >= min &&
      n <= max &&
      (!integer || Number.isInteger(n)),
    `${label} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}.`,
  );
  return n;
}
export function cents(value) {
  const n = new Decimal(value).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  assert(Number.isSafeInteger(n), 'Amount is too large.');
  return n;
}
export const money = (minor) => new Decimal(minor).div(100).toNumber();
export const round = (value) => money(cents(value));
export function date(value, label = 'Date', optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  assert(
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value),
    `${label} must use YYYY-MM-DD.`,
  );
  const d = new Date(`${value}T00:00:00Z`);
  assert(!isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value, `${label} is invalid.`);
  return value;
}
export const dateOnly = (d) => d.toISOString().slice(0, 10);
export function addDays(value, days) {
  const d = new Date(`${value}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return dateOnly(d);
}
export function nextPeriod(start, interval, anchor = start) {
  if (interval === 'daily') return addDays(start, 1);
  if (interval === 'weekly') return addDays(start, 7);
  const d = new Date(`${start}T00:00:00Z`),
    a = new Date(`${anchor}T00:00:00Z`);
  const y = d.getUTCFullYear() + (interval === 'yearly' ? 1 : 0),
    m = d.getUTCMonth() + (interval === 'monthly' ? 1 : 0);
  const result = new Date(Date.UTC(y, m, 1));
  const last = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(a.getUTCDate(), last));
  return dateOnly(result);
}
export const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export function normalizeLines(db, lines, { snapshot = false } = {}) {
  assert(
    Array.isArray(lines) && lines.length > 0 && lines.length <= 100,
    'Between 1 and 100 product lines are required.',
  );
  return lines.map((line) => {
    const product = record(db, 'products', line.productId);
    assert(product?.active, 'Product does not exist or is archived.');
    const variant = line.variantId ? product.variants.find((v) => v.id === line.variantId) : null;
    assert(!line.variantId || variant, 'Selected variant does not belong to product.');
    const quantity = number(line.quantity, 'Quantity', { min: 1, max: 100000, integer: true });
    const base =
      line.unitPrice === undefined || line.unitPrice === ''
        ? product.salesPrice
        : number(line.unitPrice, 'Unit price');
    const adjustment = variant?.priceAdjustment ?? 0;
    const unitPrice = snapshot ? base : round(new Decimal(base).plus(adjustment));
    assert(unitPrice >= 0, 'Unit price cannot be negative.');
    const taxIds = line.taxIds ?? [];
    assert(
      Array.isArray(taxIds) && taxIds.every((t) => typeof t === 'string' && record(db, 'taxes', t)),
      'Invalid tax selection.',
    );
    return {
      id: line.id ?? id(),
      productId: product.id,
      productName: product.name,
      variantId: variant?.id ?? null,
      variantName: variant?.name ?? '',
      variantAdjustment: adjustment,
      quantity,
      unitPrice,
      taxIds: [...new Set(taxIds)],
      amount: round(new Decimal(quantity).mul(unitPrice)),
    };
  });
}
