import { useState } from 'react';
import { api } from '../api/client';
import type { Scenario, SourceFailureMode } from '../api/types';
import { num } from '../lib/convert';
import { rate, rs } from '../lib/format';
import { useAppData } from '../state/AppDataProvider';
import { Banner } from './Banner';
import { Button } from './Button';
import { Sheet } from './Sheet';

const SOURCE_MODES: ReadonlyArray<{
  mode: SourceFailureMode;
  label: string;
  hint: string;
}> = [
  { mode: 'none', label: 'Both sources live', hint: 'Normal operation' },
  {
    mode: 'primary',
    label: 'Primary fails',
    hint: 'pakgold down → falls back to goldprice',
  },
  {
    mode: 'both',
    label: 'Both fail',
    hint: 'No trusted price → trading pauses',
  },
];

const SCENARIOS: ReadonlyArray<{ id: Scenario; label: string; hint: string }> = [
  { id: 'normal', label: 'Normal', hint: 'Rs. 250,000 · 6.8420 g · 100 g inventory' },
  { id: 'low_cash', label: 'Low cash', hint: 'Wallet Rs. 1,500 — buys fail' },
  { id: 'low_gold', label: 'Low gold', hint: 'You hold 0.0500 g — sells fail' },
  {
    id: 'low_inventory',
    label: 'Low inventory',
    hint: 'Platform holds 0.0500 g — buys fail',
  },
];

interface DemoPanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Reviewer stress controls.
 *
 * The brief requires that every failure case — including the guardrail — can be
 * triggered from the deployed product without touching code. This panel is
 * deliberately styled as an out-of-band tool rather than part of the trading UI,
 * and each control says in plain words what it will do.
 */
export function DemoPanel({ open, onClose }: DemoPanelProps): JSX.Element {
  const { demo, price, state, refreshAll } = useAppData();
  const [pending, setPending] = useState<string | null>(null);
  const [guardrailInput, setGuardrailInput] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<unknown>): Promise<void> {
    setPending(key);
    setFailure(null);
    try {
      await fn();
      await refreshAll();
    } catch {
      setFailure('That control did not apply. The demo API may be unavailable.');
    } finally {
      setPending(null);
    }
  }

  // One tap that is guaranteed to make the guardrail bind: set the floor above
  // the current buy price so the reviewer sees `guardrail_applied` flip without
  // having to work out a number.
  const buyPrice = num(price?.buy_pkr_per_gram);
  const bindingGuardrail = buyPrice > 0 ? Math.ceil((buyPrice * 1.15) / 100) * 100 : 60000;

  const currentMode = demo?.source_failure_mode ?? 'none';
  const override = demo?.guardrail_override ?? null;
  const scenario = demo?.scenario ?? state?.scenario ?? 'normal';

  return (
    <Sheet
      open={open}
      title="Demo controls"
      subtitle="Not part of the product — a reviewer harness for triggering each failure case."
      onClose={onClose}
    >
      <Banner tone="demo">
        These controls change server-side demo state (Redis), not the trading code. Balances
        re-seed; the trade ledger is append-only and is never deleted.
      </Banner>

      <div className="demostatus" style={{ marginTop: 12 }}>
        <span className={`tag${currentMode !== 'none' ? ' tag--on' : ''}`}>
          sources: {currentMode}
        </span>
        <span className={`tag${override ? ' tag--on' : ''}`}>
          guardrail: {override ? rate(override) : 'default'}
        </span>
        <span className={`tag${scenario !== 'normal' ? ' tag--on' : ''}`}>
          scenario: {scenario}
        </span>
        <span className={`tag${price?.freshness === 'LIVE' ? '' : ' tag--on'}`}>
          {price?.freshness === 'LIVE' ? `live via ${price.source}` : 'trading paused'}
        </span>
        {price?.guardrail_applied ? <span className="tag tag--on">guardrail binding</span> : null}
      </div>

      {failure ? (
        <Banner tone="shortfall" role="alert" className="banner-mt">
          {failure}
        </Banner>
      ) : null}

      {/* ------------------------------------------------------- sources -- */}
      <section className="demogroup">
        <h3 className="demogroup__t">Price sources</h3>
        <p className="demogroup__d">
          Forces the upstream fetch to fail and flushes the cached price, so the effect is
          immediate. With both down there is no trustworthy reference, so quoting and
          settlement stop.
        </p>
        <div className="optgrid">
          {SOURCE_MODES.map((s) => (
            <button
              key={s.mode}
              type="button"
              className="opt"
              aria-pressed={currentMode === s.mode}
              disabled={pending !== null}
              onClick={() => void run(`src-${s.mode}`, () => api.demo.setSourceFailure(s.mode))}
            >
              {pending === `src-${s.mode}` ? 'Applying…' : s.label}
              <small>{s.hint}</small>
            </button>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------- guardrail -- */}
      <section className="demogroup">
        <h3 className="demogroup__t">Guardrail floor</h3>
        <p className="demogroup__d">
          The buy price is <code>max(market × 1.10, guardrail)</code>. Raise the floor above
          the current buy price of{' '}
          <strong className="num">{rate(price?.buy_pkr_per_gram)}</strong> and it binds —
          the price stops moving with the market and the UI says the guardrail is in effect.
        </p>
        <div className="optgrid">
          <button
            type="button"
            className="opt"
            disabled={pending !== null}
            onClick={() =>
              void run('gr-bind', () => api.demo.setGuardrail(String(bindingGuardrail)))
            }
          >
            {pending === 'gr-bind' ? 'Applying…' : 'Force guardrail to bind'}
            <small>Sets the floor to {rs(bindingGuardrail)}/g</small>
          </button>
          <button
            type="button"
            className="opt"
            aria-pressed={override === null}
            disabled={pending !== null}
            onClick={() => void run('gr-reset', () => api.demo.resetGuardrail())}
          >
            {pending === 'gr-reset' ? 'Resetting…' : 'Reset guardrail'}
            <small>Back to the configured default</small>
          </button>
        </div>
        <div className="guardrail-inline">
          <input
            aria-label="Guardrail PKR per gram"
            inputMode="decimal"
            placeholder="Custom PKR/g"
            value={guardrailInput}
            onChange={(e) => setGuardrailInput(e.target.value)}
          />
          <Button
            variant="quiet"
            compact
            disabled={pending !== null || guardrailInput.trim() === ''}
            onClick={() =>
              void run('gr-set', () => api.demo.setGuardrail(guardrailInput.trim()))
            }
          >
            Apply
          </Button>
        </div>
      </section>

      {/* ------------------------------------------------------ scenario -- */}
      <section className="demogroup">
        <h3 className="demogroup__t">Balance scenario</h3>
        <p className="demogroup__d">
          Re-seeds the three balances so each insufficiency case can be reached in one
          trade. Any active quote is cleared. Trade history is untouched.
        </p>
        <div className="optgrid">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="opt"
              aria-pressed={scenario === s.id}
              disabled={pending !== null}
              onClick={() => void run(`sc-${s.id}`, () => api.demo.setScenario(s.id))}
            >
              {pending === `sc-${s.id}` ? 'Re-seeding…' : s.label}
              <small>{s.hint}</small>
            </button>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------- no controls -- */}
      <section className="demogroup">
        <h3 className="demogroup__t">Cases that need no control</h3>
        <p className="demogroup__d">
          <strong>Quote expiry:</strong> start a trade and let the 75-second countdown run
          out on the Review screen. <br />
          <strong>Double confirm:</strong> press Confirm twice quickly — the second press is
          blocked in the UI, and the server’s idempotency key returns the same receipt if it
          ever gets through.
        </p>
      </section>
    </Sheet>
  );
}
