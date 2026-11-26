import type { FoundationFansState } from './types';
import { clamp } from './player-system';

export function updateFansAfterHomeMatch(fans: FoundationFansState | undefined, attendance: number, won: boolean): FoundationFansState {
  const current = fans || { mood: 50, communitySize: 1000, attendanceLast3: [], attendance: 0 };
  const history = [...(current.attendanceLast3 || []), Math.max(0, attendance)].slice(-3);
  const moodDelta = won ? 3 : -2;
  const communityDelta = won ? 10 : 1;
  return { ...current, mood: clamp(current.mood + moodDelta), communitySize: Math.max(0, current.communitySize + communityDelta), attendanceLast3: history, attendance: attendance };
}

export function expectedAttendance(fans: FoundationFansState | undefined, capacity: number) {
  const f = fans || { mood: 50, communitySize: 1000, attendanceLast3: [], attendance: 0 };
  const moodFactor = .45 + clamp(f.mood) / 180;
  const recent = f.attendanceLast3.length ? f.attendanceLast3.reduce((a,b)=>a+b,0)/f.attendanceLast3.length : 0;
  return Math.min(capacity, Math.max(0, Math.round(Math.max(recent, f.communitySize * .35) * moodFactor)));
}
