/**
 * Shared validation for Firestore match document IDs.
 *
 * Callers may retain their historical backslash policy through the option:
 * the universal resolver rejects backslashes, while friendly-match actions
 * preserve their existing acceptance of them.
 */
export function assertMatchDocumentId(
  matchId: unknown,
  options: { rejectBackslash?: boolean } = {},
): asserts matchId is string {
  const forbidden = options.rejectBackslash
    ? /[\\\\/#?\[\]]/
    : /[\/#?\[\]]/;

  if (
    typeof matchId !== 'string' ||
    !matchId.trim() ||
    matchId.length > 180 ||
    forbidden.test(matchId)
  ) {
    throw new Error('INVALID_MATCH_ID');
  }
}
