import { rs } from '../lib/format';
import type { PricePoint } from '../state/AppDataProvider';

const W = 320;
const H = 62;

interface SparklineProps {
  points: PricePoint[];
}

/**
 * Rate history observed **in this browser session**.
 *
 * The API exposes only the current market reference — there is no historical
 * series behind it — so rather than draw a decorative curve from invented data,
 * this plots the samples this page has actually seen since it was opened, and
 * says so. An empty chart is more honest than a pretty fictional one.
 */
export function Sparkline({ points }: SparklineProps): JSX.Element {
  if (points.length < 2) {
    return (
      <div className="spark">
        <p className="lede">
          Rate history builds while this page is open — the server refreshes the market
          reference at most once every 5 minutes.
        </p>
      </div>
    );
  }

  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const stepX = W / (points.length - 1);

  const coords = points.map((p, i) => {
    const x = i * stepX;
    // 6px padding top and bottom so the stroke and end dot never clip.
    const y = H - 6 - ((p.value - lo) / span) * (H - 12);
    return { x, y };
  });

  const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  const last = coords[coords.length - 1] as { x: number; y: number };

  return (
    <div className="spark">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={`Market reference observed this session, from ${rs(lo)} to ${rs(hi)} per gram across ${points.length} samples`}
        preserveAspectRatio="none"
      >
        <path
          d={path}
          fill="none"
          stroke="var(--accent-500)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={last.x - 2} cy={last.y} r="3.4" fill="var(--accent-600)" />
      </svg>
      <div className="spark__legend">
        <span>
          <span className="spark__hi">High</span> {rs(hi)}
        </span>
        <span>
          <span className="spark__lo">Low</span> {rs(lo)}
        </span>
      </div>
    </div>
  );
}
