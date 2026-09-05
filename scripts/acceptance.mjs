#!/usr/bin/env node
/**
 * Independent end-to-end acceptance harness.
 *
 * This is the orchestrator's gate: it exercises a RUNNING server over HTTP and
 * re-derives every number itself, so it cannot be satisfied by the same
 * assumptions the implementation makes. It is deliberately independent of the
 * backend's own unit tests.
 *
 *   node scripts/acceptance.mjs [baseUrl]
 *
 * Default baseUrl: http://localhost:8080
 * Exits non-zero on the first hard failure summary.
 */

const BASE = (process.argv[2] || process.env.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const TROY_OUNCE_GRAMS = 31.1034768;

let pass = 0;
const failures = [];
let cookie = '';

const c = {
  gr: (s) => `\x1b[32m${s}\x1b[0m`,
  rd: (s) => `\x1b[31m${s}\x1b[0m`,
  dm: (s) => `\x1b[2m${s}\x1b[0m`,
  bd: (s) => `\x1b[1m${s}\x1b[0m`,
};

function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ${c.gr('PASS')}  ${name}${detail ? c.dm('  ' + detail) : ''}`);
  } else {
    failures.push(`${name}${detail ? ' — ' + detail : ''}`);
    console.log(`  ${c.rd('FAIL')}  ${name}${detail ? c.dm('  ' + detail) : ''}`);
  }
}

function section(t) {
  console.log(`\n${c.bd(t)}`);
}

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const sc of setCookie) {
    const m = /^(asasa_sid=[^;]+)/.exec(sc);
    if (m) cookie = m[1];
  }
  let json = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { __unparseable: text.slice(0, 400) };
  }
  return { status: res.status, body: json };
}

const num = (v) => Number(v);
const close = (a, b, tol) => Math.abs(a - b) <= tol;
const fmt = (v) => (typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 4 }) : String(v));

async function resetToNormal() {
  await api('POST', '/api/demo/source-failure', { mode: 'none' });
  await api('POST', '/api/demo/guardrail', { reset: true });
  await api('POST', '/api/demo/scenario', { scenario: 'normal' });
}

async function main() {
  console.log(c.bd(`\nAcceptance run against ${BASE}\n${'='.repeat(60)}`));

  // ---------------------------------------------------------------- health
  section('1. Health & reachability');
  const health = await api('GET', '/api/health');
  check('GET /api/health returns 200', health.status === 200, `status=${health.status}`);

  await resetToNormal();

  // ---------------------------------------------------------------- pricing
  section('2. Pricing — normalization, spread, guardrail');
  const p = await api('GET', '/api/price');
  check('GET /api/price returns 200', p.status === 200, `status=${p.status}`);
  const pr = p.body || {};
  check('freshness is LIVE', pr.freshness === 'LIVE', `freshness=${pr.freshness}`);
  check('trading is enabled', pr.trading_enabled === true);
  check(
    'source is a known feed',
    pr.source === 'pakgold' || pr.source === 'goldprice',
    `source=${pr.source}`,
  );

  const market = num(pr.market_pkr_per_gram);
  const buy = num(pr.buy_pkr_per_gram);
  const sell = num(pr.sell_pkr_per_gram);
  const guardrail = num(pr.guardrail_pkr_per_gram);

  check(
    'market reference is a plausible PKR/gram 24K value',
    market > 5000 && market < 500000,
    `market=${fmt(market)} PKR/g`,
  );

  // Independently re-derive the market reference straight from the upstream feeds.
  try {
    const [xauRes, fxRes] = await Promise.all([
      fetch('https://api.gold-api.com/price/XAU'),
      fetch('https://open.er-api.com/v6/latest/USD'),
    ]);
    const xau = (await xauRes.json()).price;
    const fx = (await fxRes.json()).rates.PKR;
    const expected = (xau * fx) / TROY_OUNCE_GRAMS;
    check(
      'market matches an independent recomputation from upstream feeds (<2%)',
      close(market, expected, expected * 0.02),
      `server=${fmt(market)} independent=${fmt(expected)}`,
    );
  } catch (e) {
    check('independent upstream recomputation reachable', false, String(e).slice(0, 120));
  }

  check(
    'buy price = max(market x 1.10, guardrail)',
    close(buy, Math.max(market * 1.1, guardrail), 1),
    `buy=${fmt(buy)} expected=${fmt(Math.max(market * 1.1, guardrail))}`,
  );
  check('sell price = market x 0.90', close(sell, market * 0.9, 1), `sell=${fmt(sell)} expected=${fmt(market * 0.9)}`);
  check('buy price is strictly above sell price', buy > sell);
  check('fetched_at is present and parseable', !!pr.fetched_at && !Number.isNaN(Date.parse(pr.fetched_at)));
  check('age_seconds is within the 300s cache window', pr.age_seconds >= 0 && pr.age_seconds <= 300, `age=${pr.age_seconds}s`);

  // ------------------------------------------------------------------ state
  section('3. Seeded state');
  const s0 = await api('GET', '/api/state');
  check('GET /api/state returns 200', s0.status === 200, `status=${s0.status}`);
  const b0 = s0.body?.balances || {};
  check('PKR wallet is seeded', num(b0.pkr_wallet) > 0, `wallet=${fmt(num(b0.pkr_wallet))}`);
  check('customer gold is seeded', num(b0.customer_gold_g) > 0, `gold=${fmt(num(b0.customer_gold_g))}g`);
  check('platform inventory is seeded', num(b0.platform_gold_g) > 0, `inv=${fmt(num(b0.platform_gold_g))}g`);
  check('limits are exposed to the client', !!s0.body?.limits?.min_pkr && !!s0.body?.limits?.max_pkr);

  // ------------------------------------------------------------------ quote
  section('4. Quote lifecycle');
  const q = await api('POST', '/api/quote', { side: 'BUY', pkr_amount: '5000' });
  check('POST /api/quote (BUY, 5000 PKR) returns 200', q.status === 200, `status=${q.status} ${JSON.stringify(q.body?.error || '')}`);
  const qb = q.body || {};
  check('quote carries a quote_id', !!qb.quote_id);
  check('quote carries issued_at and expires_at', !!qb.issued_at && !!qb.expires_at);
  const lifespan = (Date.parse(qb.expires_at) - Date.parse(qb.issued_at)) / 1000;
  check('quote lifespan is 75 seconds', close(lifespan, 75, 2), `lifespan=${lifespan}s`);
  check(
    'quote grams x locked price = quote PKR amount',
    close(num(qb.grams) * num(qb.locked_price_pkr_per_gram), num(qb.pkr_amount), Math.max(num(qb.pkr_amount) * 0.001, 1)),
    `${fmt(num(qb.grams))}g x ${fmt(num(qb.locked_price_pkr_per_gram))} = ${fmt(num(qb.grams) * num(qb.locked_price_pkr_per_gram))} vs ${fmt(num(qb.pkr_amount))}`,
  );
  check(
    'locked price equals the customer-facing buy price, not the raw market reference',
    close(num(qb.locked_price_pkr_per_gram), buy, buy * 0.01) &&
      !close(num(qb.locked_price_pkr_per_gram), market, 1),
    `locked=${fmt(num(qb.locked_price_pkr_per_gram))} buy=${fmt(buy)} market=${fmt(market)}`,
  );
  check('quote records the market reference for auditability', num(qb.market_reference) > 0);

  const belowMin = await api('POST', '/api/quote', { side: 'BUY', pkr_amount: '10' });
  check(
    'below-minimum amount is rejected with AMOUNT_BELOW_MINIMUM',
    belowMin.status === 400 && belowMin.body?.error?.code === 'AMOUNT_BELOW_MINIMUM',
    `status=${belowMin.status} code=${belowMin.body?.error?.code}`,
  );
  const aboveMax = await api('POST', '/api/quote', { side: 'BUY', pkr_amount: '99999999' });
  check(
    'above-maximum amount is rejected with AMOUNT_ABOVE_MAXIMUM',
    aboveMax.status === 400 && aboveMax.body?.error?.code === 'AMOUNT_ABOVE_MAXIMUM',
    `status=${aboveMax.status} code=${aboveMax.body?.error?.code}`,
  );
  const bogus = await api('POST', '/api/confirm', { quote_id: '00000000-0000-4000-8000-000000000000' });
  check(
    'unknown quote id returns QUOTE_NOT_FOUND (distinct from expired)',
    bogus.status === 404 && bogus.body?.error?.code === 'QUOTE_NOT_FOUND',
    `status=${bogus.status} code=${bogus.body?.error?.code}`,
  );

  // ------------------------------------------- settlement + idempotency
  section('5. Settlement, conservation and idempotency');
  const before = (await api('GET', '/api/state')).body.balances;
  const q2 = await api('POST', '/api/quote', { side: 'BUY', pkr_amount: '5000' });
  const qid = q2.body?.quote_id;

  // Fire two confirms CONCURRENTLY — the double-press race.
  const [c1, c2] = await Promise.all([
    api('POST', '/api/confirm', { quote_id: qid }),
    api('POST', '/api/confirm', { quote_id: qid }),
  ]);
  check('both concurrent confirms return 200', c1.status === 200 && c2.status === 200, `statuses=${c1.status}/${c2.status}`);
  const oid1 = c1.body?.receipt?.order_id;
  const oid2 = c2.body?.receipt?.order_id;
  check('both confirms return the SAME order_id', !!oid1 && oid1 === oid2, `${oid1} vs ${oid2}`);
  check(
    'exactly one confirm is flagged as the duplicate',
    (c1.body?.duplicate === true) !== (c2.body?.duplicate === true),
    `duplicate flags = ${c1.body?.duplicate}/${c2.body?.duplicate}`,
  );

  const after = (await api('GET', '/api/state')).body.balances;
  const trades = (await api('GET', '/api/state')).body.trades || [];
  check(
    'exactly ONE trade row exists for this quote id',
    trades.filter((t) => t.order_id === oid1).length === 1,
    `matches=${trades.filter((t) => t.order_id === oid1).length}`,
  );

  const dPkr = num(after.pkr_wallet) - num(before.pkr_wallet);
  const dCust = num(after.customer_gold_g) - num(before.customer_gold_g);
  const dPlat = num(after.platform_gold_g) - num(before.platform_gold_g);
  const settledGrams = num(c1.body?.receipt?.grams);
  const settledPkr = num(c1.body?.receipt?.pkr_amount);

  check('BUY debits PKR by exactly the receipt amount', close(dPkr, -settledPkr, 0.01), `dPKR=${fmt(dPkr)} receipt=${fmt(-settledPkr)}`);
  check('BUY credits customer gold by exactly the receipt grams', close(dCust, settledGrams, 0.00005), `dCust=${fmt(dCust)} receipt=${fmt(settledGrams)}`);
  check('BUY debits platform inventory by the SAME gram amount', close(dPlat, -settledGrams, 0.00005), `dPlat=${fmt(dPlat)}`);
  check('gold is conserved — customer gain equals platform loss', close(dCust + dPlat, 0, 0.00005), `sum=${fmt(dCust + dPlat)}`);
  check('receipt discloses the rounding policy', typeof c1.body?.receipt?.rounding_note === 'string' && c1.body.receipt.rounding_note.length > 0);
  check('receipt records source and market reference', !!c1.body?.receipt?.price_source && num(c1.body?.receipt?.market_reference) > 0);

  // SELL side conservation
  const beforeS = (await api('GET', '/api/state')).body.balances;
  const qs = await api('POST', '/api/quote', { side: 'SELL', grams: '0.05' });
  check('POST /api/quote (SELL by grams) returns 200', qs.status === 200, `status=${qs.status} ${JSON.stringify(qs.body?.error || '')}`);
  if (qs.status === 200) {
    const cs = await api('POST', '/api/confirm', { quote_id: qs.body.quote_id });
    check('SELL confirm returns 200', cs.status === 200, `status=${cs.status}`);
    const afterS = (await api('GET', '/api/state')).body.balances;
    const sg = num(cs.body?.receipt?.grams);
    const sp = num(cs.body?.receipt?.pkr_amount);
    check('SELL credits PKR by the receipt amount', close(num(afterS.pkr_wallet) - num(beforeS.pkr_wallet), sp, 0.01));
    check('SELL debits customer gold by the receipt grams', close(num(afterS.customer_gold_g) - num(beforeS.customer_gold_g), -sg, 0.00005));
    check(
      'SELL returns the gold to platform inventory (conserved)',
      close(num(afterS.platform_gold_g) - num(beforeS.platform_gold_g), sg, 0.00005),
    );
    check(
      'SELL locked price equals the customer-facing sell price',
      close(num(cs.body?.receipt?.locked_price_pkr_per_gram), sell, sell * 0.02),
      `locked=${fmt(num(cs.body?.receipt?.locked_price_pkr_per_gram))} sell=${fmt(sell)}`,
    );
  }

  // ------------------------------------------------------------- guardrail
  section('6. Guardrail (reviewer-triggerable, no code change)');
  const highFloor = Math.round(market * 1.5);
  await api('POST', '/api/demo/guardrail', { pkr_per_gram: String(highFloor) });
  const pg = (await api('GET', '/api/price')).body;
  check('guardrail_applied flips to true when the floor binds', pg.guardrail_applied === true, `applied=${pg.guardrail_applied}`);
  check(
    'buy price is floored at the guardrail value',
    close(num(pg.buy_pkr_per_gram), highFloor, 1),
    `buy=${fmt(num(pg.buy_pkr_per_gram))} floor=${fmt(highFloor)}`,
  );
  check('sell price is unaffected by the buy-side floor', close(num(pg.sell_pkr_per_gram), num(pg.market_pkr_per_gram) * 0.9, 1));
  const qg = await api('POST', '/api/quote', { side: 'BUY', pkr_amount: '5000' });
  check('a quote issued under the guardrail carries guardrail_applied', qg.body?.guardrail_applied === true);
  await api('POST', '/api/demo/guardrail', { reset: true });
  const pgr = (await api('GET', '/api/price')).body;
  check('guardrail reset restores the normal buy price', pgr.guardrail_applied === false, `applied=${pgr.guardrail_applied}`);

  // --------------------------------------------------- source degradation
  section('7. Source failure, fallback and trading pause');
  await api('POST', '/api/demo/source-failure', { mode: 'primary' });
  const pf = (await api('GET', '/api/price')).body;
  check('primary failure falls back to goldprice', pf.source === 'goldprice', `source=${pf.source}`);
  check('trading stays enabled on the fallback source', pf.trading_enabled === true);
  check('fallback price is still a plausible PKR/gram value', num(pf.market_pkr_per_gram) > 5000 && num(pf.market_pkr_per_gram) < 500000, `market=${fmt(num(pf.market_pkr_per_gram))}`);
  check(
    'fallback agrees with the primary within 2% (normalization cross-check)',
    close(num(pf.market_pkr_per_gram), market, market * 0.02),
    `fallback=${fmt(num(pf.market_pkr_per_gram))} primary=${fmt(market)}`,
  );

  await api('POST', '/api/demo/source-failure', { mode: 'both' });
  const pb = (await api('GET', '/api/price')).body;
  check('both sources failing reports UNAVAILABLE', pb.freshness === 'UNAVAILABLE', `freshness=${pb.freshness}`);
  check('both sources failing disables trading', pb.trading_enabled === false);
  check('a paused_reason is given in plain language', typeof pb.paused_reason === 'string' && pb.paused_reason.length > 0, `reason=${pb.paused_reason}`);
  check('no price is presented as live while paused', pb.market_pkr_per_gram === null, `market=${pb.market_pkr_per_gram}`);
  const qp = await api('POST', '/api/quote', { side: 'BUY', pkr_amount: '5000' });
  check(
    'quoting while paused is rejected with TRADING_PAUSED',
    qp.status === 409 && qp.body?.error?.code === 'TRADING_PAUSED',
    `status=${qp.status} code=${qp.body?.error?.code}`,
  );
  await api('POST', '/api/demo/source-failure', { mode: 'none' });
  const pn = (await api('GET', '/api/price')).body;
  check('restoring sources resumes trading on the primary', pn.trading_enabled === true && pn.source === 'pakgold', `source=${pn.source}`);

  // ------------------------------------------------------- insufficiency
  section('8. Insufficiency cases (cash, gold, inventory)');
  await api('POST', '/api/demo/scenario', { scenario: 'low_cash' });
  const lc = await api('POST', '/api/quote', { side: 'BUY', pkr_amount: '50000' });
  check(
    'low cash yields INSUFFICIENT_PKR',
    lc.status === 409 && lc.body?.error?.code === 'INSUFFICIENT_PKR',
    `status=${lc.status} code=${lc.body?.error?.code}`,
  );
  check(
    'INSUFFICIENT_PKR reports a numeric shortfall, not a generic error',
    num(lc.body?.error?.details?.shortfall) > 0,
    `shortfall=${lc.body?.error?.details?.shortfall}`,
  );

  await api('POST', '/api/demo/scenario', { scenario: 'low_gold' });
  // 1g, not 5g: a 5g sell exceeds the PKR 50,000 max and is correctly rejected
  // as AMOUNT_ABOVE_MAXIMUM before any balance check runs. 1g stays inside the
  // limits while still exceeding the 0.05g the low_gold scenario holds.
  const lg = await api('POST', '/api/quote', { side: 'SELL', grams: '1' });
  check(
    'low gold yields INSUFFICIENT_GOLD',
    lg.status === 409 && lg.body?.error?.code === 'INSUFFICIENT_GOLD',
    `status=${lg.status} code=${lg.body?.error?.code}`,
  );
  check('INSUFFICIENT_GOLD reports a shortfall', num(lg.body?.error?.details?.shortfall) > 0, `shortfall=${lg.body?.error?.details?.shortfall}`);

  await api('POST', '/api/demo/scenario', { scenario: 'low_inventory' });
  const li = await api('POST', '/api/quote', { side: 'BUY', pkr_amount: '50000' });
  check(
    'low inventory yields INSUFFICIENT_INVENTORY',
    li.status === 409 && li.body?.error?.code === 'INSUFFICIENT_INVENTORY',
    `status=${li.status} code=${li.body?.error?.code}`,
  );
  check('INSUFFICIENT_INVENTORY reports a shortfall', num(li.body?.error?.details?.shortfall) > 0, `shortfall=${li.body?.error?.details?.shortfall}`);

  await api('POST', '/api/demo/scenario', { scenario: 'normal' });
  const sn = (await api('GET', '/api/state')).body;
  check('scenario reset restores the normal wallet', close(num(sn.balances.pkr_wallet), 250000, 0.01), `wallet=${fmt(num(sn.balances.pkr_wallet))}`);
  check('the append-only ledger survives a scenario reset', (sn.trades || []).length > 0, `trades=${(sn.trades || []).length}`);

  // ----------------------------------------------------------- expiry
  section('9. Quote expiry is enforced server-side');
  const qe = await api('POST', '/api/quote', { side: 'BUY', pkr_amount: '5000' });
  const waitMs = Date.parse(qe.body.expires_at) - Date.now() + 2000;
  console.log(c.dm(`  (waiting ${Math.round(waitMs / 1000)}s for the quote to expire...)`));
  await new Promise((r) => setTimeout(r, Math.max(waitMs, 0)));
  const tradesBeforeExpiry = ((await api('GET', '/api/state')).body.trades || []).length;
  const ce = await api('POST', '/api/confirm', { quote_id: qe.body.quote_id });
  check(
    'confirming an expired quote returns 410 QUOTE_EXPIRED',
    ce.status === 410 && ce.body?.error?.code === 'QUOTE_EXPIRED',
    `status=${ce.status} code=${ce.body?.error?.code}`,
  );
  const tradesAfterExpiry = ((await api('GET', '/api/state')).body.trades || []).length;
  check('an expired quote writes NO trade row', tradesAfterExpiry === tradesBeforeExpiry, `${tradesBeforeExpiry} -> ${tradesAfterExpiry}`);
  check('the expired message differs from the not-found message', ce.body?.error?.message !== bogus.body?.error?.message);

  // ----------------------------------------------------------- frontend
  section('10. Frontend is served from the same origin');
  const idx = await fetch(BASE + '/');
  const html = await idx.text();
  check('GET / returns 200', idx.status === 200, `status=${idx.status}`);
  check('GET / returns an HTML document', /<!doctype html|<html/i.test(html), `first bytes: ${html.slice(0, 60).replace(/\n/g, ' ')}`);
  check('index references a built JS bundle', /<script[^>]+src=/i.test(html));
  const deep = await fetch(BASE + '/buy');
  check('SPA deep link falls back to index.html', deep.status === 200, `status=${deep.status}`);

  await resetToNormal();

  // ------------------------------------------------------------- summary
  console.log(`\n${'='.repeat(60)}`);
  if (failures.length === 0) {
    console.log(c.gr(c.bd(`ALL ${pass} CHECKS PASSED`)));
    process.exit(0);
  } else {
    console.log(c.rd(c.bd(`${failures.length} FAILURE(S), ${pass} passed`)));
    for (const f of failures) console.log(c.rd(`  - ${f}`));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(c.rd(`\nHarness crashed: ${e?.stack || e}`));
  process.exit(2);
});
