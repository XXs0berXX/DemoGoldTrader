import { useMemo, useState } from 'react';
import type { ApiError } from '../api/client';
import type { QuoteRequest, Side } from '../api/types';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { ShortfallNotice, isShortfallCode } from '../components/ShortfallNotice';
import { SourceTag } from '../components/SourceTag';
import { useCountdown } from '../hooks/useCountdown';
import { floorTo, maxBuyPkr, maxSellGrams, num } from '../lib/convert';
import { evaluateEntry, type EntryMode } from '../lib/entry';
import { formatCountdown, formatGrams, formatPkrSmart, grams, rate, rs } from '../lib/format';
import { useAppData } from '../state/AppDataProvider';

const PKR_CHIPS = [5000, 10000, 25000] as const;

interface TradeEntryProps {
  side: Side;
  busy: boolean;
  /** Server rejection of the last quote attempt, if any. */
  error: ApiError | null;
  onSubmit: (req: QuoteRequest) => void;
}

export function TradeEntry({ side, busy, error, onSubmit }: TradeEntryProps): JSX.Element {
  const { price, state, tradingEnabled } = useAppData();
  const [mode, setMode] = useState<EntryMode>(side === 'BUY' ? 'PKR' : 'GRAMS');
  const [raw, setRaw] = useState('');

  const isBuy = side === 'BUY';
  const pricePerGram = num(isBuy ? price?.buy_pkr_per_gram : price?.sell_pkr_per_gram);
  const walletPkr = num(state?.balances.pkr_wallet);
  const customerGoldG = num(state?.balances.customer_gold_g);
  const platformGoldG = num(state?.balances.platform_gold_g);
  const minPkr = num(state?.limits.min_pkr) || 1000;
  const maxPkr = num(state?.limits.max_pkr) || 50000;

  const result = useMemo(
    () =>
      evaluateEntry({
        side,
        mode,
        raw,
        pricePerGram,
        walletPkr,
        customerGoldG,
        platformGoldG,
        minPkr,
        maxPkr,
      }),
    [
      side,
      mode,
      raw,
      pricePerGram,
      walletPkr,
      customerGoldG,
      platformGoldG,
      minPkr,
      maxPkr,
    ],
  );

  /* The green pill mirrors the reference screen. Its clock is the time until
     the *server* refreshes its cached market reference — a real number, not a
     decoration. The 75-second lock only starts once a quote exists. */
  const refreshAt = useMemo(() => {
    if (!price?.fetched_at) return null;
    const fetched = Date.parse(price.fetched_at);
    if (!Number.isFinite(fetched)) return null;
    const window = (price.age_seconds ?? 0) + (price.ttl_seconds ?? 300);
    return fetched + window * 1000;
  }, [price?.fetched_at, price?.age_seconds, price?.ttl_seconds]);
  const refresh = useCountdown(tradingEnabled ? refreshAt : null);

  const maxBuy = maxBuyPkr(walletPkr, platformGoldG, pricePerGram, maxPkr);
  const maxBuyGrams = pricePerGram > 0 ? floorTo(maxBuy / pricePerGram, 4) : 0;
  const maxSell = maxSellGrams(customerGoldG, pricePerGram, maxPkr);

  const errorCode = error?.code ?? null;
  const serverShortfallCode =
    errorCode !== null && isShortfallCode(errorCode) ? errorCode : null;
  const block = result.block;
  const clientShortfallCode =
    serverShortfallCode === null && block !== null && isShortfallCode(block) ? block : null;

  const pkrLabel = isBuy ? 'You pay' : 'You receive';
  const goldLabel = isBuy ? 'You receive' : 'You sell';

  const pkrIsInput = mode === 'PKR';
  const canContinue = tradingEnabled && result.canSubmit && !busy;

  function submit(): void {
    if (!result.request || !canContinue) return;
    onSubmit(result.request);
  }

  const pkrField = (
    <div className="field">
      <label className="field__label" htmlFor={pkrIsInput ? 'amount-pkr' : undefined}>
        {pkrLabel}
      </label>
      <div className="field__row">
        {pkrIsInput ? (
          <div className="field__input">
            <span className="field__prefix">Rs.</span>
            <input
              id="amount-pkr"
              className="field__control"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              aria-label={`${pkrLabel} in PKR`}
              value={raw}
              disabled={!tradingEnabled}
              onChange={(e) => setRaw(e.target.value)}
            />
          </div>
        ) : (
          <div
            className={`field__derived${result.pkr > 0 ? '' : ' field__derived--muted'}`}
            aria-label={`${pkrLabel}, converted`}
          >
            Rs. {result.pkr > 0 ? formatPkrSmart(result.pkr) : '0'}
          </div>
        )}
        <div className="field__aside">
          {isBuy ? (
            <>
              My Wallet
              <b className="num">{rs(walletPkr)}</b>
            </>
          ) : (
            <>
              Sell rate
              <b className="num">{rate(pricePerGram)}</b>
            </>
          )}
        </div>
      </div>
    </div>
  );

  const goldField = (
    <div className="field">
      <label className="field__label" htmlFor={!pkrIsInput ? 'amount-grams' : undefined}>
        {goldLabel}
      </label>
      <div className="field__row">
        {!pkrIsInput ? (
          <div className="field__input">
            <input
              id="amount-grams"
              className="field__control"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.0000"
              aria-label={`${goldLabel} in grams`}
              value={raw}
              disabled={!tradingEnabled}
              onChange={(e) => setRaw(e.target.value)}
            />
            <span className="field__suffix">g</span>
          </div>
        ) : (
          <div
            className={`field__derived${result.gramsValue > 0 ? '' : ' field__derived--muted'}`}
            aria-label={`${goldLabel}, converted`}
          >
            {result.gramsValue > 0 ? formatGrams(result.gramsValue) : '0.0000'}{' '}
            <span className="field__suffix">g</span>
          </div>
        )}
        <div className="field__aside field__aside--accent">
          {isBuy
            ? `Max buy ${formatGrams(maxBuyGrams, 3)} g`
            : `You hold ${formatGrams(customerGoldG)} g`}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="page">
        <h2 className="trade-h">
          How much gold do you want to {isBuy ? 'buy' : 'sell'}?
        </h2>

        <div className="unitrow">
          <div className="unittoggle" role="group" aria-label="Enter amount in">
            <button
              type="button"
              className="unittoggle__btn"
              aria-pressed={mode === 'PKR'}
              onClick={() => {
                setMode('PKR');
                setRaw('');
              }}
            >
              PKR
            </button>
            <button
              type="button"
              className="unittoggle__btn"
              aria-pressed={mode === 'GRAMS'}
              onClick={() => {
                setMode('GRAMS');
                setRaw('');
              }}
            >
              Grams
            </button>
          </div>

          {tradingEnabled ? (
            <span
              className="ratepill"
              title={`Server refreshes the market reference in ${formatCountdown(refresh.secondsLeft)}`}
            >
              {rate(pricePerGram)} · {formatCountdown(refresh.secondsLeft)}
            </span>
          ) : (
            <span className="ratepill ratepill--paused">Rate unavailable</span>
          )}
        </div>

        {tradingEnabled ? (
          <p className="lede" style={{ marginTop: -10, marginBottom: 4 }}>
            <SourceTag price={price} /> · rate refreshes in{' '}
            <span className="num">{formatCountdown(refresh.secondsLeft)}</span>. Your price
            is locked for 75 seconds once you continue.
          </p>
        ) : null}

        {!tradingEnabled ? (
          <Banner tone="paused" title="Trading is paused" role="alert" className="banner-mt">
            {price?.paused_reason ??
              'No price source can currently be trusted, so we will not issue a quote.'}{' '}
            Nothing here is a live price — we would rather stop than trade you at a stale
            number.
          </Banner>
        ) : null}

        {price?.guardrail_applied && isBuy ? (
          <Banner tone="guardrail" title="Guardrail price in effect" className="banner-mt">
            The market reference is implausibly low, so your buy price is floored at the{' '}
            <strong className="num">{rate(price.guardrail_pkr_per_gram)}</strong>{' '}
            guardrail rather than the spread price.
          </Banner>
        ) : null}

        <div style={{ marginTop: 8 }}>
          {isBuy ? pkrField : goldField}
          {isBuy ? goldField : pkrField}
        </div>

        <div className="limitsrow">
          <span>
            Min <b className="num">{rs(minPkr)}</b> · Max <b className="num">{rs(maxPkr)}</b>
          </span>
          <span className="limitsrow__link">Limits</span>
        </div>

        <div className="chips">
          {PKR_CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              className="chip"
              disabled={!tradingEnabled}
              aria-pressed={mode === 'PKR' && num(raw) === c}
              onClick={() => {
                setMode('PKR');
                setRaw(String(c));
              }}
            >
              {rs(c)}
            </button>
          ))}
          {!isBuy && maxSell > 0 ? (
            <button
              type="button"
              className="chip"
              disabled={!tradingEnabled}
              onClick={() => {
                setMode('GRAMS');
                setRaw(maxSell.toFixed(4));
              }}
            >
              Max {formatGrams(maxSell, 3)} g
            </button>
          ) : null}
        </div>

        {result.message ? <p className="inline-err">{result.message}</p> : null}

        {clientShortfallCode ? (
          <div className="banner-mt">
            <ShortfallNotice code={clientShortfallCode} details={result.details} />
          </div>
        ) : null}

        {serverShortfallCode && error ? (
          <div className="banner-mt">
            <ShortfallNotice
              code={serverShortfallCode}
              details={error.shortfall}
              fallbackMessage={error.message}
            />
          </div>
        ) : null}

        {error && !serverShortfallCode && error.code !== 'TRADING_PAUSED' ? (
          <Banner tone="shortfall" title="We couldn’t lock a price" role="alert" className="banner-mt">
            {error.message}
          </Banner>
        ) : null}

        {error?.code === 'TRADING_PAUSED' ? (
          <Banner tone="paused" title="Trading paused before we could quote" role="alert" className="banner-mt">
            {error.message}
          </Banner>
        ) : null}
      </div>

      <div className="page__foot">
        <Button onClick={submit} disabled={!canContinue} loading={busy}>
          {busy ? 'Locking price…' : 'Continue'}
        </Button>
        {tradingEnabled && result.canSubmit ? (
          <p className="legal" style={{ marginTop: 8 }}>
            {isBuy
              ? `You pay ${rs(result.pkr)} for about ${grams(result.gramsValue)} at ${rate(pricePerGram)}.`
              : `You sell ${grams(result.gramsValue)} for about ${rs(result.pkr)} at ${rate(pricePerGram)}.`}{' '}
            The server confirms the exact figures on the next screen.
          </p>
        ) : null}
      </div>
    </>
  );
}
