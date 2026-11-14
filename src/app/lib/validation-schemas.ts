import { z } from 'zod';
import { TEAMS_PER_GROUP, MAX_LEVELS } from './leagues-data';

/**
 * @fileOverview Схемы валидации для Server Actions.
 * Добавлены лимиты сумм для защиты от переполнения.
 */

export const EmailInputSchema = z.object({
  email: z.string().email(),
});

export const VerifyCodeSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6).regex(/^\d+$/),
});

export const InitializeClubSchema = z.object({
  clubName: z.string().min(3).max(20),
  tier: z.number().int().min(1).max(MAX_LEVELS),
  group: z.number().int().positive(),
  rank: z.number().int().min(1).max(TEAMS_PER_GROUP),
  selectedLeagueId: z.string(),
  clubLogo: z.string().url().optional().nullable(),
  country: z.string().optional().nullable(),
  email: z.string().email().nullable(),
});

export const FinancialOpSchema = z.object({
  idempotencyKey: z.string().min(10).max(128).regex(/^[A-Za-z0-9_-]+$/),
  amount: z.number().int().min(-1000000).max(1000000), // Защита от аномалий
  type: z.enum(['credits', 'crystals']),
  description: z.string().max(240).optional(),
});