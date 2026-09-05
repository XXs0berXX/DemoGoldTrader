-- 001_init — ledger + balances.
-- Idempotent: safe to run on every boot and via `npm run migrate`.

-- Human-facing receipt ids: ORDER-YYYY-NNNNNNN.
CREATE SEQUENCE IF NOT EXISTS trade_order_seq START WITH 1 INCREMENT BY 1;

-- ---------------------------------------------------------------------------
-- trades — the immutable ledger. This is the source of truth for what happened.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trades (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          text         UNIQUE NOT NULL,
  -- The idempotency key is the quote id. UNIQUE here is what makes
  -- "press Confirm twice -> exactly one trade" true even under a race,
  -- across processes, without any application-level lock.
  idempotency_key   text         UNIQUE NOT NULL,
  side              text         NOT NULL CHECK (side IN ('BUY', 'SELL')),
  grams             numeric(18,4) NOT NULL CHECK (grams > 0),
  pkr_amount        numeric(18,2) NOT NULL CHECK (pkr_amount > 0),
  locked_price      numeric(18,2) NOT NULL CHECK (locked_price > 0),  -- customer-facing PKR/gram
  market_reference  numeric(18,2) NOT NULL CHECK (market_reference > 0), -- pre-spread, for audit
  price_source      text         NOT NULL CHECK (price_source IN ('pakgold', 'goldprice')),
  price_fetched_at  timestamptz  NOT NULL,
  guardrail_applied boolean      NOT NULL,
  created_at        timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trades_created_at_idx ON trades (created_at DESC);

-- ---------------------------------------------------------------------------
-- Append-only enforcement.
-- The spec calls trades an immutable ledger; make the database mean it.
-- TRUNCATE is intentionally still allowed so the test suite can reset.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trades_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trades is an append-only ledger: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS trades_append_only ON trades;
CREATE TRIGGER trades_append_only
  BEFORE UPDATE OR DELETE ON trades
  FOR EACH ROW EXECUTE FUNCTION trades_reject_mutation();

-- ---------------------------------------------------------------------------
-- balances — mutable, singleton ('demo'), only ever written inside the settle
-- transaction. The CHECK constraints are the last line of defence: even a bug
-- in the application layer cannot drive a balance negative.
--
-- grams are numeric(18,4) (not the spec's 18,6) so balances round-trip at the
-- same precision as trades.grams and match the exact strings in the contract's
-- example payloads ("6.8420", not "6.842000").
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS balances (
  id              text          PRIMARY KEY,
  pkr_wallet      numeric(18,2) NOT NULL CHECK (pkr_wallet >= 0),
  customer_gold_g numeric(18,4) NOT NULL CHECK (customer_gold_g >= 0),
  platform_gold_g numeric(18,4) NOT NULL CHECK (platform_gold_g >= 0),
  updated_at      timestamptz   NOT NULL DEFAULT now()
);
