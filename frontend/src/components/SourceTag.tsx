import type { PriceResponse, PriceSource } from '../api/types';
import { formatAge } from '../lib/format';

const SOURCE_LABEL: Record<PriceSource, string> = {
  pakgold: 'pakgold',
  goldprice: 'goldprice',
};

/**
 * Which upstream is live right now. `goldprice` means the primary source failed
 * and we fell through to the fallback — worth flagging, so it is styled
 * differently rather than reading as business as usual.
 */
export function SourceTag({ price }: { price: PriceResponse | null }): JSX.Element {
  if (!price || price.freshness === 'UNAVAILABLE' || !price.source) {
    return (
      <span className="sourcetag sourcetag--none" title="No source is currently trusted">
        no source
      </span>
    );
  }
  const fallback = price.source === 'goldprice';
  return (
    <span
      className={`sourcetag${fallback ? ' sourcetag--fallback' : ''}`}
      title={
        fallback
          ? 'Primary source (pakgold) is unavailable — showing the fallback source.'
          : 'Primary price source.'
      }
    >
      {SOURCE_LABEL[price.source]}
      {fallback ? ' · fallback' : ''}
    </span>
  );
}

/**
 * Freshness line: a live dot, when the reference was last refreshed, and the
 * source. Age is derived locally from `fetched_at` against a ticking clock so
 * it keeps counting up between polls instead of freezing on the last
 * server-reported `age_seconds`.
 */
export function FreshnessLine({
  price,
  now,
}: {
  price: PriceResponse | null;
  now: number;
}): JSX.Element {
  const live = price?.freshness === 'LIVE';
  const ageSeconds =
    price?.fetched_at && Number.isFinite(Date.parse(price.fetched_at))
      ? (now - Date.parse(price.fetched_at)) / 1000
      : price?.age_seconds ?? null;

  return (
    <span className="rateblock__freshness">
      <span className={`dot ${live ? 'dot--live' : 'dot--paused'}`} aria-hidden="true" />
      {live ? `Updated ${formatAge(ageSeconds)}` : 'Rate unavailable'}
    </span>
  );
}
