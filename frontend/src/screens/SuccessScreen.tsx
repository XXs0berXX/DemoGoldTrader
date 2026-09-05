import type { ConfirmResponse } from '../api/types';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Confetti } from '../components/Confetti';
import { CheckIcon } from '../components/icons';
import { formatTimestamp, grams, rate, rs } from '../lib/format';

interface SuccessScreenProps {
  result: ConfirmResponse;
  onDone: () => void;
}

/**
 * The receipt. Reads as a financial document: itemised, calm, and explicit
 * about the things a customer could otherwise only guess at — which source
 * priced it, whether the guardrail bound, and which way the rounding went.
 */
export function SuccessScreen({ result, onDone }: SuccessScreenProps): JSX.Element {
  const { receipt, balances, duplicate } = result;
  const isBuy = receipt.side === 'BUY';

  return (
    <>
      <div className="page">
        <div className="success">
          <Confetti />
          <span className="success__badge">
            <CheckIcon size={40} />
          </span>
          <h2 className="success__title">{isBuy ? 'Gold purchased' : 'Gold sold'}</h2>
          <p className="success__sub">
            Settled {formatTimestamp(receipt.settled_at)}
          </p>

          {duplicate ? (
            <div className="dupnote" role="status">
              <strong>This order was already settled.</strong> You pressed Confirm more than
              once — we returned the original receipt instead of trading twice. Order{' '}
              <span className="num">{receipt.order_id}</span> exists exactly once in the
              ledger.
            </div>
          ) : null}

          <section className="receipt" aria-label="Order receipt">
            <h3 className="receipt__title">Order receipt</h3>
            <div className="card card--flat">
              <div className="kv">
                <span className="kv__k">Order ID</span>
                <span className="kv__v num">{receipt.order_id}</span>
              </div>
              <div className="kv">
                <span className="kv__k">{isBuy ? 'Gold bought' : 'Gold sold'}</span>
                <span className="kv__v num">{grams(receipt.grams)}</span>
              </div>
              <div className="kv">
                <span className="kv__k">Rate</span>
                <span className="kv__v num">{rate(receipt.locked_price_pkr_per_gram)}</span>
              </div>
              <div className="kv">
                <span className="kv__k">Market reference</span>
                <span className="kv__v num">
                  {rate(receipt.market_reference)}
                  <span style={{ fontWeight: 500, color: 'var(--ink-400)' }}>
                    {' '}
                    · {receipt.price_source}
                  </span>
                </span>
              </div>
              {receipt.guardrail_applied ? (
                <div className="kv">
                  <span className="kv__k">Guardrail</span>
                  <span className="kv__v" style={{ color: 'var(--primary-700)' }}>
                    Applied — price floored at the guardrail
                  </span>
                </div>
              ) : null}
              <div className="kv row--paid">
                <span className="kv__k row__label">{isBuy ? 'Paid' : 'Received'}</span>
                <span className="kv__v row__value num">{rs(receipt.pkr_amount)}</span>
              </div>
            </div>

            <p className="receipt__note">{receipt.rounding_note}</p>

            <h3 className="receipt__title" style={{ marginTop: 24 }}>
              Updated balances
            </h3>
            <div className="card card--flat">
              <div className="kv">
                <span className="kv__k">My wallet</span>
                <span className="kv__v num">{rs(balances.pkr_wallet)}</span>
              </div>
              <div className="kv">
                <span className="kv__k">My gold</span>
                <span className="kv__v num">{grams(balances.customer_gold_g)}</span>
              </div>
              <div className="kv">
                <span className="kv__k">Platform inventory</span>
                <span className="kv__v num">{grams(balances.platform_gold_g)}</span>
              </div>
            </div>

            {receipt.guardrail_applied ? (
              <Banner tone="guardrail" title="Guardrail applied" className="banner-mt">
                This trade priced at the guardrail floor rather than the market spread,
                because the market reference was implausibly low.
              </Banner>
            ) : null}

            <p className="receipt__note">
              Your gold is held in insured custody. This receipt is a rendering of an
              immutable ledger row — trade{' '}
              <span className="num">{receipt.trade_id}</span>.
            </p>
          </section>
        </div>
      </div>

      <div className="page__foot">
        <Button onClick={onDone}>Done</Button>
      </div>
    </>
  );
}
