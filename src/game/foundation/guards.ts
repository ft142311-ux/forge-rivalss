function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Read a canonical Foundation roster without silently converting malformed
 * stored data into an empty squad. Player IDs are required and unique because
 * lineup, training, match and market flows all address players by ID.
 */
export function readFoundationRoster(value: unknown): Record<string, any>[] {
  if (!Array.isArray(value)) throw new Error('FOUNDATION_ROSTER_INVALID');

  const ids = new Set<string>();
  for (const player of value) {
    if (!isRecord(player) || typeof player.id !== 'string') {
      throw new Error('FOUNDATION_ROSTER_INVALID');
    }
    const id = player.id.trim();
    if (!id || id !== player.id || id.length > 128 || ids.has(id)) {
      throw new Error('FOUNDATION_ROSTER_INVALID');
    }
    ids.add(id);
  }

  return value as Record<string, any>[];
}

/**
 * Shared strict parser for persisted Foundation currency and treasury values.
 * Missing legacy values remain zero; blank strings and malformed numbers do
 * not silently become a free balance.
 */
export function readFoundationNonNegativeInteger(value: unknown, errorCode: string): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'string' && value.trim().length === 0) throw new Error(errorCode);
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(errorCode);
  return parsed;
}

export function readFoundationStaffSalary(value: unknown): number {
  return readFoundationNonNegativeInteger(value, 'FOUNDATION_SALARY_INVALID');
}

/**
 * Null/missing staff slots are valid. A malformed staff container or member
 * fails closed so the daily cycle cannot silently skip a salary obligation.
 */
export function readFoundationStaff(value: unknown): Record<string, any> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error('FOUNDATION_STAFF_INVALID');

  for (const member of Object.values(value)) {
    if (member !== null && member !== undefined && !isRecord(member)) {
      throw new Error('FOUNDATION_STAFF_INVALID');
    }
  }

  return value;
}
