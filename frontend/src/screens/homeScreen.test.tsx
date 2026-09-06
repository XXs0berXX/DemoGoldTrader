import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDataProvider } from '../state/AppDataProvider';
import { HomeScreen } from './HomeScreen';
import { installFetchMock, ok } from '../test/harness';

/**
 * Balance privacy on the home hero card.
 *
 * The eye toggle is a display concern only — the balances are still fetched and
 * still drive the trade screens; they are simply not rendered while hidden.
 */

function renderHome() {
  const mock = installFetchMock({
    'GET /api/price/history?range=1M': () =>
      ok({
        range: '1M',
        points: [],
        open: null,
        close: null,
        high: null,
        low: null,
        change_pct: null,
        source: 'goldprice',
        granularity: 'daily close',
        approximate_timestamps: false,
        as_of: null,
        unavailable: true,
        reason: 'not needed for this test',
      }),
  });
  render(
    <AppDataProvider>
      <HomeScreen onNavigate={() => {}} />
    </AppDataProvider>,
  );
  return mock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hide balances toggle', () => {
  it('shows the real gold and wallet figures by default', async () => {
    renderHome();

    expect(await screen.findByText(/6\.842/)).toBeInTheDocument();
    expect(screen.getByText(/250,000/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Hide balances/i })).toBeInTheDocument();
  });

  it('masks the gold, its value and the wallet when hidden', async () => {
    const user = userEvent.setup();
    renderHome();

    await screen.findByText(/6\.842/);
    await user.click(screen.getByRole('button', { name: /Hide balances/i }));

    await waitFor(() => expect(screen.queryByText(/6\.842/)).not.toBeInTheDocument());
    expect(screen.queryByText(/250,000/)).not.toBeInTheDocument();
    // Gold grams, current value and wallet are all masked.
    expect(screen.getAllByText('*****')).toHaveLength(3);
  });

  it('reveals the real figures again when toggled back', async () => {
    const user = userEvent.setup();
    renderHome();

    await screen.findByText(/6\.842/);
    await user.click(screen.getByRole('button', { name: /Hide balances/i }));
    await waitFor(() => expect(screen.queryByText(/6\.842/)).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Show balances/i }));

    expect(await screen.findByText(/6\.842/)).toBeInTheDocument();
    expect(screen.getByText(/250,000/)).toBeInTheDocument();
    expect(screen.queryByText('*****')).not.toBeInTheDocument();
  });

  it('reports its state to assistive tech rather than only changing the icon', async () => {
    const user = userEvent.setup();
    renderHome();

    const btn = await screen.findByRole('button', { name: /Hide balances/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');

    await user.click(btn);

    const pressed = await screen.findByRole('button', { name: /Show balances/i });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not hide the platform inventory — that is the platform’s number, not the customer’s', async () => {
    const user = userEvent.setup();
    renderHome();

    await screen.findByText(/6\.842/);
    await user.click(screen.getByRole('button', { name: /Hide balances/i }));

    expect(await screen.findByText(/100\.0000/)).toBeInTheDocument();
  });

  it('keeps the live rate visible while balances are hidden', async () => {
    const user = userEvent.setup();
    renderHome();

    await screen.findByText(/6\.842/);
    await user.click(screen.getByRole('button', { name: /Hide balances/i }));

    // The market reference is public information, not a personal balance.
    expect(await screen.findByText(/39,547/)).toBeInTheDocument();
  });
});
