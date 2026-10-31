export function money(value, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(value || 0));
}
export function date(value) {
  if (!value) return '—';
  const parsed = new Date(String(value).length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(parsed);
}
export function today() {
  return new Date().toISOString().slice(0, 10);
}
export function passwordValid(password) {
  return (
    password.length > 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[^A-Za-z0-9\s]/.test(password)
  );
}
export function query(params) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== '' && value != null) q.set(key, String(value));
  return q.toString();
}
export function initials(name = '') {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || 'B'
  );
}
