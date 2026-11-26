import { clamp } from './player-system';
import { DEFAULT_TACTICS } from './config';
import type { FoundationPlayerState, FoundationTactics, LaneDirection } from './types';

export function normalizeTactics(input?: Partial<FoundationTactics>): FoundationTactics {
  return { ...DEFAULT_TACTICS, ...(input || {}) };
}

export function tacticalMultiplier(player: FoundationPlayerState, tacticsInput?: Partial<FoundationTactics>) {
  const tactics = normalizeTactics(tacticsInput);
  const skill = player.proStats || {};
  const directionSkill = tactics.direction === 'easy' ? skill.lastHitting : tactics.direction === 'hard' ? skill.objectiveControl : skill.reflexes;
  const tempoSkill = (skill.reflexes + skill.positioning + skill.mapAwareness + skill.versatility) / 4;
  const styleSkill = tactics.style === 'offense' ? (skill.reflexes + skill.ganking) / 2 : (skill.mapAwareness + skill.positioning + skill.communication) / 3;
  const pressing = tactics.pressing === 'high' ? 1.035 : tactics.pressing === 'low' ? .975 : 1;
  const tempoTarget = tactics.tempo === 'fast' ? tempoSkill / 100 : tactics.tempo === 'slow' ? 1 - tempoSkill / 500 : 1;
  const risk = tactics.risk === 'aggressive' ? 1.03 : tactics.risk === 'cautious' ? .975 : 1;
  const direction = .96 + clamp(Number(directionSkill || 0)) / 250;
  const style = .96 + clamp(Number(styleSkill || 0)) / 250;
  return clamp(pressing * risk * (0.85 + tempoTarget * .15) * direction * style, .75, 1.30);
}

export function laneLabel(direction: LaneDirection) {
  return direction === 'easy' ? 'Лёгкая линия' : direction === 'hard' ? 'Сложная линия' : 'МИД';
}
