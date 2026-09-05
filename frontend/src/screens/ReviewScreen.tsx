import type { ApiError } from '../api/client';
import type { Quote } from '../api/types';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { ShortfallNotice, isShortfallCode } from '../components/ShortfallNotice';
import { ClockIcon, WalletIcon } from '../components/icons';
import { useCountdown } from '../hooks/useCountdown';
import { num } from '../lib/convert';
import { URGENT_SECONDS } from '../lib/countdown';
import { formatCountdown, grams, rate, rs } from '../lib/format';
import { useAppData } from '../state/AppDataProvider';

interface ReviewScreenProps {
  quote: Quote;
  confirming: boolean;
  error: ApiError | null;
  /** Set when the server rejected the confirm with 410, or the clock ran out here. */
  onConfirm: () => void;
  onRequote: () => void;
  requoting: boolean;
  onEdit: () => void;
}

export function ReviewScreen({
  quote,
  confirming,
  error,
  onConfirm,
  onRequote,
  requoting,
  onEdit,
}: ReviewScreenProps): JSX.Element {
  const { state } = useAppData();
  const { secondsLeft, expired, fraction } = useCountdown(quote.expires_at, quote.issued_at);

  const isBuy = quote.side === 'BUY';
  const urgent = !expired && secondsLeft <= URGENT_SECONDS;

  // The server is the authority on expiry; this is a display of it. A 410 on
  // confirm lands in the same state, so clock skew cannot strand the user.
  const serverExpired = error?.code === 'QUOTE_EXPIRED';
  const isExpired = expired || serverExpired;

  const walletBefore = num(state?.balances.pkr_wallet);
  const walletAfter = num(quote.balances_after.pkr_wallet);
  const walletFraction =
    walletBefore > 0 ? Math.max(0, Math.min(1, walletAfter / walletBefore)) : 1;

  const errorCode = error?.code ?? null;
  const shortfallCode = errorCode !== null && isShortfallCode(errorCode) ? errorCode : null;

  const clockClass = isExpired ? 'summary__lock--expired' : urgent ? 'summary__lock--urgent' : '';
  const pillClass = isExpired
    ? 'ratepill ratepill--expired'
    : urgent
      ? 'ratepill ratepill--urgent'
      : 'ratepill';

  return (
    <>
      <div className="page">
        {/* ------------------------------------------------------ balance -- */}
        <section className="balancebar" aria-label="Balance after this trade">
          <span className="balancebar__icon">
            <WalletIcon size={21} />
          </span>
          <div style={{ flex: '1 1 auto' }}>
            <div className="balancebar__title">Balance</div>
            <div className="balancebar__sub num">
              {rs(quote.balances_after.pkr_wallet)} left after
            </div>
            <div className="meter">
              <div
                className="meter__fill"
                style={{ width: `${Math.round(walletFraction * 100)}%` }}
              />
            </div>
            <div className="balancebar__sub" style={{ marginTop: 6 }}>
              Gold after: <span className="num">{grams(quote.balances_after.customer_gold_g)}</span>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------ summary -- */}
        <section className="summary" aria-label="Order summary">
          <div className="summary__head">
            <h2 className="summary__title">Summary</h2>
            <span className={pillClass}>
              {rate(quote.locked_price_pkr_per_gram)} ·{' '}
              {isExpired ? 'expired' : formatCountdown(secondsLeft)}
            </span>
          </div>

          {/* Announced politely so a screen-reader user is not spammed each tick. */}
          <p className={`summary__lock ${clockClass}`} role="status" aria-live="polite">
            {isExpired ? (
              <>This price is no longer locked.</>
            ) : (
              <>
                Price locked for{' '}
                <span className="num">{formatCountdown(secondsLeft)}</span> — the server
                holds it until{' '}
                {new Date(quote.expires_at).toLocaleTimeString('en-GB', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
                .
              </>
            )}
          </p>
          <div className="meter" aria-hidden="true">
            <div
              className="meter__fill"
              style={{
                width: `${Math.round(fraction * 100)}%`,
                background: urgent ? '#f6c343' : undefined,
              }}
            />
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="row">
              <span className="row__label">{isBuy ? 'Gold to receive' : 'Gold to sell'}</span>
              <span className="row__value num">{grams(quote.grams)}</span>
            </div>
            <div className="row">
              <span className="row__label">Locked rate</span>
              <span className="row__value num">{rate(quote.locked_price_pkr_per_gram)}</span>
            </div>
            <div className="row">
              <span className="row__label">Market reference</span>
              <span className="row__value num">
                {rate(quote.market_reference)}
                <span style={{ fontWeight: 500, color: 'var(--ink-400)' }}>
                  {' '}
                  · {quote.source}
                </span>
              </span>
            </div>
            {quote.guardrail_applied ? (
              <div className="row">
                <span className="row__label">Guardrail</span>
                <span className="row__value" style={{ color: 'var(--primary-700)' }}>
                  Applied
                </span>
              </div>
            ) : null}
            <div className="row row--total">
              <span className="row__label">{isBuy ? 'Total' : 'You receive'}</span>
              <span className="row__value num">{rs(quote.pkr_amount)}</span>
            </div>
          </div>

          {quote.guardrail_applied ? (
            <Banner tone="guardrail" title="Guardrail applied to this price" className="banner-mt">
              The market reference came in below the guardrail floor, so this quote is
              locked at the guardrail price rather than the spread price.
            </Banner>
          ) : null}

          {/* ---------------------------------------------------- expired -- */}
          {isExpired ? (
            <div className="expired" role="alert">
              <span className="expired__icon">
                <ClockIcon size={24} />
              </span>
              <h3 className="expired__title">This quote expired</h3>
              <p className="expired__body">
                The 75-second price lock ran out, so we will not settle at{' '}
                {rate(quote.locked_price_pkr_per_gram)}. Nothing has been charged and no
                gold has moved. Get a fresh quote for the same amount and the current price
                will be locked again.
              </p>
              <Button onClick={onRequote} loading={requoting}>
                Get a fresh quote
              </Button>
              <button
                type="button"
                className="limitsrow__link"
                style={{ marginTop: 14 }}
                onClick={onEdit}
              >
                Change the amount instead
              </button>
            </div>
          ) : null}

          {shortfallCode && error ? (
            <div className="banner-mt">
              <ShortfallNotice
                code={shortfallCode}
                details={error.shortfall}
                fallbackMessage={error.message}
              />
              <div style={{ marginTop: 12 }}>
                <Button variant="quiet" onClick={onEdit}>
                  Change the amount
                </Button>
              </div>
            </div>
          ) : null}

          {error?.code === 'TRADING_PAUSED' ? (
            <Banner tone="paused" title="Trading paused before this settled" role="alert" className="banner-mt">
              {error.message} Your quote was not settled and nothing has moved. Once a price
              source is trusted again you can quote afresh.
            </Banner>
          ) : null}

          {error?.code === 'QUOTE_NOT_FOUND' ? (
            <Banner tone="paused" title="We couldn’t find that quote" role="alert" className="banner-mt">
              {error.message} It may have been replaced by a newer quote in this session.
              Start again from the amount.
            </Banner>
          ) : null}

          {error && !shortfallCode && !serverExpired &&
          error.code !== 'TRADING_PAUSED' &&
          error.code !== 'QUOTE_NOT_FOUND' ? (
            <Banner tone="shortfall" title="That didn’t go through" role="alert" className="banner-mt">
              {error.message} Nothing has been charged.
            </Banner>
          ) : null}

          <p className="legal">
            By confirming, you agree to {isBuy ? 'buy' : 'sell'} 24K physical gold at the
            displayed price. Settlement is atomic — it either completes in full or not at
            all.
          </p>
        </section>
      </div>

      <div className="page__foot">
        {isExpired ? (
          <Button variant="quiet" onClick={onRequote} loading={requoting}>
            Get a fresh quote
          </Button>
        ) : (
          <Button onClick={onConfirm} disabled={confirming} loading={confirming}>
            {confirming ? 'Settling…' : `Confirm · ${rs(quote.pkr_amount)}`}
          </Button>
        )}
      </div>
    </>
  );
}
