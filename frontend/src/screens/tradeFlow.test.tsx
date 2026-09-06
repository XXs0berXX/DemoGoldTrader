import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDataProvider } from '../state/AppDataProvider';
import { TradeFlow } from './TradeFlow';
import {
  apiError,
  BASE_STATE,
  deferred,
  installFetchMock,
  LIVE_PRICE,
  makeConfirm,
  makeQuote,
  ok,
  PAUSED_PRICE,
  type Handler,
} from '../test/harness';

/**
 * Behaviour tests for the trade journey.
 *
 * These assert the things the spec calls trust requirements: that the countdown
 * is a display of server truth, that a paused market cannot be traded through,
 * that every rejection shows a real number rather than a generic error, and
 * that pressing Confirm twice cannot fire two settlements.
 */

function renderBuy(handlers: Partial<Record<string, Handler>> = {}) {
  const mock = installFetchMock(handlers);
  render(
    <AppDataProvider>
      <TradeFlow side="BUY" onExit={() => {}} />
    </AppDataProvider>,
  );
  return mock;
}

/** Fill the PKR field and advance to the Review screen. */
async function goToReview(user: ReturnType<typeof userEvent.setup>, amount = '5000') {
  const pkr = await screen.findByLabelText(/You pay in PKR/i);
  await user.clear(pkr);
  await user.type(pkr, amount);
  await user.click(await screen.findByRole('button', { name: /Continue/i }));
  await screen.findByRole('region', { name: /Order summary/i });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('trading paused', () => {
  it('disables the CTA and states the reason instead of showing a stale price', async () => {
    renderBuy({ 'GET /api/price': () => ok(PAUSED_PRICE) });

    expect(await screen.findByText(/Trading is paused/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Both price sources are unreachable\./i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue/i })).toBeDisabled();

    // The live rate must not be rendered as though it were tradeable.
    expect(screen.queryByText(/43,502/)).not.toBeInTheDocument();
    expect(screen.queryByText(/39,547/)).not.toBeInTheDocument();
  });

  it('never issues a quote while paused', async () => {
    const user = userEvent.setup();
    const mock = renderBuy({ 'GET /api/price': () => ok(PAUSED_PRICE) });

    await screen.findByText(/Trading is paused/i);
    await user.click(screen.getByRole('button', { name: /Continue/i }));

    expect(mock.callsTo('/api/quote')).toHaveLength(0);
  });
});

describe('amount entry converts in both directions', () => {
  it('derives grams from a PKR amount at the customer buy price', async () => {
    const user = userEvent.setup();
    renderBuy();

    const pkr = await screen.findByLabelText(/You pay in PKR/i);
    await user.clear(pkr);
    await user.type(pkr, '43502.12');

    // 43,502.12 PKR at 43,502.12 PKR/g is exactly 1 gram. In PKR mode the gram
    // side is a derived read-only display, not an input.
    await waitFor(() => {
      expect(screen.getByLabelText(/You receive, converted/i)).toHaveTextContent('1.0000');
    });
  });

  it('derives PKR from a gram amount at the same price', async () => {
    const user = userEvent.setup();
    renderBuy();

    // Switch the entry unit; only one side is an input at a time.
    await user.click(await screen.findByRole('button', { name: 'Grams' }));

    const grams = await screen.findByLabelText(/You receive in grams/i);
    await user.clear(grams);
    await user.type(grams, '2');

    // 2 g at 43,502.12 PKR/g = 87,004.24 PKR.
    await waitFor(() => {
      expect(screen.getByLabelText(/You pay, converted/i)).toHaveTextContent('87,004.24');
    });
  });
});

describe('insufficiency is reported with the real shortfall', () => {
  const cases = [
    {
      code: 'INSUFFICIENT_PKR',
      message: 'This trade needs PKR 50000.00 but your wallet holds PKR 1500.00 — PKR 48500.00 short.',
      details: { required: '50000.00', available: '1500.00', shortfall: '48500.00' },
      expect: /48500\.00|48,500/,
    },
    {
      code: 'INSUFFICIENT_INVENTORY',
      message: 'The platform only has 0.0500 g available — 1.0993 g short.',
      details: { required: '1.1493', available: '0.0500', shortfall: '1.0993' },
      expect: /1\.0993/,
    },
  ];

  for (const c of cases) {
    it(`${c.code} renders its shortfall, not a generic error`, async () => {
      const user = userEvent.setup();
      renderBuy({
        'POST /api/quote': () => apiError(409, c.code, c.message, c.details),
      });

      const pkr = await screen.findByLabelText(/You pay in PKR/i);
      await user.clear(pkr);
      await user.type(pkr, '50000');
      await user.click(screen.getByRole('button', { name: /Continue/i }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(c.expect);
    });
  }

  it('blames the platform, not the user, when inventory runs out', async () => {
    const user = userEvent.setup();
    renderBuy({
      'POST /api/quote': () =>
        apiError(409, 'INSUFFICIENT_INVENTORY', 'The platform only has 0.0500 g available — 1.0993 g short.', {
          required: '1.1493',
          available: '0.0500',
          shortfall: '1.0993',
        }),
    });

    const pkr = await screen.findByLabelText(/You pay in PKR/i);
    await user.clear(pkr);
    await user.type(pkr, '50000');
    await user.click(screen.getByRole('button', { name: /Continue/i }));

    expect(await screen.findByText(/unable to procure gold/i)).toBeInTheDocument();
    expect(screen.getByText(/try again in a bit/i)).toBeInTheDocument();
  });
});

/**
 * Where each of the three insufficiency answers comes from.
 *
 * Wallet and holdings are the customer's own numbers, so the client says so at
 * once. Platform inventory is shared state the client cannot know is still
 * true, so it must reach the server — a client that pre-empted it would refuse
 * orders the platform could actually fill.
 */
describe('who decides an order cannot go through', () => {
  it('answers a short wallet immediately, without asking the server', async () => {
    const user = userEvent.setup();
    const mock = renderBuy({
      'GET /api/state': () =>
        ok({ ...BASE_STATE, balances: { ...BASE_STATE.balances, pkr_wallet: '1500.00' } }),
    });

    const pkr = await screen.findByLabelText(/You pay in PKR/i);
    await user.clear(pkr);
    await user.type(pkr, '5000');

    expect(await screen.findByText(/wallet is short/i)).toBeInTheDocument();
    // The reason sits beside the button, not only in the banner above.
    expect(screen.getByText(/Your wallet holds .*not enough for this trade/i)).toBeInTheDocument();
    expect(mock.callsTo('/api/quote')).toHaveLength(0);
  });

  it('answers a short gold holding immediately, without asking the server', async () => {
    const user = userEvent.setup();
    const mock = installFetchMock({
      'GET /api/state': () =>
        ok({
          ...BASE_STATE,
          balances: { ...BASE_STATE.balances, customer_gold_g: '0.0500' },
        }),
    });
    render(
      <AppDataProvider>
        <TradeFlow side="SELL" onExit={() => {}} />
      </AppDataProvider>,
    );

    const g = await screen.findByLabelText(/You sell in grams/i);
    await user.clear(g);
    await user.type(g, '0.5');

    expect(await screen.findByText(/don’t hold that much gold/i)).toBeInTheDocument();
    expect(screen.getByText(/You hold .*not enough for this sale/i)).toBeInTheDocument();
    expect(mock.callsTo('/api/quote')).toHaveLength(0);
  });

  it('sends the order even when the platform looks short, and reports the server’s answer', async () => {
    const user = userEvent.setup();
    const mock = renderBuy({
      'GET /api/state': () =>
        ok({
          ...BASE_STATE,
          balances: { ...BASE_STATE.balances, platform_gold_g: '0.0500' },
        }),
      'POST /api/quote': () =>
        apiError(409, 'INSUFFICIENT_INVENTORY', 'Only 0.0500 g available.', {
          required: '0.1149',
          available: '0.0500',
          shortfall: '0.0649',
        }),
    });

    const pkr = await screen.findByLabelText(/You pay in PKR/i);
    await user.clear(pkr);
    await user.type(pkr, '5000');

    const cta = screen.getByRole('button', { name: /Continue/i });
    expect(cta).toBeEnabled();
    await user.click(cta);

    expect(await screen.findByText(/unable to procure gold/i)).toBeInTheDocument();
    expect(mock.callsTo('/api/quote')).toHaveLength(1);
  });

  it('drops the server rejection once the amount it referred to has changed', async () => {
    const user = userEvent.setup();
    renderBuy({
      'POST /api/quote': () =>
        apiError(409, 'INSUFFICIENT_INVENTORY', 'Only 0.0500 g available.', {}),
    });

    const pkr = await screen.findByLabelText(/You pay in PKR/i);
    await user.clear(pkr);
    await user.type(pkr, '5000');
    await user.click(screen.getByRole('button', { name: /Continue/i }));
    await screen.findByText(/unable to procure gold/i);

    await user.type(pkr, '0');

    await waitFor(() =>
      expect(screen.queryByText(/unable to procure gold/i)).not.toBeInTheDocument(),
    );
  });
});

describe('the countdown displays server truth', () => {
  it('counts down from the server expires_at and stops at zero without going negative', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const issued = new Date();
    renderBuy({
      'POST /api/quote': () =>
        ok(
          makeQuote({
            issued_at: issued.toISOString(),
            expires_at: new Date(issued.getTime() + 75_000).toISOString(),
          }),
        ),
    });

    await goToReview(user);

    const clock = screen.getByRole('status');
    expect(clock).toHaveTextContent(/1:1[45]/); // ~75s remaining

    await vi.advanceTimersByTimeAsync(60_000);
    await waitFor(() => expect(clock).toHaveTextContent(/0:1[45]/));

    // Run well past expiry. The clock never renders a negative value; once the
    // lock is gone it says so in words rather than counting into the negative.
    await vi.advanceTimersByTimeAsync(60_000);
    await waitFor(() => expect(clock).toHaveTextContent(/no longer locked/i));
    expect(clock.textContent).not.toMatch(/-\d/);
  });
});

describe('confirm', () => {
  it('fires exactly one request even when pressed twice in a row', async () => {
    const user = userEvent.setup();
    const gate = deferred<void>();

    const mock = renderBuy({
      'POST /api/confirm': async () => {
        await gate.promise;
        return ok(makeConfirm());
      },
    });

    await goToReview(user);

    const confirm = await screen.findByRole('button', { name: /Confirm/i });
    await user.click(confirm);

    // While the first request is in flight the button must be disabled.
    await waitFor(() => expect(confirm).toBeDisabled());
    await user.click(confirm);

    gate.resolve();
    await screen.findByText(/Order receipt/i);

    expect(mock.callsTo('/api/confirm')).toHaveLength(1);
  });

  it('shows the receipt calmly when the server reports a duplicate settle', async () => {
    const user = userEvent.setup();
    renderBuy({
      'POST /api/confirm': () => ok(makeConfirm({ duplicate: true })),
    });

    await goToReview(user);
    await user.click(await screen.findByRole('button', { name: /Confirm/i }));

    expect(await screen.findByText(/Order receipt/i)).toBeInTheDocument();
    expect(screen.getAllByText(/ORDER-2026-0012345/).length).toBeGreaterThan(0);
    expect(screen.getByText(/already settled/i)).toBeInTheDocument();
    // A duplicate is not a failure and must not be styled as one.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the receipt with the settled amounts and the rounding disclosure', async () => {
    const user = userEvent.setup();
    renderBuy();

    await goToReview(user);
    await user.click(await screen.findByRole('button', { name: /Confirm/i }));

    const receipt = await screen.findByText(/Order receipt/i);
    expect(receipt).toBeInTheDocument();
    expect(screen.getByText(/0\.1149/)).toBeInTheDocument();
    expect(screen.getByText(/rounded down/i)).toBeInTheDocument();
  });
});

describe('an expired quote is a guided path, not a dead end', () => {
  it('shows the expired state and re-quotes the same amount on one tap', async () => {
    const user = userEvent.setup();
    let confirmCalls = 0;

    const mock = renderBuy({
      'POST /api/confirm': () => {
        confirmCalls += 1;
        return apiError(
          410,
          'QUOTE_EXPIRED',
          'That price is no longer locked. Grab a fresh quote and the current rate applies.',
        );
      },
    });

    await goToReview(user);
    await user.click(await screen.findByRole('button', { name: /Confirm/i }));

    expect(await screen.findByText(/This quote expired/i)).toBeInTheDocument();
    expect(confirmCalls).toBe(1);

    const quotesBefore = mock.callsTo('/api/quote').length;
    await user.click(screen.getAllByRole('button', { name: /Get a fresh quote/i })[0]!);

    await waitFor(() => {
      expect(mock.callsTo('/api/quote').length).toBe(quotesBefore + 1);
    });

    // The re-quote must be for the SAME amount the user originally entered.
    const requote = mock.callsTo('/api/quote').at(-1);
    expect(requote?.body).toMatchObject({ side: 'BUY', pkr_amount: '5000.00' });
  });

  it('distinguishes an unknown quote from an expired one', async () => {
    const user = userEvent.setup();
    renderBuy({
      'POST /api/confirm': () =>
        apiError(404, 'QUOTE_NOT_FOUND', 'We could not find that quote.'),
    });

    await goToReview(user);
    await user.click(await screen.findByRole('button', { name: /Confirm/i }));

    expect(await screen.findByText(/couldn’t find that quote/i)).toBeInTheDocument();
    expect(screen.queryByText(/This quote expired/i)).not.toBeInTheDocument();
  });
});

describe('guardrail visibility', () => {
  it('says so on the price when the floor is binding', async () => {
    renderBuy({
      'GET /api/price': () =>
        ok({
          ...LIVE_PRICE,
          guardrail_applied: true,
          guardrail_pkr_per_gram: '60000.00',
          buy_pkr_per_gram: '60000.00',
        }),
    });

    await waitFor(() => expect(screen.getAllByText(/Guardrail/i).length).toBeGreaterThan(0));
  });

  it('carries the guardrail note through to the receipt', async () => {
    const user = userEvent.setup();
    renderBuy({
      'GET /api/price': () =>
        ok({ ...LIVE_PRICE, guardrail_applied: true, buy_pkr_per_gram: '60000.00' }),
      'POST /api/quote': () =>
        ok(makeQuote({ guardrail_applied: true, locked_price_pkr_per_gram: '60000.00' })),
      'POST /api/confirm': () => {
        const base = makeConfirm();
        return ok({
          ...base,
          receipt: { ...base.receipt, guardrail_applied: true, locked_price_pkr_per_gram: '60000.00' },
        });
      },
    });

    await goToReview(user);
    await user.click(await screen.findByRole('button', { name: /Confirm/i }));

    await screen.findByText(/Order receipt/i);
    expect(screen.getAllByText(/Guardrail/i).length).toBeGreaterThan(0);
  });
});

describe('the review screen states what the trade does to the balances', () => {
  it('shows the projected balance after the trade', async () => {
    const user = userEvent.setup();
    renderBuy();
    await goToReview(user);

    const balance = screen.getByRole('region', { name: /Balance after this trade/i });
    // 250,000 seeded minus the 5,000 spent.
    expect(within(balance).getByText(/245,000/)).toBeInTheDocument();
  });

  it('shows the locked rate and the total on the summary', async () => {
    const user = userEvent.setup();
    renderBuy();
    await goToReview(user);

    const summary = screen.getByRole('region', { name: /Order summary/i });
    expect(within(summary).getAllByText(/43,502/).length).toBeGreaterThan(0);
    expect(within(summary).getAllByText(/5,000/).length).toBeGreaterThan(0);
  });

  it('starts from the seeded wallet balance on first load', async () => {
    renderBuy();
    expect(await screen.findByText(/250,000/)).toBeInTheDocument();
    expect(BASE_STATE.balances.pkr_wallet).toBe('250000.00');
  });
});
