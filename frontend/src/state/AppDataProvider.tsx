import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, api } from '../api/client';
import type { DemoStatus, PriceResponse, StateResponse } from '../api/types';

/** How often the client re-reads `/api/price`.
 *
 * The server caches upstream for 300s, so this poll is cheap — it exists so
 * freshness, the selected source, and the trading-paused flag are never more
 * than a few seconds out of date on screen. */
const PRICE_POLL_MS = 15_000;
/** Drives the "Updated 2m ago" text between polls. */
const CLOCK_TICK_MS = 1_000;

/** One observed market reference, sampled by this page's own polling. */
export interface PricePoint {
  /** `fetched_at` of the sample, as epoch ms. */
  t: number;
  /** Market reference, PKR per gram. */
  value: number;
}

/** Keep the session chart bounded. */
const MAX_HISTORY = 40;

export interface AppData {
  price: PriceResponse | null;
  state: StateResponse | null;
  demo: DemoStatus | null;
  /** Market references observed since this page was opened. Never fabricated. */
  history: PricePoint[];
  /** Set when the API itself is unreachable — distinct from a paused market. */
  connectionError: string | null;
  /** First load of price + state has settled (either way). */
  ready: boolean;
  /** Live server clock reference, ticking once a second for relative times. */
  now: number;
  /** True only when the server says we may quote. */
  tradingEnabled: boolean;
  refreshPrice: () => Promise<void>;
  refreshState: () => Promise<void>;
  refreshDemo: () => Promise<void>;
  refreshAll: () => Promise<void>;
}

const AppDataContext = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }): JSX.Element {
  const [price, setPrice] = useState<PriceResponse | null>(null);
  const [state, setState] = useState<StateResponse | null>(null);
  const [demo, setDemo] = useState<DemoStatus | null>(null);
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshPrice = useCallback(async () => {
    try {
      const p = await api.getPrice();
      if (!mounted.current) return;
      setPrice(p);
      setConnectionError(null);

      // Record the sample only when the server actually refreshed upstream, so
      // the session chart plots distinct observations rather than one repeated
      // cached value.
      const value = Number(p.market_pkr_per_gram);
      const t = p.fetched_at ? Date.parse(p.fetched_at) : NaN;
      if (p.freshness === 'LIVE' && Number.isFinite(value) && Number.isFinite(t)) {
        setHistory((prev) =>
          prev.length && prev[prev.length - 1]?.t === t
            ? prev
            : [...prev, { t, value }].slice(-MAX_HISTORY),
        );
      }
    } catch (err) {
      if (!mounted.current) return;
      // A network failure is an app-level problem; a paused market is not. Only
      // the former clears the last known price display.
      if (err instanceof ApiError && err.code === 'NETWORK') {
        setConnectionError(err.message);
      }
    }
  }, []);

  const refreshState = useCallback(async () => {
    try {
      const s = await api.getState();
      if (!mounted.current) return;
      setState(s);
      setConnectionError(null);
    } catch (err) {
      if (!mounted.current) return;
      if (err instanceof ApiError && err.code === 'NETWORK') {
        setConnectionError(err.message);
      }
    }
  }, []);

  const refreshDemo = useCallback(async () => {
    try {
      const d = await api.demo.getStatus();
      if (mounted.current) setDemo(d);
    } catch {
      /* the demo panel is non-essential; never let it break the trading UI */
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshPrice(), refreshState(), refreshDemo()]);
  }, [refreshPrice, refreshState, refreshDemo]);

  // Initial load.
  useEffect(() => {
    void (async () => {
      await Promise.all([refreshPrice(), refreshState(), refreshDemo()]);
      if (mounted.current) setReady(true);
    })();
  }, [refreshPrice, refreshState, refreshDemo]);

  // Price poll + refresh on refocus, so a tab left open does not show a rate
  // that silently went stale while it was in the background.
  useEffect(() => {
    const id = window.setInterval(() => void refreshPrice(), PRICE_POLL_MS);
    const onFocus = () => void refreshPrice();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshPrice]);

  // Relative-time clock.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const value = useMemo<AppData>(
    () => ({
      price,
      state,
      demo,
      history,
      connectionError,
      ready,
      now,
      tradingEnabled: price?.trading_enabled === true && price.freshness === 'LIVE',
      refreshPrice,
      refreshState,
      refreshDemo,
      refreshAll,
    }),
    [
      price,
      state,
      demo,
      history,
      connectionError,
      ready,
      now,
      refreshPrice,
      refreshState,
      refreshDemo,
      refreshAll,
    ],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppData {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used inside <AppDataProvider>');
  return ctx;
}
