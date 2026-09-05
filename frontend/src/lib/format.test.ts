import { describe, expect, it } from 'vitest';
import {
  formatAge,
  formatCountdown,
  formatDecimal,
  formatGrams,
  formatPkr,
  formatPkrSmart,
  grams,
  rate,
  rs,
} from './format';

describe('PKR formatting', () => {
  it('always shows two decimal places with thousands separators', () => {
    expect(formatPkr('250000.00')).toBe('250,000.00');
    expect(formatPkr('245000.1')).toBe('245,000.10');
    expect(formatPkr('5000')).toBe('5,000.00');
    expect(formatPkr('1234567.89')).toBe('1,234,567.89');
    expect(formatPkr('0.5')).toBe('0.50');
  });

  it('rounds half-up to 2 dp without floating point drift', () => {
    expect(formatPkr('1.005')).toBe('1.01');
    expect(formatPkr('2.675')).toBe('2.68');
    expect(formatPkr('9.999')).toBe('10.00');
    expect(formatPkr('999.999')).toBe('1,000.00');
  });

  it('drops a .00 tail for headline display but keeps real decimals', () => {
    expect(formatPkrSmart('5000.00')).toBe('5,000');
    expect(formatPkrSmart('4999.39')).toBe('4,999.39');
    expect(rs('250000.00')).toBe('Rs. 250,000');
    expect(rs('1500.50')).toBe('Rs. 1,500.50');
  });

  it('renders a dash rather than NaN for a missing value', () => {
    expect(formatPkr(null)).toBe('—');
    expect(rs(undefined)).toBe('—');
    expect(rate(null)).toBe('—');
  });
});

describe('gram formatting', () => {
  it('uses four decimal places by default, matching the settlement precision', () => {
    expect(formatGrams('6.842')).toBe('6.8420');
    expect(formatGrams('0.1149')).toBe('0.1149');
    expect(formatGrams('100')).toBe('100.0000');
    expect(grams('0.1149')).toBe('0.1149 g');
  });

  it('groups thousands and honours an explicit precision', () => {
    expect(formatGrams('12345.6789')).toBe('12,345.6789');
    expect(formatGrams('6.8420', 3)).toBe('6.842');
  });
});

describe('rate formatting', () => {
  it('renders a PKR-per-gram rate', () => {
    expect(rate('43502.12')).toBe('Rs. 43,502.12/g');
    expect(rate('37800.00')).toBe('Rs. 37,800/g');
  });
});

describe('formatDecimal', () => {
  it('handles zero decimal places', () => {
    expect(formatDecimal('39547.38', 0)).toBe('39,547');
  });

  it('rejects junk', () => {
    expect(formatDecimal('abc', 2)).toBe('—');
    expect(formatDecimal('', 2)).toBe('—');
  });
});

describe('formatCountdown', () => {
  it('formats m:ss', () => {
    expect(formatCountdown(75)).toBe('1:15');
    expect(formatCountdown(83)).toBe('1:23');
    expect(formatCountdown(9)).toBe('0:09');
    expect(formatCountdown(60)).toBe('1:00');
  });

  it('never renders a negative clock', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-1)).toBe('0:00');
    expect(formatCountdown(-9999)).toBe('0:00');
    expect(formatCountdown(Number.NaN)).toBe('0:00');
  });
});

describe('formatAge', () => {
  it('describes freshness in human terms', () => {
    expect(formatAge(2)).toBe('just now');
    expect(formatAge(42)).toBe('42s ago');
    expect(formatAge(120)).toBe('2m ago');
    expect(formatAge(7200)).toBe('2h ago');
    expect(formatAge(null)).toBe('never refreshed');
  });
});
