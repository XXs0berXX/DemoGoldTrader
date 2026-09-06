import type { ApiErrorCode, ShortfallDetails } from '../api/types';
import { grams, rs } from '../lib/format';
import { Banner } from './Banner';

export type ShortfallCode =
  | 'INSUFFICIENT_PKR'
  | 'INSUFFICIENT_GOLD'
  | 'INSUFFICIENT_INVENTORY';

export function isShortfallCode(code: ApiErrorCode): code is ShortfallCode {
  return (
    code === 'INSUFFICIENT_PKR' ||
    code === 'INSUFFICIENT_GOLD' ||
    code === 'INSUFFICIENT_INVENTORY'
  );
}

interface ShortfallNoticeProps {
  code: ShortfallCode;
  details: ShortfallDetails;
  /** The server's own sentence, shown when we have no numbers to be specific with. */
  fallbackMessage?: string;
}

/**
 * The three insufficiency states, each rendered with the **actual shortfall**
 * rather than a generic failure.
 *
 * `INSUFFICIENT_INVENTORY` is deliberately worded as the platform being unable
 * to source the gold, not as something the customer did wrong — it is our
 * constraint, and saying otherwise would be dishonest. It is also the only one
 * of the three that is worth retrying unchanged, so the copy says so.
 *
 * Every one of these arrives from the server. The client does not predict them.
 */
export function ShortfallNotice({
  code,
  details,
  fallbackMessage,
}: ShortfallNoticeProps): JSX.Element {
  const { required, available, shortfall } = details;
  const haveNumbers = Boolean(required && available && shortfall);

  if (code === 'INSUFFICIENT_PKR') {
    return (
      <Banner tone="shortfall" title="Your wallet is short" role="alert">
        {haveNumbers ? (
          <>
            This trade needs <strong className="num">{rs(required)}</strong> but your
            wallet holds <strong className="num">{rs(available)}</strong> — you are{' '}
            <strong className="num">{rs(shortfall)}</strong> short. Lower the amount or
            top up.
          </>
        ) : (
          (fallbackMessage ?? 'Your wallet does not hold enough PKR for this trade.')
        )}
      </Banner>
    );
  }

  if (code === 'INSUFFICIENT_GOLD') {
    return (
      <Banner tone="shortfall" title="You don’t hold that much gold" role="alert">
        {haveNumbers ? (
          <>
            This sale needs <strong className="num">{grams(required)}</strong> but you hold{' '}
            <strong className="num">{grams(available)}</strong> — you are{' '}
            <strong className="num">{grams(shortfall)}</strong> short. Sell a smaller
            amount.
          </>
        ) : (
          (fallbackMessage ?? 'You do not hold enough gold for this sale.')
        )}
      </Banner>
    );
  }

  return (
    <Banner tone="shortfall" title="We can’t source that much gold right now" role="alert">
      We’re unable to procure gold at this moment due to demand — please try again in a
      bit. This is our limit, not yours, so nothing is wrong with your order.
      {haveNumbers ? (
        <span className="banner__detail">
          Available now <strong className="num">{grams(available)}</strong> · this order
          needs <strong className="num">{grams(required)}</strong> · short by{' '}
          <strong className="num">{grams(shortfall)}</strong>. A smaller order will go
          through immediately.
        </span>
      ) : null}
    </Banner>
  );
}
