/**
 * Display formatting.
 *
 * The server sends money and grams as decimal **strings**. These helpers format
 * those strings without ever round-tripping through a JS float, so a value like
 * `"245000.10"` can never render as `245000.09999999999`. All the digit work is
 * done on the string itself.
 */

interface Parts {
  neg: boolean;
  int: string;
  frac: string;
}

function splitDecimal(raw: string | number): Parts | null {
  const s = typeof raw === 'number' ? (Number.isFinite(raw) ? String(raw) : '') : raw.trim();
  if (!s) return null;
  // Reject exponent notation and anything that is not a plain decimal.
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const int = (m[2] ?? '').replace(/^0+(?=\d)/, '');
  const frac = m[3] ?? '';
  if (int === '' && frac === '') return null;
  return { neg: m[1] === '-', int: int === '' ? '0' : int, frac };
}

/** Round a decimal string to `dp` places, half-up, using digit arithmetic. */
function roundParts(p: Parts, dp: number): Parts {
  if (p.frac.length <= dp) {
    return { ...p, frac: p.frac.padEnd(dp, '0') };
  }
  const keep = p.frac.slice(0, dp);
  const nextDigit = p.frac.charCodeAt(dp) - 48;
  if (nextDigit < 5) return { ...p, frac: keep };

  // Increment the digit string `int + keep` by one.
  const digits = (p.int + keep).split('');
  let i = digits.length - 1;
  while (i >= 0) {
    const d = (digits[i] as string).charCodeAt(0) - 48;
    if (d === 9) {
      digits[i] = '0';
      i -= 1;
    } else {
      digits[i] = String(d + 1);
      break;
    }
  }
  if (i < 0) digits.unshift('1');
  const joined = digits.join('');
  const intLen = joined.length - dp;
  return {
    neg: p.neg,
    int: intLen > 0 ? joined.slice(0, intLen) : '0',
    frac: dp > 0 ? joined.slice(intLen) : '',
  };
}

function group(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format a decimal string/number to exactly `dp` places with thousands
 * separators. Returns `fallback` for anything unparseable (including `null`).
 */
export function formatDecimal(
  raw: string | number | null | undefined,
  dp: number,
  fallback = '—',
): string {
  if (raw === null || raw === undefined) return fallback;
  const parts = splitDecimal(raw);
  if (!parts) return fallback;
  const r = roundParts(parts, dp);
  const body = dp > 0 ? `${group(r.int)}.${r.frac}` : group(r.int);
  const isZero = r.int === '0' && /^0*$/.test(r.frac);
  return r.neg && !isZero ? `-${body}` : body;
}

/** PKR at full precision: `"245000.1"` → `"245,000.10"`. */
export function formatPkr(raw: string | number | null | undefined, fallback = '—'): string {
  return formatDecimal(raw, 2, fallback);
}

/**
 * PKR for headline display: drops a `.00` tail so whole amounts read as
 * `"5,000"` (as in the Asasa reference screens) while a real fractional
 * amount still shows both decimal places.
 */
export function formatPkrSmart(
  raw: string | number | null | undefined,
  fallback = '—',
): string {
  const full = formatPkr(raw, fallback);
  if (full === fallback) return fallback;
  return full.endsWith('.00') ? full.slice(0, -3) : full;
}

/** `"Rs. 5,000"` — the customer-facing money string used throughout the UI. */
export function rs(raw: string | number | null | undefined, fallback = '—'): string {
  const v = formatPkrSmart(raw, fallback);
  return v === fallback ? fallback : `Rs. ${v}`;
}

/** Grams at settlement precision (4 dp, per the contract's `gram_dp`). */
export function formatGrams(
  raw: string | number | null | undefined,
  dp = 4,
  fallback = '—',
): string {
  return formatDecimal(raw, dp, fallback);
}

/** `"0.1149 g"`. */
export function grams(
  raw: string | number | null | undefined,
  dp = 4,
  fallback = '—',
): string {
  const v = formatGrams(raw, dp, fallback);
  return v === fallback ? fallback : `${v} g`;
}

/** `"Rs. 43,502/g"` — a PKR-per-gram rate. */
export function rate(raw: string | number | null | undefined, fallback = '—'): string {
  const v = formatPkrSmart(raw, fallback);
  return v === fallback ? fallback : `Rs. ${v}/g`;
}

/**
 * `75` → `"1:15"`, `9` → `"0:09"`. Never renders a negative clock: a value at
 * or below zero is `"0:00"`, which is what an expired quote must read as.
 */
export function formatCountdown(secondsLeft: number): string {
  const s = Math.max(0, Math.ceil(Number.isFinite(secondsLeft) ? secondsLeft : 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** `"Updated 2m ago"` freshness copy from an age in seconds. */
export function formatAge(ageSeconds: number | null | undefined): string {
  if (ageSeconds === null || ageSeconds === undefined || !Number.isFinite(ageSeconds)) {
    return 'never refreshed';
  }
  const a = Math.max(0, Math.floor(ageSeconds));
  if (a < 10) return 'just now';
  if (a < 60) return `${a}s ago`;
  const m = Math.floor(a / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

/** `"6 Sep 2026, 01:24"` — receipt / ledger timestamps. */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
