import { useCallback, useRef, useState } from 'react';
import { ApiError, api } from '../api/client';
import type { ConfirmResponse, Quote, QuoteRequest, Side } from '../api/types';
import { AppBar } from '../components/AppBar';
import { useAppData } from '../state/AppDataProvider';
import { ReviewScreen } from './ReviewScreen';
import { SuccessScreen } from './SuccessScreen';
import { TradeEntry } from './TradeEntry';

type Step = 'entry' | 'review' | 'success';

function asApiError(err: unknown): ApiError {
  return err instanceof ApiError
    ? err
    : new ApiError('UNKNOWN', 'Something went wrong. Nothing has been charged.', 0);
}

interface TradeFlowProps {
  side: Side;
  /** Leaves the flow entirely (used by "Done"). */
  onExit: () => void;
}

/**
 * The five-step journey for one side of the trade: see price → enter → review a
 * server-locked quote → confirm → receipt.
 *
 * Two guarantees live here:
 *  - **One request per confirm.** A synchronous ref gates the handler, so a
 *    double click cannot fire a second POST while the first is still open. The
 *    server's idempotency key is the real defence; this stops the UI adding to
 *    the problem.
 *  - **Never a silent re-price.** An expired quote is never swapped for a new
 *    one behind the user's back — re-quoting is always an explicit tap.
 */
export function TradeFlow({ side, onExit }: TradeFlowProps): JSX.Element {
  const { refreshAll } = useAppData();

  const [step, setStep] = useState<Step>('entry');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [result, setResult] = useState<ConfirmResponse | null>(null);
  const [lastRequest, setLastRequest] = useState<QuoteRequest | null>(null);

  const [entryError, setEntryError] = useState<ApiError | null>(null);
  const [reviewError, setReviewError] = useState<ApiError | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [requoting, setRequoting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const quoteInFlight = useRef(false);
  const confirmInFlight = useRef(false);

  const requestQuote = useCallback(
    async (req: QuoteRequest, from: 'entry' | 'review') => {
      if (quoteInFlight.current) return;
      quoteInFlight.current = true;
      if (from === 'entry') {
        setQuoting(true);
        setEntryError(null);
      } else {
        setRequoting(true);
        setReviewError(null);
      }
      try {
        const q = await api.createQuote(req);
        setQuote(q);
        setLastRequest(req);
        setReviewError(null);
        setEntryError(null);
        setStep('review');
      } catch (err) {
        const e = asApiError(err);
        if (from === 'entry') setEntryError(e);
        else setReviewError(e);
        // A paused market or a moved balance is worth re-reading the world for.
        void refreshAll();
      } finally {
        quoteInFlight.current = false;
        setQuoting(false);
        setRequoting(false);
      }
    },
    [refreshAll],
  );

  const confirm = useCallback(async () => {
    // Synchronous guard: a second click in the same tick must not reach the API.
    if (confirmInFlight.current || quote === null) return;
    confirmInFlight.current = true;
    setConfirming(true);
    setReviewError(null);
    try {
      const res = await api.confirm(quote.quote_id);
      setResult(res);
      setStep('success');
      void refreshAll();
    } catch (err) {
      setReviewError(asApiError(err));
      void refreshAll();
    } finally {
      confirmInFlight.current = false;
      setConfirming(false);
    }
  }, [quote, refreshAll]);

  const backToEntry = useCallback(() => {
    setStep('entry');
    setQuote(null);
    setReviewError(null);
  }, []);

  const requote = useCallback(() => {
    if (lastRequest) void requestQuote(lastRequest, 'review');
  }, [lastRequest, requestQuote]);

  if (step === 'success' && result) {
    return (
      <>
        <AppBar title="Success" />
        <SuccessScreen result={result} onDone={onExit} />
      </>
    );
  }

  if (step === 'review' && quote) {
    return (
      <>
        <AppBar title="Review" onBack={backToEntry} bordered />
        <ReviewScreen
          quote={quote}
          confirming={confirming}
          error={reviewError}
          onConfirm={() => void confirm()}
          onRequote={requote}
          requoting={requoting}
          onEdit={backToEntry}
        />
      </>
    );
  }

  return (
    <>
      <AppBar title={side === 'BUY' ? 'Buy Gold' : 'Sell Gold'} />
      <TradeEntry
        side={side}
        busy={quoting}
        error={entryError}
        onSubmit={(req) => void requestQuote(req, 'entry')}
        onClearError={() => setEntryError(null)}
      />
    </>
  );
}
