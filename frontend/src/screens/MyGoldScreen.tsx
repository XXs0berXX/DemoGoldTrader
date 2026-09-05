import { num } from '../lib/convert';
import { formatGrams, formatTimestamp, grams, rate, rs } from '../lib/format';
import { useAppData } from '../state/AppDataProvider';

export function MyGoldScreen(): JSX.Element {
  const { state, price, tradingEnabled } = useAppData();
  const goldG = num(state?.balances.customer_gold_g);
  const sellPrice = num(price?.sell_pkr_per_gram);
  const value = tradingEnabled && sellPrice > 0 ? goldG * sellPrice : null;
  const trades = state?.trades ?? [];

  return (
    <div className="page">
      <section className="hero" aria-label="Gold holdings">
        <p className="hero__eyebrow">My gold</p>
        <div className="hero__amount num">
          {state ? formatGrams(state.balances.customer_gold_g, 4) : '—'}
          <span className="hero__unit">grams 24K</span>
        </div>
        <p className="hero__sub">
          {value !== null ? (
            <>
              Worth <strong className="num">{rs(value)}</strong> at today’s sell rate of{' '}
              {rate(sellPrice)}
            </>
          ) : (
            <>Valuation paused — no trusted rate right now</>
          )}
        </p>
        <div className="hero__divider" />
        <div className="hero__row">
          <div>
            <p className="hero__eyebrow">Platform inventory</p>
            <div className="hero__wallet num">
              {state ? formatGrams(state.balances.platform_gold_g, 4) : '—'}
            </div>
            <p className="hero__note">Gold Asasa can still sell you</p>
          </div>
        </div>
      </section>

      <h3 className="section-h">Activity</h3>
      <p className="lede" style={{ marginTop: -6, marginBottom: 10 }}>
        Every settled trade, newest first. This is the append-only ledger — re-seeding
        balances from Demo controls does not remove anything from it.
      </p>

      <div className="card card--flat">
        {trades.length === 0 ? (
          <p className="empty">No trades yet. Buy or sell gold and the receipt lands here.</p>
        ) : (
          trades.map((t) => (
            <div className="tradeitem" key={t.id}>
              <span
                className={`tradeitem__badge tradeitem__badge--${t.side === 'BUY' ? 'buy' : 'sell'}`}
              >
                {t.side === 'BUY' ? 'BUY' : 'SELL'}
              </span>
              <div className="tradeitem__main">
                <div className="tradeitem__t num">{grams(t.grams)}</div>
                <div className="tradeitem__s">
                  {formatTimestamp(t.created_at)} · {rate(t.locked_price)} · {t.price_source}
                  {t.guardrail_applied ? ' · guardrail' : ''}
                </div>
              </div>
              <div className="tradeitem__amt">
                {t.side === 'BUY' ? '−' : '+'}
                {rs(t.pkr_amount)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
