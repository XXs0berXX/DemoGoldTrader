import { Banner } from '../components/Banner';
import { rs } from '../lib/format';
import { useAppData } from '../state/AppDataProvider';

/** A decorative QR-shaped placeholder. Deterministic, and explicitly labelled
 *  as a mock — it encodes nothing, because no real money moves in this demo. */
function MockQr(): JSX.Element {
  const n = 21;
  const cells: JSX.Element[] = [];
  const isFinder = (r: number, c: number): boolean => {
    const inBox = (r0: number, c0: number) =>
      r >= r0 && r < r0 + 7 && c >= c0 && c < c0 + 7;
    const ring = (r0: number, c0: number) => {
      const dr = r - r0;
      const dc = c - c0;
      const edge = dr === 0 || dr === 6 || dc === 0 || dc === 6;
      const core = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
      return edge || core;
    };
    if (inBox(0, 0)) return ring(0, 0);
    if (inBox(0, n - 7)) return ring(0, n - 7);
    if (inBox(n - 7, 0)) return ring(n - 7, 0);
    return false;
  };

  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      const inFinderBox =
        (r < 8 && c < 8) || (r < 8 && c >= n - 8) || (r >= n - 8 && c < 8);
      // A fixed, reproducible fill pattern — no randomness, so the markup is stable.
      const on = inFinderBox ? isFinder(r, c) : ((r * 7 + c * 13 + r * c) % 5) % 2 === 0;
      if (on) {
        cells.push(<rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} fill="#0D4A46" />);
      }
    }
  }

  return (
    <svg viewBox={`0 0 ${n} ${n}`} width="168" height="168" aria-hidden="true" focusable="false">
      {cells}
    </svg>
  );
}

export function WalletScreen(): JSX.Element {
  const { state } = useAppData();

  return (
    <div className="page">
      <p className="hero__eyebrow" style={{ color: 'var(--ink-400)', marginTop: 12 }}>
        Add money
      </p>
      <p className="rateblock__price num" style={{ margin: '2px 0 0' }}>
        {state ? rs(state.balances.pkr_wallet) : '—'}
      </p>
      <p className="lede">Current wallet balance</p>

      <div
        className="card"
        style={{
          marginTop: 20,
          padding: '22px 20px',
          textAlign: 'center',
        }}
      >
        <p style={{ margin: 0, fontWeight: 700, fontSize: 'var(--fs-lg)' }}>
          <span className="dot dot--live" style={{ display: 'inline-block', marginRight: 8 }} />
          Raast QR
        </p>
        <div style={{ margin: '18px 0 14px' }}>
          <MockQr />
        </div>
        <p className="lede" style={{ maxWidth: 240, margin: '0 auto' }}>
          Scan with any banking or wallet app to pay
        </p>
      </div>

      <p className="legal">This code would expire in 15 minutes</p>

      <Banner tone="info" title="Top-up and withdrawal are mocked" className="banner-mt">
        Real money movement is out of scope for this demo, so this QR encodes nothing and
        no funds change hands here. To move the wallet balance, use{' '}
        <strong>Demo controls</strong> and switch scenario — that re-seeds the balances
        directly.
      </Banner>

      <h3 className="section-h">Balances</h3>
      <div className="card card--flat">
        <div className="kv">
          <span className="kv__k">PKR wallet</span>
          <span className="kv__v num">{state ? rs(state.balances.pkr_wallet) : '—'}</span>
        </div>
        <div className="kv">
          <span className="kv__k">Scenario</span>
          <span className="kv__v">{state?.scenario ?? '—'}</span>
        </div>
      </div>
    </div>
  );
}
