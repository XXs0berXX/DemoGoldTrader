import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateChart } from './RateChart';
import type { HistoryRange, HistorySeries } from '../api/types';
import { installFetchMock, ok, type Handler } from '../test/harness';

/**
 * The rate chart.
 *
 * The series is real history from GoldPrice.org normalised to PKR/gram. These
 * tests pin the behaviour that matters: the four ranges are selectable, each
 * one shows its own high/low and change, and a chart that cannot load says so
 * instead of drawing a fake line.
 */

function series(range: HistoryRange, values: number[], overrides: Partial<HistorySeries> = {}): HistorySeries {
  const base = Date.parse('2026-09-05T12:00:00.000Z');
  const points = values.map((v, i) => ({
    t: new Date(base + i * 3_600_000).toISOString(),
    v: v.toFixed(2),
  }));
  const open = values[0] as number;
  const close = values[values.length - 1] as number;
  return {
    range,
    points,
    open: open.toFixed(2),
    close: close.toFixed(2),
    high: Math.max(...values).toFixed(2),
    low: Math.min(...values).toFixed(2),
    change_pct: (((close - open) / open) * 100).toFixed(2),
    source: 'goldprice',
    granularity: range === '1D' || range === '1W' ? 'intraday, ~20 minutes per point' : 'daily close',
    approximate_timestamps: range === '1D' || range === '1W',
    as_of: points[points.length - 1]?.t ?? null,
    unavailable: false,
    reason: null,
    ...overrides,
  };
}

const RANGE_DATA: Record<HistoryRange, number[]> = {
  '1D': [39800, 39600, 39400, 39538],
  '1W': [39100, 39900, 39300, 39538],
  '1M': [37847, 39000, 41399, 39485],
  '1Y': [32718, 40000, 47906, 40032],
};

function historyHandlers(extra: Partial<Record<string, Handler>> = {}): Partial<Record<string, Handler>> {
  const table: Partial<Record<string, Handler>> = {};
  for (const r of ['1D', '1W', '1M', '1Y'] as HistoryRange[]) {
    table[`GET /api/price/history?range=${r}`] = () => ok(series(r, RANGE_DATA[r]));
  }
  return { ...table, ...extra };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('range selection', () => {
  it('offers exactly the four ranges from the Asasa home screen, defaulting to 1M', async () => {
    installFetchMock(historyHandlers());
    render(<RateChart />);

    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['1D', '1W', '1M', '1Y']);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: '1M' })).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('loads a different series when another range is picked', async () => {
    const user = userEvent.setup();
    const mock = installFetchMock(historyHandlers());
    render(<RateChart />);

    // 1M: 37,847 -> 41,399
    expect(await screen.findByText(/41,399/)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '1Y' }));

    // 1Y has a different high, so the legend must change.
    expect(await screen.findByText(/47,906/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '1Y' })).toHaveAttribute('aria-selected', 'true');
    expect(mock.callsTo('/api/price/history?range=1Y')).toHaveLength(1);
  });

  it('does not refetch a range it has already loaded', async () => {
    const user = userEvent.setup();
    const mock = installFetchMock(historyHandlers());
    render(<RateChart />);

    await screen.findByText(/41,399/);
    await user.click(screen.getByRole('tab', { name: '1D' }));
    await screen.findByText(/40,026|39,800/);
    await user.click(screen.getByRole('tab', { name: '1M' }));
    await screen.findByText(/41,399/);

    expect(mock.callsTo('/api/price/history?range=1M')).toHaveLength(1);
  });
});

describe('what the chart reports', () => {
  it('draws a line from the returned points', async () => {
    installFetchMock(historyHandlers());
    const { container } = render(<RateChart />);

    await screen.findByText(/41,399/);
    const paths = container.querySelectorAll('path');
    // One area fill plus one stroked line.
    expect(paths.length).toBeGreaterThanOrEqual(2);
    expect(paths[1]?.getAttribute('d')).toMatch(/^M[\d.]+ [\d.]+ L/);
  });

  it('shows the high and low for the selected range', async () => {
    installFetchMock(historyHandlers());
    render(<RateChart />);

    const chart = await screen.findByRole('region', { name: /Gold rate history/i });
    expect(within(chart).getByText(/High/)).toBeInTheDocument();
    expect(within(chart).getByText(/41,399/)).toBeInTheDocument();
    expect(within(chart).getByText(/Low/)).toBeInTheDocument();
    expect(within(chart).getByText(/37,847/)).toBeInTheDocument();
  });

  it('shows a rise as positive and a fall as negative', async () => {
    const user = userEvent.setup();
    installFetchMock(
      historyHandlers({
        'GET /api/price/history?range=1D': () => ok(series('1D', [40000, 39000])),
      }),
    );
    render(<RateChart />);

    // 1M rose 37,847 -> 39,485
    expect(await screen.findByText(/↑/)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '1D' }));
    // 1D fell 40,000 -> 39,000 = -2.50%
    expect(await screen.findByText(/↓/)).toBeInTheDocument();
    expect(screen.getByText(/2\.50%/)).toBeInTheDocument();
  });

  it('names the source and the granularity so the number is auditable', async () => {
    installFetchMock(historyHandlers());
    render(<RateChart />);

    expect(await screen.findByText(/via goldprice/i)).toBeInTheDocument();
    expect(screen.getByText(/daily close/i)).toBeInTheDocument();
  });

  it('discloses that intraday points are evenly spaced rather than precisely timed', async () => {
    const user = userEvent.setup();
    installFetchMock(historyHandlers());
    render(<RateChart />);

    await screen.findByText(/41,399/);
    await user.click(screen.getByRole('tab', { name: '1D' }));

    expect(await screen.findByText(/evenly spaced/i)).toBeInTheDocument();
  });
});

describe('degradation', () => {
  it('says the history is unavailable instead of drawing an invented line', async () => {
    installFetchMock(
      historyHandlers({
        'GET /api/price/history?range=1M': () =>
          ok(
            series('1M', [1], {
              points: [],
              unavailable: true,
              reason: 'Rate history is temporarily unavailable.',
              high: null,
              low: null,
              change_pct: null,
            }),
          ),
      }),
    );
    const { container } = render(<RateChart />);

    expect(await screen.findByText(/temporarily unavailable/i)).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('survives a failed request and says the live rate is unaffected', async () => {
    installFetchMock({
      'GET /api/price/history?range=1M': () => ({
        status: 500,
        body: { error: { code: 'INTERNAL', message: 'boom' } },
      }),
    });
    render(<RateChart />);

    expect(await screen.findByText(/live rate above is unaffected/i)).toBeInTheDocument();
  });

  it('does not draw a line from a single point', async () => {
    installFetchMock(
      historyHandlers({
        'GET /api/price/history?range=1M': () => ok(series('1M', [39000])),
      }),
    );
    const { container } = render(<RateChart />);

    await waitFor(() => expect(container.querySelector('svg')).toBeNull());
  });
});
