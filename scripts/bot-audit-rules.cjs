'use strict';

// Canonical training/proStats fields used by the project model.
const EXPECTED_PRO_STATS = [
  'lastHitting', 'mapAwareness', 'positioning', 'reflexes', 'manaManagement',
  'objectiveControl', 'communication', 'tiltResistance', 'versatility', 'ganking',
];

function validateBotPlayer(player) {
  const errors = [];
  const ovr = Number(player?.overallRating ?? player?.ovr ?? player?.rating);
  if (!Number.isFinite(ovr) || ovr < 23 || ovr > 27) {
    errors.push(`OVR_OUT_OF_RANGE:${String(ovr)}`);
  }

  const stats = player?.proStats;
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
    errors.push('PROSTATS_MISSING_OR_NOT_OBJECT');
    return errors;
  }

  for (const key of EXPECTED_PRO_STATS) {
    if (!Object.prototype.hasOwnProperty.call(stats, key)) {
      errors.push(`PROSTATS_MISSING_FIELD:${key}`);
      continue;
    }
    if (typeof stats[key] !== 'number' || !Number.isFinite(stats[key])) {
      errors.push(`PROSTATS_NON_NUMERIC:${key}`);
    }
  }

  return errors;
}

module.exports = { EXPECTED_PRO_STATS, validateBotPlayer };
