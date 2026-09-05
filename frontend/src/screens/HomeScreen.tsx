import { Banner } from '../components/Banner';
import { RateChart } from '../components/RateChart';
import { FreshnessLine, SourceTag } from '../components/SourceTag';
import {
  BuyGoldIcon,
  EyeOffIcon,
  InfoIcon,
  SellGoldIcon,
  TopUpIcon,
  WithdrawIcon,
} from '../components/icons';
import { num } from '../lib/convert';
import { formatGrams, grams, rate, rs } from '../lib/format';
import { useAppData } from '../state/AppDataProvider';
import type { TabId } from '../components/TabBar';

function greeting(now: number): string {
  const h = new Date(now).getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

interface HomeScreenProps {
  onNavigate: (tab: TabId) => void;
}

export function HomeScreen({ onNavigate }: HomeScreenProps): JSX.Element {
  const { price, state, tradingEnabled, now, connectionError } = useAppData();

  const balances = state?.balances;
  const goldG = num(balances?.customer_gold_g);
  const sellPrice = num(price?.sell_pkr_per_gram);
  const holdingsValue = tradingEnabled && sellPrice > 0 ? goldG * sellPrice : null;

  return (
    <div className="page">
      <p className="section-h" style={{ marginTop: 4, marginBottom: 2, fontSize: 17 }}>
        {greeting(now)}
      </p>
      {/* Requirement: the first load has to explain itself without a README. */}
      <p className="lede">
        Shared demo — one wallet and one gold balance for everyone, no sign-in. Rates are
        live 24K, priced server-side.
      </p>

      {connectionError ? (
        <Banner tone="paused" title="Can’t reach the server" role="alert" className="banner-mt">
          {connectionError}
        </Banner>
      ) : null}

      {/* ------------------------------------------------------------ hero -- */}
      <section className="hero" aria-label="Your balances">
        <div className="hero__row">
          <div>
            <p className="hero__eyebrow">My gold</p>
            <div className="hero__amount num">
              {balances ? formatGrams(balances.customer_gold_g, 3) : '—'}
              <span className="hero__unit">grams</span>
            </div>
          </div>
          <div className="hero__icons">
            <span className="hero__iconbtn" aria-hidden="true">
              <InfoIcon />
            </span>
            <span className="hero__iconbtn" aria-hidden="true">
              <EyeOffIcon />
            </span>
          </div>
        </div>

        <p className="hero__sub">
          {holdingsValue !== null ? (
            <>
              Current value: <strong className="num">{rs(holdingsValue)}</strong>
              <span>at today’s sell rate</span>
            </>
          ) : (
            <>Current value unavailable — no trusted rate right now</>
          )}
        </p>

        <div className="hero__divider" />

        <div className="hero__row">
          <div>
            <p className="hero__eyebrow">My wallet</p>
            <div className="hero__wallet num">
              {balances ? rs(balances.pkr_wallet) : '—'}
            </div>
            <p className="hero__note">Available to save in gold</p>
          </div>
          <button
            type="button"
            className="hero__links"
            onClick={() => onNavigate('mygold')}
            style={{ background: 'none' }}
          >
            View Activity
          </button>
        </div>
      </section>

      <p className="lede" style={{ marginTop: 10 }}>
        Platform inventory:{' '}
        <strong className="num">
          {balances ? grams(balances.platform_gold_g) : '—'}
        </strong>{' '}
        available to sell you.
      </p>

      {/* --------------------------------------------------- quick actions -- */}
      <div className="quickactions">
        <button
          type="button"
          className="quickaction"
          onClick={() => onNavigate('buy')}
          disabled={!tradingEnabled}
        >
          <span className="quickaction__icon">
            <BuyGoldIcon />
          </span>
          Buy Gold
        </button>
        <button
          type="button"
          className="quickaction"
          onClick={() => onNavigate('sell')}
          disabled={!tradingEnabled}
        >
          <span className="quickaction__icon">
            <SellGoldIcon />
          </span>
          Sell Gold
        </button>
        <button type="button" className="quickaction" onClick={() => onNavigate('wallet')}>
          <span className="quickaction__icon">
            <TopUpIcon />
          </span>
          Top Up
        </button>
        <button type="button" className="quickaction" onClick={() => onNavigate('wallet')}>
          <span className="quickaction__icon">
            <WithdrawIcon />
          </span>
          Withdraw
        </button>
      </div>

      {/* ------------------------------------------------------ rate block -- */}
      <section className="rateblock" aria-label="Live gold rate">
        <div className="rateblock__top">
          <span className="rateblock__price num">
            {price?.market_pkr_per_gram ? rs(price.market_pkr_per_gram) : 'Rate paused'}
          </span>
          <span className="rateblock__unit">PKR / g · 24K market</span>
        </div>

        <div className="rateblock__meta">
          <FreshnessLine price={price} now={now} />
          <SourceTag price={price} />
        </div>

        {price && price.freshness === 'UNAVAILABLE' ? (
          <Banner
            tone="paused"
            title="Trading is paused"
            role="alert"
            className="banner-mt"
          >
            {price.paused_reason ??
              'No price source can currently be trusted, so no rate is being shown.'}{' '}
            We would rather show you nothing than show you a stale number as if it were
            live.
          </Banner>
        ) : (
          <>
            <div className="ratesplit">
              <div className="ratesplit__cell">
                <p className="ratesplit__label">You buy at</p>
                <p className="ratesplit__value num">{rate(price?.buy_pkr_per_gram)}</p>
              </div>
              <div className="ratesplit__cell">
                <p className="ratesplit__label">You sell at</p>
                <p className="ratesplit__value num">{rate(price?.sell_pkr_per_gram)}</p>
              </div>
            </div>
            <p className="lede" style={{ marginTop: 8 }}>
              Buy adds a 10% spread over market; sell takes 10% off. The market reference
              above is shown for transparency and is not itself tradeable.
            </p>
          </>
        )}

        {price?.guardrail_applied ? (
          <Banner tone="guardrail" title="Guardrail is holding the buy price" className="banner-mt">
            The market reference came in below the{' '}
            <strong className="num">{rate(price.guardrail_pkr_per_gram)}</strong> floor, so
            the buy price is set to the guardrail instead of the spread price.
          </Banner>
        ) : null}

        <RateChart />
      </section>
    </div>
  );
}
