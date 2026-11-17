export function resolveMarketBidExpiryMs(value: unknown): number | null {
  try {
    const candidate = value as any;
    const milliseconds = candidate && typeof candidate.toMillis === 'function'
      ? candidate.toMillis()
      : candidate instanceof Date
        ? candidate.getTime()
        : typeof candidate === 'number'
          ? candidate
          : typeof candidate === 'string'
            ? Date.parse(candidate)
            : candidate && typeof candidate.toDate === 'function'
              ? candidate.toDate().getTime()
              : NaN;
    return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : null;
  } catch {
    return null;
  }
}

export function resolveMarketBidPrice(currentBid: unknown, startingPrice: unknown): number | null {
  const raw = currentBid === null || currentBid === undefined ? startingPrice : currentBid;
  if (typeof raw !== 'number' && (typeof raw !== 'string' || !raw.trim())) return null;
  const price = Number(raw);
  return Number.isSafeInteger(price) && price >= 0 ? price : null;
}
