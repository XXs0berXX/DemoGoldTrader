import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { HISTORY_RANGES, type HistoryRange, type HistorySeries } from '../api/types';
import { rs } from '../lib/format';

const W = 320;
const H = 74;
const PAD_Y = 8;

/**
 * The market-reference chart.
 *
 * The series is real history from GoldPrice.org, normalised server-side to
 * PKR/gram 24K — the same market reference the headline rate uses. The four
 * ranges mirror Asasa's own home screen.
 *
 * Nothing here is decorative: if the upstream history cannot be fetched the
 * chart says so rather than drawing an invented curve, and a chart failure
 * never affects the live price or the ability to trade.
 */
export function RateChart(): JSX.Element {
  const [range, setRange] = useState<HistoryRange>('1M');
  const [series, setSeries] = useState<HistorySeries | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const cache = useRef(new Map<HistoryRange, HistorySeries>());

  useEffect(() => {
    const cached = cache.current.get(range);
    if (cached) {
      setSeries(cached);
      setLoading(false);
      setFailed(false);
      return;
    }

    let live = true;
    setLoading(true);
    setFailed(false);
    api
      .getHistory(range)
      .then((s) => {
        if (!live) return;
        cache.current.set(range, s);
        setSeries(s);
      })
      .catch(() => {
        if (live) setFailed(true);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [range]);

  const geometry = useMemo(() => {
    const pts = series?.points ?? [];
    if (pts.length < 2) return null;

    const values = pts.map((p) => Number(p.v)).filter((n) => Number.isFinite(n));
    if (values.length < 2) return null;

    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const span = hi - lo || 1;
    const stepX = W / (values.length - 1);

    const coords = values.map((v, i) => ({
      x: i * stepX,
      y: H - PAD_Y - ((v - lo) / span) * (H - PAD_Y * 2),
    }));

    const line = coords
      .map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
      .join(' ');
    const area = `${line} L${W} ${H} L0 ${H} Z`;

    return { line, area, last: coords[coords.length - 1] as { x: number; y: number }, lo, hi };
  }, [series]);

  const changePct = series?.change_pct === null || series?.change_pct === undefined
    ? null
    : Number(series.change_pct);
  const up = changePct !== null && changePct >= 0;

  return (
    <section className="chart" aria-label="Gold rate history">
      <div className="chart__head">
        {changePct === null ? (
          <span className="chart__delta chart__delta--flat">Rate history</span>
        ) : (
          <span className={`chart__delta ${up ? 'chart__delta--up' : 'chart__delta--down'}`}>
            {up ? '↑' : '↓'} {Math.abs(changePct).toFixed(2)}%
            <span className="chart__delta-range"> over {range}</span>
          </span>
        )}

        <div className="rangetabs" role="tablist" aria-label="Chart range">
          {HISTORY_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={r === range}
              className={`rangetabs__btn${r === range ? ' rangetabs__btn--on' : ''}`}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="chart__body">
        {geometry ? (
          <>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              width="100%"
              height={H}
              role="img"
              aria-label={`Market reference over ${range}: ${rs(geometry.lo)} to ${rs(geometry.hi)} per gram across ${series?.points.length ?? 0} points`}
              preserveAspectRatio="none"
              className={loading ? 'chart__svg chart__svg--loading' : 'chart__svg'}
            >
              <defs>
                <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent-500)" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="var(--accent-500)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={geometry.area} fill="url(#chartFill)" />
              <path
                d={geometry.line}
                fill="none"
                stroke="var(--accent-500)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={Math.min(geometry.last.x, W - 3)} cy={geometry.last.y} r="3.4" fill="var(--accent-600)" />
            </svg>

            <div className="chart__legend">
              <span>
                <span className="chart__hi">High</span> {rs(geometry.hi)}
              </span>
              <span>
                <span className="chart__lo">Low</span> {rs(geometry.lo)}
              </span>
            </div>
          </>
        ) : (
          <p className="lede chart__empty">
            {loading
              ? 'Loading rate history…'
              : failed
                ? 'Rate history could not be loaded. The live rate above is unaffected.'
                : (series?.reason ??
                  'Rate history is unavailable right now. The live rate above is unaffected.')}
          </p>
        )}
      </div>

      {series && !series.unavailable && geometry ? (
        <p className="chart__source">
          {series.granularity} · via {series.source}
          {series.approximate_timestamps ? ' · intraday points are evenly spaced' : ''}
        </p>
      ) : null}
    </section>
  );
}
