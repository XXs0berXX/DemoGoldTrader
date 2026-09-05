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
 * `INSUFFICIENT_INVENTORY` is deliberately worded as the platform running out
 * of gold, not as something the customer did wrong — it is our constraint, and
 * saying otherwise would be dishonest.
 *
 * Used by both the pre-quote client check and the server error path, so the two
 * can never drift apart.
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
    <Banner tone="shortfall" title="We’re out of gold to sell right now" role="alert">
      {haveNumbers ? (
        <>
          Asasa’s inventory holds <strong className="num">{grams(available)}</strong>, and
          this order needs <strong className="num">{grams(required)}</strong> — we are{' '}
          <strong className="num">{grams(shortfall)}</strong> short. This is our limit, not
          yours; a smaller order will go through.
        </>
      ) : (
        (fallbackMessage ??
          'Asasa does not currently hold enough gold to fill this order. This is our limit, not yours.')
      )}
    </Banner>
  );
}
