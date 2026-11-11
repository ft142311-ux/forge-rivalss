import 'server-only';
import { randomUUID } from 'node:crypto';
import { clampNumber } from '@/app/lib/numeric-utils';
import { isPlayerSkillKey } from '@/game/player-skills';
import { getMatchWinnerId } from '@/app/lib/match-winner';
import { aggregatePlayerCombatStats } from '@/app/lib/player-combat-stats';

/**
 * @fileOverview Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р Р†РІР‚С›РЎС›Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В Р вЂ№Р В Р вЂ Р Р†Р вЂљРЎвЂєР РЋРЎвЂєР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р Р†РІР‚С›РЎС›Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р РЋРЎв„ўР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРЎС™Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р Р†РІР‚С›РЎС›Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’ВР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р В РІР‚В Р В Р вЂ Р В РІР‚С™Р РЋРІР‚С”Р В Р Р‹Р РЋРІР‚С”Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р Р†РІР‚С›РЎС›Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р РЋРЎв„ўР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р вЂ Р Р†Р вЂљРЎвЂєР РЋРЎвЂєР В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В¬Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В Р вЂ№Р В Р вЂ Р Р†Р вЂљРЎвЂєР РЋРЎвЂєР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р вЂ Р Р†Р вЂљРЎвЂєР РЋРЎвЂєР В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В«Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРІР‚СњР В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРІР‚Сњ Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р В РІР‚В Р В Р вЂ Р В РІР‚С™Р РЋРІР‚С”Р В Р Р‹Р РЋРІР‚С”Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р Р†РІР‚С›РЎС›Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р Р†Р вЂљРЎвЂќР В Р’В Р В Р вЂ№Р В Р Р‹Р Р†Р вЂљРЎвЂќР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р Р†Р вЂљРЎСљР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРЎС™Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В Р вЂ№Р В Р вЂ Р Р†Р вЂљРЎвЂєР РЋРЎвЂєР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРЎС™Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В РІР‚В Р В Р вЂ Р В РІР‚С™Р РЋРІР‚С”Р В Р Р‹Р РЋРІР‚С”Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В Р вЂ№Р В Р вЂ Р Р†Р вЂљРЎвЂєР РЋРЎвЂєР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р вЂ Р Р†Р вЂљРЎвЂєР РЋРЎвЂєР В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В«Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРІР‚СњР В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРІР‚Сњ Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р Р†РІР‚С›РЎС›Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В Р вЂ№Р В Р Р‹Р Р†РІР‚С›РЎС›Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р Р†РІР‚С›РЎС›Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р Р†Р вЂљРЎвЂќР В Р’В Р В Р вЂ№Р В Р Р‹Р Р†Р вЂљРЎвЂќР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р вЂ Р Р†Р вЂљРЎвЂєР РЋРЎвЂєР В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’ВР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р Р†РІР‚С›РЎС›Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В Р вЂ№Р В Р вЂ Р Р†Р вЂљРЎвЂєР РЋРЎвЂєР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р В РІР‚В Р В Р вЂ Р В РІР‚С™Р РЋРІР‚С”Р В Р Р‹Р РЋРІР‚С”Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р Р†Р вЂљРЎСљР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р Р†РІР‚С›РЎС›Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРІР‚СњР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р Р†РІР‚С›РЎС›Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р РЋРЎв„ўР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р вЂ Р Р†Р вЂљРЎвЂєР РЋРЎвЂєР В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В¬ v149 (Admin SDK Transition).
 */

import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { isSystemAuctionSeller, normalizeAuctionBalance, resolveAuctionCurrency } from '@/app/lib/auction-settlement';
import { getTableId, MAX_LEVELS } from '@/app/lib/leagues-data';
import { getGlobalSeasonInfo } from '@/app/lib/time-utils';
import { logger } from '@/app/lib/logger';
import { calculateMatchEconomy } from './match-economy';
import { applyTraining } from '@/game/foundation/training';
import type { TrainingSkill } from '@/game/foundation/types';
import { buildMatchTeamSnapshot } from '@/app/lib/match-simulation';
import { runMatchEngine } from '@/app/lib/match-engine';
import { calculateGroupStandings, selectFinishedFixtures } from './season-rollover-standings';
import { evaluateCanonicalDocuments } from './season-canonical';


const SALARY_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
const SALARY_CLUB_SHARE = 0.55;

/**
 * Stage 3A v1 Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р В Р вЂ№Р В Р вЂ Р Р†Р вЂљРЎвЂєР РЋРЎвЂєР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р Р†РІР‚С›РЎС›Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В Р вЂ№Р В Р Р‹Р Р†РІР‚С›РЎС› deterministic sporting engine.
 *
 * IMPORTANT:
 * - There is no random factor in the match result.
 * - Current player skills are the primary input.
 * - Talent/training is intentionally NOT handled here yet.
 * - The extractor accepts the common skill shapes already used by the game:
 *   player.skills.{...}, player.skill.{...}, player.attributes.{...},
 *   plus direct numeric skill fields.
 */
type SportingPlayer = Record<string, any>;



/**
 * Stage 2C: recurring squad salary cycle.
 * The league covers 45% of the gross squad salary; the club pays 55%.
 * The server is authoritative and the salary ledger makes the operation idempotent.
 */
async function processDueSalaries(db: any, nowMs: number) {
  const snap = await db.collection('players_v14').limit(500).get();
  let processed = 0;

  for (const playerDoc of snap.docs) {
    const ref = playerDoc.ref;
    try {
      const result = await db.runTransaction(async (t: any) => {
        const fresh = await t.get(ref);
        if (!fresh.exists) return false;

        const data = fresh.data() || {};
        const ownedPlayers = Array.isArray(data.ownedPlayers) ? data.ownedPlayers : [];
        const grossSalary = ownedPlayers.reduce((sum: number, player: any) => {
          return sum + Math.max(0, Number(player?.salary || 0));
        }, 0);

        if (grossSalary <= 0) return false;

        const ledger = data.salaryLedger || {};
        const lastPaidMs = ledger.lastPaidAt && typeof ledger.lastPaidAt.toMillis === 'function'
          ? ledger.lastPaidAt.toMillis()
          : new Date(ledger.lastPaidAt || 0).getTime();

        if (Number.isFinite(lastPaidMs) && lastPaidMs > 0 && nowMs - lastPaidMs < SALARY_PERIOD_MS) {
          return false;
        }

        const clubCost = Math.floor(grossSalary * SALARY_CLUB_SHARE);
        const previousUnpaid = Math.max(0, Number(ledger.unpaid || 0));
        const amountDue = clubCost + previousUnpaid;
        const before = Math.max(0, Number(data.credits || 0));
        const actualPaid = Math.min(before, amountDue);
        const unpaid = amountDue - actualPaid;
        const paidAt = new Date(nowMs).toISOString();
        const nextDueAt = new Date(nowMs + SALARY_PERIOD_MS).toISOString();
        const periodKey = Math.floor(nowMs / SALARY_PERIOD_MS);
        const txRef = db.collection('economy_transactions').doc(`salary_${playerDoc.id}_${periodKey}`);
        const txSnap = await t.get(txRef);

        if (txSnap.exists) return false;

        t.update(ref, {
          credits: FieldValue.increment(-actualPaid),
          salaryLedger: {
            lastPaidAt: paidAt,
            nextDueAt,
            grossTotal: grossSalary,
            clubCost,
            amountDue,
            actualPaid,
            unpaid,
            subsidyRate: 0.45
          },
          updatedAt: FieldValue.serverTimestamp()
        });

        t.set(txRef, {
          userId: playerDoc.id,
          amount: -actualPaid,
          currency: 'credits',
          type: 'PLAYER_SALARY',
          description: 'Recurring squad salary payment',
          grossSalary,
          leagueSubsidy: Math.floor(grossSalary * 0.45),
          clubCost,
          previousUnpaid,
          amountDue,
          actualPaid,
          unpaid,
          subsidyRate: 0.45,
          balanceBefore: before,
          balanceAfter: before - actualPaid,
          periodKey,
          timestamp: FieldValue.serverTimestamp()
        });

        return true;
      });

      if (result) processed++;
    } catch (error) {
      logger.warn(`[SALARY] Failed for ${playerDoc.id}`);
    }
  }

  return processed;
}

class FirestoreBatcher {
  private count = 0;
  private batch;
  constructor(private db: any) {
    this.batch = db.batch();
  }
  async update(ref: any, data: any) {
    this.batch.update(ref, data);
    this.count++;
    if (this.count >= 480) await this.commit();
  }
  async set(ref: any, data: any, options?: any) {
    this.batch.set(ref, data, options);
    this.count++;
    if (this.count >= 480) await this.commit();
  }
  async updateTable(ref: any, data: any) {
    this.batch.set(ref, data, { merge: true });
    this.count++;
    if (this.count >= 480) await this.commit();
  }
  async commit() {
    if (this.count > 0) {
      await this.batch.commit();
      this.batch = this.db.batch();
      this.count = 0;
    }
  }
}

export async function rebuildLeagueTablesFromFinishedMatches(db: any, currentSeason: number, onlyTableIds?: string[]) {
  // Stage 3A.5: league tables are rebuilt from the authoritative finished
  // matches instead of relying only on incremental resolver writes. This keeps
  // the standings correct after catch-up, emulator restarts, or older matches
  // that were already recorded in matches_v2 before the table-sync fix.
  const [tablesSnap, allMatchesSnap] = await Promise.all([
    db.collection('league_tables_v2').where('season', '==', currentSeason).where('leagueId', '==', 'ALPHA').where('version', '==', 140).get(),
    db.collection('matches_v2')
      .where('season', '==', currentSeason)
      .where('version', '==', 140)
      .get(),
  ]);
  const slotsSnap = await db.collection('league_slots_v1')
    .where('season', '==', currentSeason)
    .where('leagueId', '==', 'ALPHA')
    .get();

  const leagueMatches = allMatchesSnap.docs.filter((doc: any) => String((doc.data() || {}).type || 'league').toLowerCase() === 'league');
  const canonicalReadiness = evaluateCanonicalDocuments({ tables: tablesSnap.docs, slots: slotsSnap.docs, matches: leagueMatches });
  if (!canonicalReadiness.ready) {
    return {
      success: false,
      code: 'CANONICAL_SEASON_STRUCTURE_INVALID',
      diagnostics: canonicalReadiness.reasons,
      skippedTables: 0,
      finishedMatches: allMatchesSnap.docs.filter((doc: any) => (doc.data() || {}).isFinished === true).length,
    };
  }
  const finishedMatchDocs = selectFinishedFixtures(leagueMatches.map((doc: any) => ({ ...(doc.data() || {}), id: doc.id })));
  const invalidFinishedMatches = finishedMatchDocs.filter((match: any) => {
    const home = Number(match.score?.home ?? match.seriesScore?.home ?? match.scoreA);
    const away = Number(match.score?.away ?? match.seriesScore?.away ?? match.scoreB);
    return !Number.isInteger(home) || !Number.isInteger(away) || home < 0 || home > 2 || away < 0 || away > 2 ||
      (home === 0 && away === 0) || (match.status !== undefined && String(match.status).toLowerCase() !== 'finished');
  });
  if (invalidFinishedMatches.length) {
    return {
      success: false,
      code: 'INVALID_FINISHED_MATCH_RESULT',
      diagnostics: invalidFinishedMatches.map((match: any) => ({ matchId: match.id || match.matchId || 'UNKNOWN_MATCH' })),
      skippedTables: 0,
      finishedMatches: finishedMatchDocs.length,
    };
  }

  const byTable = new Map<string, Map<string, any>>();
  const sourceStatsByTable = new Map<string, Record<string, any>>();
  const fixturesByTable = new Map<string, any[]>();

  for (const tableDoc of tablesSnap.docs) {
    const existing = tableDoc.data() || {};
    const stats = existing.stats || {};
    const map = new Map<string, any>();
    for (const [id, entry] of Object.entries(stats)) {
      const e: any = entry || {};
      map.set(id, {
        ...e,
        id,
        matchesPlayed: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        points: 0,
        diff: 0,
      });
    }
    byTable.set(tableDoc.id, map);
    sourceStatsByTable.set(tableDoc.id, stats);
  }

  for (const m of finishedMatchDocs) {
    const tableId = getTableId(
      currentSeason,
      String(m.leagueId || 'ALPHA'),
      Number(m.level || 4),
      Number(m.groupId || 1)
    );
    if (!byTable.has(tableId)) byTable.set(tableId, new Map());
    const table = byTable.get(tableId)!;
    if (!fixturesByTable.has(tableId)) fixturesByTable.set(tableId, []);
    fixturesByTable.get(tableId)!.push(m);

    const homeId = String(m.homeId || '');
    const awayId = String(m.awayId || '');
    if (!homeId || !awayId) continue;

    const ensure = (id: string, name: string, rank: number) => {
      if (!table.has(id)) {
        table.set(id, {
          id,
          name: name || id,
          rank: Number.isFinite(rank) ? rank : 99,
          matchesPlayed: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          points: 0,
          diff: 0,
        });
      }
      return table.get(id);
    };

    const home = ensure(homeId, m.homeName || m.homeClubName || homeId, Number(m.homeRank));
    const away = ensure(awayId, m.awayName || m.awayClubName || awayId, Number(m.awayRank));

    const scoreA = Number(m.seriesScore?.home ?? m.scoreA ?? 0);
    const scoreB = Number(m.seriesScore?.away ?? m.scoreB ?? 0);
    if (![0, 1, 2].includes(scoreA) || ![0, 1, 2].includes(scoreB)) continue;

    home.matchesPlayed += 1;
    away.matchesPlayed += 1;
    home.diff += scoreA - scoreB;
    away.diff += scoreB - scoreA;

    if (scoreA > scoreB) {
      home.wins += 1;
      home.points += 3;
      away.losses += 1;
    } else if (scoreB > scoreA) {
      away.wins += 1;
      away.points += 3;
      home.losses += 1;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += 1;
      away.points += 1;
    }
  }

  const diagnostics: any[] = [];
  let skippedTables = 0;
  const pendingWrites: Array<{ tableId: string; stats: Record<string, any> }> = [];
  const expectedTableIds: string[] = [];
  for (let level = 1; level <= MAX_LEVELS; level++) {
    for (let group = 1; group <= Math.pow(2, level - 1); group++) {
      expectedTableIds.push(getTableId(currentSeason, 'ALPHA', level, group));
    }
  }
  const tablesToRebuild = onlyTableIds ? expectedTableIds.filter(id => onlyTableIds.includes(id)) : expectedTableIds;
  for (const tableId of tablesToRebuild) {
    const table = byTable.get(tableId) || new Map<string, any>();
    const fixtures = fixturesByTable.get(tableId) || [];
    if (!sourceStatsByTable.has(tableId)) {
      skippedTables++;
      diagnostics.push({ tableId, reasons: ['TABLE_MISSING'], staleRows: [], slotConflicts: [] });
      continue;
    }
    const resultFixtures = selectFinishedFixtures(fixtures);
    const rebuiltRows = calculateGroupStandings(sourceStatsByTable.get(tableId) || {}, resultFixtures);
    if (rebuiltRows.length !== 8 || new Set(rebuiltRows.map(row => String(row.id))).size !== 8) {
      skippedTables++;
      diagnostics.push({
        tableId,
        reasons: ['PARTIAL_STANDINGS_PROJECTION_INVALID'],
        staleRows: [],
        slotConflicts: [],
      });
      continue;
    }
    const stats: Record<string, any> = Object.fromEntries(rebuiltRows.map(row => [String(row.id), row]));
    pendingWrites.push({ tableId, stats });
  }
  if (diagnostics.length) {
    return {
      success: false,
      code: 'STANDINGS_REBUILD_PREFLIGHT_FAILED',
      diagnostics,
      skippedTables,
      finishedMatches: finishedMatchDocs.length,
    };
  }

  const writes = new FirestoreBatcher(db);
  for (const { tableId, stats } of pendingWrites) {
    await writes.set(db.collection('league_tables_v2').doc(tableId), {
      stats,
      updatedAt: FieldValue.serverTimestamp(),
      standingsEngine: 'stage3a5-finished-matches-rebuild',
    }, { merge: true });
  }
  await writes.commit();

  return { success: true, tables: pendingWrites.length, skippedTables: 0, diagnostics: [], finishedMatches: finishedMatchDocs.length };
}

/**
 * Narrow, idempotent recovery for the single canonical Season 1 fixture that
 * was observed stuck in processing. It does not update player stats, credits,
 * or the transaction ledger. It rebuilds the group standings from
 * finished matches for this group.
 */
export async function recoverStuckSeason1MatchAction(cronToken: string) {
  // This recovery is exposed by a Next.js Server Actions module. Keep the
  // worker-only operation behind the same server secret as its cron route so
  // callers cannot force-settle a match by invoking the action directly.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || typeof cronToken !== 'string' || cronToken !== cronSecret) {
    return { success: false, code: 'UNAUTHORIZED' };
  }
  const recoveryStartedAt = Date.now();
  const targetMatchId = 'match_v140_S1_LALPHA_V3_G1_T14_R2_vs_R1';
  console.info('[TARGETED MATCH RECOVERY] start', { targetMatchId, at: new Date(recoveryStartedAt).toISOString() });
  const recoveryToken = `targeted-season1-recovery:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const db = getAdminDb();
  const configSnap = await db.collection('system_v1').doc('season_config').get();
  const config = configSnap.exists ? (configSnap.data() || {}) : {};
  console.info('[TARGETED MATCH RECOVERY] season config read', { exists: configSnap.exists, activeSeasonNumber: config.activeSeasonNumber });
  if (Number(config.activeSeasonNumber || 1) !== 1) {
    console.warn('[TARGETED MATCH RECOVERY] rejected: active season mismatch', { activeSeasonNumber: config.activeSeasonNumber });
    return { success: false, code: 'ACTIVE_SEASON_MISMATCH' };
  }

  const matchRef = db.collection('matches_v2').doc(targetMatchId);
  const claim = await db.runTransaction(async (tx: any) => {
    const snap = await tx.get(matchRef);
    if (!snap.exists) return { ok: false, code: 'MATCH_NOT_FOUND' };
    const m = snap.data() || {};
    if (Number(m.season) !== 1 || Number(m.version) !== 140 ||
        String(m.type || 'league').toLowerCase() !== 'league') {
      return { ok: false, code: 'MATCH_IDENTITY_MISMATCH' };
    }
    if (m.isFinished === true || String(m.status || '').toLowerCase() === 'finished') {
      return { ok: false, code: 'ALREADY_FINISHED' };
    }
    const now = Date.now();
    const toMillis = (v: any): number => {
      if (v && typeof v.toMillis === 'function') return v.toMillis();
      if (v instanceof Date) return v.getTime();
      const n = typeof v === 'string' || typeof v === 'number' ? new Date(v).getTime() : NaN;
      return Number.isFinite(n) ? n : 0;
    };
    const lockAt = toMillis(m.processingStartedAt) || toMillis(m.updatedAt) || toMillis(m.lastUpdatedAt);
    const scheduledStartAt = toMillis(m.startTime);
    const lockIsStale = lockAt > 0
      ? now - lockAt >= 15 * 60 * 1000
      : scheduledStartAt > 0 && now - scheduledStartAt >= 2 * 60 * 60 * 1000;

    if (m.isProcessing === true && !lockIsStale) {
      return { ok: false, code: 'PROCESSING_LOCK_NOT_STALE' };
    }
    tx.update(matchRef, {
      isProcessing: true,
      processingStartedAt: FieldValue.serverTimestamp(),
      recoveryAttemptedAt: FieldValue.serverTimestamp(),
      recoveryAttemptedBy: recoveryToken
    });
    return { ok: true, match: m };
  });
  if (!claim.ok) {
    console.warn('[TARGETED MATCH RECOVERY] claim rejected', { targetMatchId, code: claim.code });
    return { success: false, code: claim.code };
  }
  console.info('[TARGETED MATCH RECOVERY] lock claimed', { targetMatchId, elapsedMs: Date.now() - recoveryStartedAt });

  try {
    const m = claim.match || {};
    if (!m.homeId || !m.awayId) throw new Error('MATCH_TEAM_IDS_MISSING');
    const [homeSnap, awaySnap] = await Promise.all([
      db.collection('players_v14').doc(String(m.homeId)).get(),
      db.collection('players_v14').doc(String(m.awayId)).get()
    ]);
    console.info('[TARGETED MATCH RECOVERY] team documents read', { homeExists: homeSnap.exists, awayExists: awaySnap.exists, elapsedMs: Date.now() - recoveryStartedAt });
    if (!homeSnap.exists || !awaySnap.exists) throw new Error('MATCH_TEAM_DOCUMENT_MISSING');

    const homeData = homeSnap.data() || {};
    const awayData = awaySnap.data() || {};
    const teamA = buildMatchTeamSnapshot(homeData, m.homeName || 'Home', m.homeId, 'league');
    const teamB = buildMatchTeamSnapshot(awayData, m.awayName || 'Away', m.awayId, 'league');
    console.info('[TARGETED MATCH RECOVERY] simulation start', { targetMatchId, elapsedMs: Date.now() - recoveryStartedAt });
    const simulation = runMatchEngine({ mode: 'league', matchId: targetMatchId, teamA, teamB, bestOf: 2 });
    console.info('[TARGETED MATCH RECOVERY] simulation complete', { targetMatchId, elapsedMs: Date.now() - recoveryStartedAt, seriesScore: simulation?.seriesScore, winnerSide: simulation?.winnerSide });
    const parts = String(simulation.seriesScore || '').split('-');
    const scoreA = Number(parts[0]);
    const scoreB = Number(parts[1]);
    if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB) ||
        scoreA < 0 || scoreB < 0 || scoreA === scoreB) {
      throw new Error('SIMULATION_RESULT_INVALID');
    }
    const winnerId = getMatchWinnerId(simulation.winnerSide, String(m.homeId), String(m.awayId));
    if (!winnerId) throw new Error('SIMULATION_WINNER_MISSING');

    const commit = await db.runTransaction(async (tx: any) => {
      const latestSnap = await tx.get(matchRef);
      if (!latestSnap.exists) throw new Error('MATCH_NOT_FOUND_AT_COMMIT');
      const latest = latestSnap.data() || {};
      if (latest.isFinished === true || String(latest.status || '').toLowerCase() === 'finished') {
        throw new Error('ALREADY_FINISHED_AT_COMMIT');
      }
      if (latest.isProcessing !== true || latest.recoveryAttemptedBy !== recoveryToken) {
        throw new Error('RECOVERY_LOCK_LOST');
      }
      tx.update(matchRef, {
        scoreA, scoreB, winnerId,
        seriesScore: { home: scoreA, away: scoreB },
        bestOf: 2, matchFormat: 'BO2',
        status: 'finished', isFinished: true, isProcessing: false,
        processingStartedAt: FieldValue.delete(),
        sportingEngine: simulation.engineVersion,
        sportingStrength: {
          home: simulation.homeStrength, away: simulation.awayStrength,
          homePlayersUsed: simulation.homePlayersUsed, awayPlayersUsed: simulation.awayPlayersUsed,
          homeOverall: simulation.homeOverall, awayOverall: simulation.awayOverall,
          relativeGap: simulation.relativeGap, homeRoles: simulation.homeRoles, awayRoles: simulation.awayRoles
        },
        simulation,
        recoveryMode: 'targeted-match-only-no-economy-or-player-progression',
        resolvedAt: FieldValue.serverTimestamp(),
        recoveryError: FieldValue.delete()
      });
      return true;
    });
    console.info('[TARGETED MATCH RECOVERY] commit complete', { targetMatchId, scoreA, scoreB, winnerId, elapsedMs: Date.now() - recoveryStartedAt });
    const tableId = getTableId(1, 'ALPHA', 3, 1);
    const standingsSync = await rebuildLeagueTablesFromFinishedMatches(db, 1, [tableId]);
    if (!standingsSync.success) {
      console.error('[TARGETED MATCH RECOVERY] result committed; standings projection requires retry', { tableId, code: standingsSync.code });
    }
    return { success: true, matchId: targetMatchId, scoreA, scoreB, winnerId, standingsSync, sideEffectsSkipped: ['player progression', 'club credits', 'economy ledger'] };
  } catch (error: any) {
    const errorMessage = String(error?.message || error).slice(0, 500);
    console.error('[TARGETED MATCH RECOVERY] failed after claim', { targetMatchId, error: errorMessage, elapsedMs: Date.now() - recoveryStartedAt });
    // Only release this invocation's lock. Never clear another worker's lock or overwrite a finished result.
    await db.runTransaction(async (tx: any) => {
      const latestSnap = await tx.get(matchRef);
      if (!latestSnap.exists) return;
      const latest = latestSnap.data() || {};
      if (latest.isFinished === true || String(latest.status || '').toLowerCase() === 'finished') return;
      if (latest.recoveryAttemptedBy !== recoveryToken) return;
      tx.update(matchRef, {
        isProcessing: false,
        processingStartedAt: FieldValue.delete(),
        recoveryError: errorMessage,
        recoveryFailedAt: FieldValue.serverTimestamp()
      });
    });
    return { success: false, code: 'RECOVERY_FAILED', error: errorMessage };
  }
}
export async function resolveDailyMatches() {
  const info = getGlobalSeasonInfo();
  if (info.isOffseason) logger.info("[LEAGUE RESOLVER] Offseason active; still settling overdue fixtures for the configured season.");

  const db = getAdminDb();
  const configSnap = await db.collection('system_v1').doc('season_config').get();
  const config = configSnap.exists ? (configSnap.data() || {}) : {};
  const currentSeason = Number(config.activeSeasonNumber || info.activeSeasonNumber || 1);
  const salariesPaid = 0; // Salaries are now processed by foundation-cycle at 00:00 MSK.
  const nowIso = new Date().toISOString();

  // IMPORTANT: prebuilt-world matches may store startTime as a Firestore Timestamp,
  // while older calendar documents may store it as an ISO string. Firestore range
  // queries do not safely normalize those two representations. Also, some prebuilt
  // documents may not have isProcessing/isFinished fields at all. Query only by the
  // stable indexed fields, then normalize/filter due matches in server code.
  // A canonical season contains 840 league matches. Fetch the full season;
  // a 400-document cap can leave late-round fixtures out of the resolver.
  const snap = await db.collection('matches_v2')
    .where('season', '==', currentSeason)
    .where('version', '==', 140)
    .get();

  const nowMs = Date.now();
  const dueDocs = snap.docs.filter(doc => {
    const m = doc.data() || {};
    // This worker is the legacy/canonical league settlement worker. Pyramid Cup
    // and other official match types have their own resolver and must never be
    // settled here, otherwise their results could alter league standings.
    if (String(m.type || 'league').toLowerCase() !== 'league') return false;
    if (m.isFinished === true) return false;

    const rawStart = m.startTime;
    let startMs = NaN;
    if (rawStart && typeof rawStart.toMillis === 'function') {
      startMs = rawStart.toMillis();
    } else if (rawStart instanceof Date) {
      startMs = rawStart.getTime();
    } else if (typeof rawStart === 'number') {
      startMs = rawStart;
    } else if (typeof rawStart === 'string') {
      startMs = Date.parse(rawStart);
    }

    if (!Number.isFinite(startMs) || startMs > nowMs) return false;

    // Recover abandoned locks only after a conservative timeout. New locks carry
    // processingStartedAt; legacy locks without it are recoverable only when
    // their scheduled start is at least two hours old.
    if (m.isProcessing === true) {
      const rawLock = m.processingStartedAt;
      let lockMs = NaN;
      if (rawLock && typeof rawLock.toMillis === 'function') lockMs = rawLock.toMillis();
      else if (rawLock instanceof Date) lockMs = rawLock.getTime();
      else if (typeof rawLock === 'number') lockMs = rawLock;
      else if (typeof rawLock === 'string') lockMs = Date.parse(rawLock);

      const lockIsStale = Number.isFinite(lockMs)
        ? nowMs - lockMs >= 15 * 60 * 1000
        : nowMs - startMs >= 2 * 60 * 60 * 1000;
      if (!lockIsStale) return false;
    }

    return true;
  });

  // IMPORTANT: standings rebuild must run even when there are no newly due
  // matches. Otherwise a database where all matches were already marked
  // finished can keep stale league_tables_v2.stats forever.
  // Rebuild BEFORE the early return so Match Center and group standings always
  // converge from the same authoritative matches_v2 history.
  const standingsBeforeResolve = await rebuildLeagueTablesFromFinishedMatches(db, currentSeason);
  if (!standingsBeforeResolve.success) {
    return { success: false, code: standingsBeforeResolve.code, diagnostics: standingsBeforeResolve.diagnostics, skippedTables: standingsBeforeResolve.skippedTables };
  }

  if (dueDocs.length === 0) {
    return {
      success: true,
      count: 0,
      salariesPaid,
      standingsRebuilt: standingsBeforeResolve,
      progress: `Standings rebuilt from ${standingsBeforeResolve.finishedMatches} finished matches`,
    };
  }

  let count = 0;

  for (const matchDoc of dueDocs) {
    const processingToken = randomUUID();
    const claimed = await db.runTransaction(async (tx: any) => {
      const fresh = await tx.get(matchDoc.ref);
      if (!fresh.exists) return false;
      const current = fresh.data() || {};
      if (current.isFinished === true || String(current.status || '').toLowerCase() === 'finished') return false;
      if (String(current.type || 'league').toLowerCase() !== 'league') return false;

      const now = Date.now();
      const rawStart = current.startTime;
      const startMs = rawStart && typeof rawStart.toMillis === 'function'
        ? rawStart.toMillis()
        : rawStart instanceof Date
          ? rawStart.getTime()
          : typeof rawStart === 'number'
            ? rawStart
            : typeof rawStart === 'string'
              ? Date.parse(rawStart)
              : NaN;
      if (!Number.isFinite(startMs) || startMs > now) return false;

      if (current.isProcessing === true) {
        const rawLock = current.processingStartedAt;
        const lockMs = rawLock && typeof rawLock.toMillis === 'function'
          ? rawLock.toMillis()
          : rawLock instanceof Date
            ? rawLock.getTime()
            : typeof rawLock === 'number'
              ? rawLock
              : typeof rawLock === 'string'
                ? Date.parse(rawLock)
                : NaN;
        const stale = Number.isFinite(lockMs)
          ? now - lockMs >= 15 * 60 * 1000
          : now - startMs >= 2 * 60 * 60 * 1000;
        if (!stale) return false;
      }

      tx.update(matchDoc.ref, {
        isProcessing: true,
        processingStartedAt: FieldValue.serverTimestamp(),
        processingToken,
      });
      return true;
    });
    if (!claimed) continue;

    try {
      // Settlement is committed as one Firestore transaction per match. The
      // result, player progression, home revenue, and their idempotency ledgers
      // can no longer be split across independent 480-write batches.
      const settled = await db.runTransaction(async (tx: any) => {
        const latestSnap = await tx.get(matchDoc.ref);
        if (!latestSnap.exists) return false;
        const m = latestSnap.data() || {};
        if (m.isFinished === true || String(m.status || '').toLowerCase() === 'finished') return false;
        if (m.processingToken !== processingToken || m.isProcessing !== true) {
          throw new Error('MATCH_PROCESSING_LOCK_LOST');
        }
        if (String(m.type || 'league').toLowerCase() !== 'league') {
          throw new Error('MATCH_TYPE_CHANGED_DURING_SETTLEMENT');
        }

        const homeId = String(m.homeId || '');
        const awayId = String(m.awayId || '');
        if (homeId && awayId && homeId === awayId) {
          throw new Error('MATCH_SELF_PLAY_INVALID');
        }
        const homeRef = homeId ? db.collection('players_v14').doc(homeId) : null;
        const awayRef = awayId ? db.collection('players_v14').doc(awayId) : null;
        const homeEffectRef = homeId ? db.collection('match_player_effects_v1').doc(`${matchDoc.id}_${homeId}`) : null;
        const awayEffectRef = awayId ? db.collection('match_player_effects_v1').doc(`${matchDoc.id}_${awayId}`) : null;
        const economyTxRef = homeId ? db.collection('economy_transactions').doc(`match_${matchDoc.id}_${homeId}`) : null;

        const reads: Promise<any>[] = [];
        if (homeRef) reads.push(tx.get(homeRef)); else reads.push(Promise.resolve(null));
        if (awayRef) reads.push(tx.get(awayRef)); else reads.push(Promise.resolve(null));
        if (homeEffectRef) reads.push(tx.get(homeEffectRef)); else reads.push(Promise.resolve(null));
        if (awayEffectRef) reads.push(tx.get(awayEffectRef)); else reads.push(Promise.resolve(null));
        if (economyTxRef) reads.push(tx.get(economyTxRef)); else reads.push(Promise.resolve(null));
        const [homeSnap, awaySnap, homeEffectSnap, awayEffectSnap, economyTxSnap] = await Promise.all(reads);

        const homePlayerData = homeSnap?.exists ? (homeSnap.data() || {}) : {};
        const awayPlayerData = awaySnap?.exists ? (awaySnap.data() || {}) : {};
        const teamA = buildMatchTeamSnapshot(homePlayerData, m.homeName || 'Home', homeId || undefined, String(m.type || 'league'));
        const teamB = buildMatchTeamSnapshot(awayPlayerData, m.awayName || 'Away', awayId || undefined, String(m.type || 'league'));
        const simulation = runMatchEngine({ mode: String(m.matchType || m.type || 'league'), matchId: matchDoc.id, teamA, teamB, bestOf: 2 });
        const [scoreA, scoreB] = String(simulation.seriesScore).split('-').map(Number);
        if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0 || scoreA > 2 || scoreB > 2) {
          throw new Error('SIMULATION_RESULT_INVALID');
        }
        const winnerId = getMatchWinnerId(simulation.winnerSide, homeId || null, awayId || null);
        const homeEconomy = await calculateMatchEconomy(homePlayerData, m, scoreA, scoreB);
        const officialClub = true;

        const updatePostMatchPlayers = (clubData: any, side: 'home' | 'away') => {
          const lineup = clubData.lineup || {};
          const ids = ['carry', 'mid', 'offlane', 'support', 'full_support'].map(slot => lineup[slot]).filter(Boolean);
          const gamesPlayed = Math.max(1, simulation.games.length);
          const totalMinutes = simulation.games.reduce((sum: number, game: any) => {
            const board = Array.isArray(game.scoreboard) ? game.scoreboard : [];
            const playerCount = board.filter((player: any) => player.team === (side === 'home' ? m.homeName : m.awayName)).length;
            return sum + (playerCount > 0 ? 28 : 0);
          }, 0);
          const minutes = Math.max(0, Math.round((totalMinutes / gamesPlayed) * gamesPlayed));
          return (Array.isArray(clubData.ownedPlayers) ? clubData.ownedPlayers : []).map((player: any) => {
            if (!ids.includes(player.id)) return player;
            let nextPlayer: any = {
              ...player,
              trainingPropensity: Number.isFinite(Number(player.trainingPropensity)) ? Number(player.trainingPropensity) : 50,
              physical: Number.isFinite(Number(player.physical)) ? Number(player.physical) : 50,
              resilience: Number.isFinite(Number(player.resilience)) ? Number(player.resilience) : 50,
            };
            const focus = nextPlayer.trainingFocus || nextPlayer.dailyTrainingFocus;
            if (focus && isPlayerSkillKey(String(focus)) && nextPlayer.proStats && Object.prototype.hasOwnProperty.call(nextPlayer.proStats, focus)) {
              const foundationPlayer: any = {
                id: String(nextPlayer.id),
                role: nextPlayer.currentRole || nextPlayer.role || 'Support',
                currentRole: nextPlayer.currentRole || nextPlayer.role || 'Support',
                overallRating: Number(nextPlayer.overallRating || 0),
                form: clampNumber(Number(nextPlayer.form ?? 100), 0, 100),
                fatigue: clampNumber(Number(nextPlayer.fatigue ?? 100), 0, 100),
                age: Number(nextPlayer.age || nextPlayer.baseAge || 20),
                salary: Number(nextPlayer.salary || 0),
                tilt: Number(nextPlayer.tilt || 0),
                proStats: { ...(nextPlayer.proStats || {}) },
                proTalents: { ...(nextPlayer.proTalents || {}) },
                trainingProgress: { ...(nextPlayer.trainingProgress || {}) },
                skillCaps: { ...(nextPlayer.skillCaps || {}) },
                skillInclinations: { ...(nextPlayer.skillInclinations || {}) },
                trainingPropensity: nextPlayer.trainingPropensity,
                physical: nextPlayer.physical,
                resilience: nextPlayer.resilience,
              };
              const trained = applyTraining(foundationPlayer, focus as TrainingSkill, minutes).player;
              nextPlayer = { ...nextPlayer, proStats: trained.proStats, skillCaps: trained.skillCaps, trainingProgress: trained.trainingProgress };
            }
            const officialMatches = Number(nextPlayer.chemistryMatches || 0) + (officialClub ? 1 : 0);
            const boards = simulation.games.flatMap((game: any) => Array.isArray(game.scoreboard) ? game.scoreboard : []);
            const teamName = side === 'home' ? m.homeName : m.awayName;
            const perf = boards.filter((row:any) => String(row?.name || '') === String(nextPlayer.name || '') && String(row?.team || '') === String(teamName || ''));
            const season = { ...(nextPlayer.seasonStats || {}) };
            const combatStats = aggregatePlayerCombatStats(perf, { coerceValues: true });
            const { kills, deaths, assists } = combatStats;
            season.matches = Number(season.matches || 0) + 1;
            season.wins = Number(season.wins || 0) + (winnerId === (side === 'home' ? homeId : awayId) ? 1 : 0);
            season.kills = Number(season.kills || 0) + kills;
            season.deaths = Number(season.deaths || 0) + deaths;
            season.assists = Number(season.assists || 0) + assists;
            season.successfulActions = Number(season.successfulActions || 0) + Math.max(0, kills + assists);
            season.warnings = Number(season.warnings || 0) + Number(nextPlayer.warningCount || 0);
            season.postMatchRating = Number(season.postMatchRating || 0) + Number(perf[0]?.rating || perf[0]?.performance || 0);
            return {
              ...nextPlayer,
              seasonStats: season,
              fatigue: Math.max(0, Number(nextPlayer.fatigue ?? 100) - 16),
              form: Math.max(35, Math.min(100, Number(nextPlayer.form ?? 100) + (Number(minutes) >= 45 ? 1 : -1))),
              chemistryMatches: officialMatches,
              lineupMatches: Number(nextPlayer.lineupMatches || 0) + 1,
              lastMatchMinutes: minutes,
              lastMatchId: matchDoc.id,
              lastMatchOfficial: true,
            };
          });
        };

        // All reads are complete before the first transaction write. Build one
        // update per club document so a transaction never queues duplicate writes
        // to the same Firestore document.
        const homeUpdate: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };
        const awayUpdate: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };
        if (homeRef && homeSnap?.exists && !homeEffectSnap?.exists) {
          homeUpdate.ownedPlayers = updatePostMatchPlayers(homePlayerData, 'home');
          tx.set(homeEffectRef!, { matchId: matchDoc.id, userId: homeId, effect: 'PLAYER_PROGRESSION', appliedAt: FieldValue.serverTimestamp() });
        }
        if (awayRef && awaySnap?.exists && !awayEffectSnap?.exists) {
          awayUpdate.ownedPlayers = updatePostMatchPlayers(awayPlayerData, 'away');
          tx.set(awayEffectRef!, { matchId: matchDoc.id, userId: awayId, effect: 'PLAYER_PROGRESSION', appliedAt: FieldValue.serverTimestamp() });
        }

        if (homeRef && homeSnap?.exists && !economyTxSnap?.exists) {
          const before = Number(homePlayerData.credits || 0);
          const after = before + homeEconomy.totalRevenue;
          Object.assign(homeUpdate, {
            credits: after,
            lastMatchEconomy: homeEconomy,
            [`matchEconomy.${matchDoc.id}`]: homeEconomy,
          });
          tx.set(economyTxRef!, {
            userId: homeId,
            amount: homeEconomy.totalRevenue,
            currency: 'credits',
            type: 'MATCH_REVENUE',
            referenceId: matchDoc.id,
            description: 'Official league match revenue',
            matchEconomy: homeEconomy,
            balanceBefore: before,
            balanceAfter: after,
            timestamp: FieldValue.serverTimestamp(),
          });
        }

        if (homeRef && homeSnap?.exists) tx.update(homeRef, homeUpdate);
        if (awayRef && awaySnap?.exists) tx.update(awayRef, awayUpdate);

        tx.update(matchDoc.ref, {
          scoreA,
          scoreB,
          winnerId,
          seriesScore: { home: scoreA, away: scoreB },
          bestOf: 2,
          matchFormat: 'BO2',
          status: 'finished',
          isFinished: true,
          isProcessing: false,
          processingStartedAt: FieldValue.delete(),
          processingToken: FieldValue.delete(),
          matchEconomy: homeEconomy,
          sportingEngine: simulation.engineVersion,
          sportingStrength: {
            home: simulation.homeStrength,
            away: simulation.awayStrength,
            homePlayersUsed: simulation.homePlayersUsed,
            awayPlayersUsed: simulation.awayPlayersUsed,
            homeOverall: simulation.homeOverall,
            awayOverall: simulation.awayOverall,
            relativeGap: simulation.relativeGap,
            homeRoles: simulation.homeRoles,
            awayRoles: simulation.awayRoles,
          },
          simulation,
          settlementVersion: 1,
          lastSettlementError: FieldValue.delete(),
          settledAt: FieldValue.serverTimestamp(),
          resolvedAt: FieldValue.serverTimestamp(),
        });
        return true;
      });
      if (settled) count++;
    } catch (err: any) {
      console.error(`[AUTONOMOUS CYCLE] Failed match ${matchDoc.id}:`, err);
      try {
        await db.runTransaction(async (tx: any) => {
          const latestSnap = await tx.get(matchDoc.ref);
          if (!latestSnap.exists) return;
          const latest = latestSnap.data() || {};
          if (latest.isFinished === true || latest.processingToken !== processingToken) return;
          tx.update(matchDoc.ref, {
            isProcessing: false,
            processingStartedAt: FieldValue.delete(),
            processingToken: FieldValue.delete(),
            lastSettlementError: String(err?.message || 'MATCH_SETTLEMENT_FAILED').slice(0, 300),
          });
        });
      } catch (unlockError) {
        console.error(`[AUTONOMOUS CYCLE] Failed to release match lock ${matchDoc.id}:`, unlockError);
      }
    }
  }

  // Rebuild all league standings from finished BO2 matches so the group table
  // cannot lag behind Match Center/history after catch-up or emulator restart.
  const standingsSync = await rebuildLeagueTablesFromFinishedMatches(db, currentSeason);
  if (!standingsSync.success) {
    return { success: false, code: standingsSync.code, diagnostics: standingsSync.diagnostics, skippedTables: standingsSync.skippedTables, count, salariesPaid };
  }
  logger.info(`Resolved ${count} matches with atomic match/player/economy settlement; rebuilt ${standingsSync.tables} league tables from ${standingsSync.finishedMatches} finished matches; salariesPaid=${salariesPaid}`);
  return { success: true, count, salariesPaid, progress: `Resolved ${count} matches; salaries ${salariesPaid}` };
}




/**
 * Finalizes expired transfer-market listings from the server only.
 *
 * A listing is settled exactly once: the market document is re-read inside a
 * Firestore transaction and deleted only after the seller/buyer/player state is
 * reconciled. If the leading bidder is no longer eligible, the lot expires
 * without a sale and the seller's player is unlocked.
 */
export async function runTransferMarketExpirySweep() {
  const db = getAdminDb();
  const now = Date.now();
  const market = db.collection('market_v7');
  const pageSize = 200;
  let cursor: any = null;
  let scanned = 0;
  const due: any[] = [];

  // Avoid an unbounded collection read while still scanning every listing.
  // Document-ID pagination is stable even when lots are deleted as they settle.
  while (true) {
    let query = market.orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    scanned += page.size;
    for (const doc of page.docs) {
      const lot = doc.data() || {};
      if (lot.status === 'settled' || lot.status === 'expired') continue;
      const raw = lot.expiresAt;
      const expiresAt = raw && typeof raw.toMillis === 'function'
        ? raw.toMillis()
        : raw instanceof Date
          ? raw.getTime()
          : typeof raw === 'number'
            ? raw
            : typeof raw === 'string'
              ? Date.parse(raw)
              : NaN;
      if (Number.isFinite(expiresAt) && expiresAt <= now) due.push(doc);
    }
    cursor = page.docs[page.docs.length - 1];
    if (page.size < pageSize) break;
  }

  let settled = 0;
  let sold = 0;
  let expiredWithoutSale = 0;
  let skipped = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const candidate of due) {
    const transferRef = db.collection('transfer_history').doc();
    try {
      const result = await db.runTransaction(async (tx: any) => {
        const lotRef = db.collection('market_v7').doc(candidate.id);
        const lotSnap = await tx.get(lotRef);
        if (!lotSnap.exists) return 'SKIPPED';
        const lot: any = lotSnap.data() || {};
        if (lot.status === 'settled' || lot.status === 'expired') return 'SKIPPED';
        const rawExpiry = lot.expiresAt;
        const expiryMs = rawExpiry && typeof rawExpiry.toMillis === 'function'
          ? rawExpiry.toMillis()
          : rawExpiry instanceof Date
            ? rawExpiry.getTime()
            : typeof rawExpiry === 'number'
              ? rawExpiry
              : typeof rawExpiry === 'string'
                ? Date.parse(rawExpiry)
                : NaN;
        if (!Number.isFinite(expiryMs) || expiryMs > Date.now()) return 'SKIPPED';

        const sellerId = String(lot.sellerId || '');
        const bidderId = String(lot.highestBidderId || lot.highestBidderUid || '');
        const price = Math.max(0, Math.floor(Number(lot.currentBid || lot.startingPrice || lot.price) || 0));
        const playerId = String(lot.heroData?.id || lot.playerId || '');

        const isSystemSeller = isSystemAuctionSeller(sellerId, lot.isSystem);
        const currency = resolveAuctionCurrency(lot.currency);
        const sellerRef = isSystemSeller || !sellerId ? null : db.collection('players_v14').doc(sellerId);
        const buyerRef = bidderId && bidderId !== sellerId ? db.collection('players_v14').doc(bidderId) : null;
        const sellerSnap = sellerRef ? await tx.get(sellerRef) : null;
        const buyerSnap = buyerRef ? await tx.get(buyerRef) : null;
        const seller: any = sellerSnap?.exists ? sellerSnap.data() || {} : {};
        const buyer: any = buyerSnap?.exists ? buyerSnap.data() || {} : {};
        const playerArrayKey = lot.isYouth === true ? 'youthAcademyPlayers' : 'ownedPlayers';
        const sellerPlayers: any[] = Array.isArray(seller[playerArrayKey]) ? [...seller[playerArrayKey]] : [];
        const sellerIndex = sellerPlayers.findIndex((player: any) => String(player?.id) === playerId);
        const systemPlayer: any = isSystemSeller && lot.heroData?.id === playerId ? lot.heroData : null;
        const buyerPlayers: any[] = Array.isArray(buyer[playerArrayKey]) ? [...buyer[playerArrayKey]] : [];
        const buyerBalance = normalizeAuctionBalance(buyer[currency]);
        const escrowedAmount = lot.escrowCurrency === currency ? normalizeAuctionBalance(lot.escrowedAmount) : 0;
        const hasValidEscrow = escrowedAmount >= price && price > 0;
        const sellerExists = isSystemSeller ? Boolean(systemPlayer) : Boolean(sellerSnap?.exists && sellerIndex >= 0);
        const validSale = Boolean(
          sellerExists && buyerSnap?.exists && buyerRef && bidderId !== sellerId && price > 0 &&
          (hasValidEscrow || buyerBalance >= price) &&
          !buyerPlayers.some((player: any) => String(player?.id) === playerId)
        );

        if (validSale) {
          const sourcePlayer = isSystemSeller ? systemPlayer : sellerPlayers[sellerIndex];
          const player = { ...sourcePlayer, onTransferUntil: null, transferMarketId: null };
          if (!isSystemSeller) sellerPlayers.splice(sellerIndex, 1);
          buyerPlayers.push(player);
          const commission = isSystemSeller ? 0 : Math.floor(price * 0.05);
          const sellerIncome = price - commission;
          tx.update(buyerRef!, { ...(hasValidEscrow ? {} : { [currency]: buyerBalance - price }), [playerArrayKey]: buyerPlayers, updatedAt: FieldValue.serverTimestamp() });
          if (sellerRef) {
            tx.update(sellerRef, {
              [currency]: normalizeAuctionBalance(seller[currency]) + sellerIncome,
              [playerArrayKey]: sellerPlayers,
              updatedAt: FieldValue.serverTimestamp(),
            });
          }
          tx.set(transferRef, {
            playerId, playerName: player.name || lot.heroData?.name || 'Player',
            buyerId: bidderId, sellerId, price, currency, commission, sellerIncome,
            marketId: candidate.id, createdAt: FieldValue.serverTimestamp(), settlement: 'expired-auction',
            sellerType: isSystemSeller ? 'system' : 'manager',
          });
          tx.delete(lotRef);
          return 'SOLD';
        }

        // No valid winner: unlock a manager-owned player when present, then remove the expired listing.
        if (sellerRef && sellerSnap?.exists && sellerIndex >= 0) {
          sellerPlayers[sellerIndex] = { ...sellerPlayers[sellerIndex], onTransferUntil: null, transferMarketId: null };
          tx.update(sellerRef, { [playerArrayKey]: sellerPlayers, updatedAt: FieldValue.serverTimestamp() });
        }
        if (buyerRef && buyerSnap?.exists && hasValidEscrow) {
          tx.update(buyerRef, {
            [currency]: buyerBalance + escrowedAmount,
            updatedAt: FieldValue.serverTimestamp(),
          });
          const refundRef = db.collection('economy_transactions').doc();
          tx.set(refundRef, {
            userId: bidderId,
            amount: escrowedAmount,
            currency,
            type: 'SPECIAL_AUCTION_SETTLEMENT_REFUND',
            referenceId: candidate.id,
            description: 'Refund for an auction that could not be settled',
            timestamp: FieldValue.serverTimestamp(),
          });
        }
        tx.delete(lotRef);
        return 'EXPIRED';
      });
      if (result === 'SOLD') { settled++; sold++; }
      else if (result === 'EXPIRED') { settled++; expiredWithoutSale++; }
      else skipped++;
    } catch (error: any) {
      errors.push({ id: candidate.id, error: error?.message || 'MARKET_SETTLEMENT_FAILED' });
    }
  }

  return {
    success: errors.length === 0,
    scanned,
    due: due.length,
    settled,
    sold,
    expiredWithoutSale,
    skipped,
    errors: errors.slice(0, 50),
  };
}

/** Compatibility endpoint name; settlement is idempotent so overlapping cron
 * schedules cannot sell the same lot twice. */
export async function runPlayerAuctionSettlementSweep() {
  return runTransferMarketExpirySweep();
}
