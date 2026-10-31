import { describe, it, expect } from 'vitest';
import { date, money, passwordValid, query } from '../src/utils.js';
describe('presentation contracts', () => {
  it('keeps date-only values independent of the user timezone', () =>
    expect(date('2026-01-31')).toBe('Jan 31, 2026'));
  it('formats monetary values without hiding zero balances', () => {
    expect(money(0, 'USD')).toBe('$0.00');
    expect(money(1234.56, 'USD')).toBe('$1,234.56');
  });
  it('enforces more than eight characters and required categories', () => {
    expect(passwordValid('Abcdefg!')).toBe(false);
    expect(passwordValid('Abcdefgh!')).toBe(true);
    expect(passwordValid('abcdefgh!')).toBe(false);
    expect(passwordValid('ABCDEFGH!')).toBe(false);
    expect(passwordValid('Abcdefghi')).toBe(false);
  });
  it('encodes search filters and preserves zero-valued parameters', () => {
    expect(query({ q: 'A&B', page: 0, status: '', from: null })).toBe('q=A%26B&page=0');
  });
});
