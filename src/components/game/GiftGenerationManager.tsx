'use client';

import { useEffect, useRef } from 'react';
import { useGameState, Gift } from '@/app/lib/store';
import { getMoscowDateString } from '@/app/lib/time-utils';

const GIFT_POOL = [
  { type: 'architect', value: 2, labelRu: 'Архитектор Метавселенной 2', labelEn: 'Metaverse Architect 2' },
  { type: 'architect', value: 6, labelRu: 'Архитектор Метавселенной 6', labelEn: 'Metaverse Architect 6' },
  { type: 'architect', value: 12, labelRu: 'Архитектор Метавселенной 12', labelEn: 'Metaverse Architect 12' },
  { type: 'teambuilding', value: 1, labelRu: 'Тимбилдинг на Мальдивах 1', labelEn: 'Team Building Maldives 1' },
  { type: 'teambuilding', value: 3, labelRu: 'Тимбилдинг на Мальдивах 3', labelEn: 'Team Building Maldives 3' },
  { type: 'teambuilding', value: 6, labelRu: 'Тимбилдинг на Мальдивах 6', labelEn: 'Team Building Maldives 6' },
  { type: 'secret', value: 0, labelRu: 'Секретный Сундук', labelEn: 'Secret Chest' },
  { type: 'grant', value: 1000000, labelRu: 'Венчурный Грант 1', labelEn: 'Venture Grant 1' },
  { type: 'grant', value: 3000000, labelRu: 'Венчурный Грант 3', labelEn: 'Venture Grant 3' },
  { type: 'grant', value: 5000000, labelRu: 'Венчурный Грант 5', labelEn: 'Venture Grant 5' },
  { type: 'shard', value: 50, labelRu: 'Осколок Еремеевита 50', labelEn: 'Jeremejevite Shard 50' },
  { type: 'shard', value: 100, labelRu: 'Осколок Еремеевита 100', labelEn: 'Jeremejevite Shard 100' },
  { type: 'shard', value: 250, labelRu: 'Осколок Еремеевита 250', labelEn: 'Jeremejevite Shard 250' },
  { type: 'curse', value: 1, labelRu: 'Проклятие Гения 1', labelEn: 'Genius Curse 1' },
  { type: 'curse', value: 3, labelRu: 'Проклятие Гения 3', labelEn: 'Genius Curse 3' },
  { type: 'curse', value: 6, labelRu: 'Проклятие Гения 6', labelEn: 'Genius Curse 6' },
];

export function GiftGenerationManager() {
  const { isLoaded, activeLicenseTier, lastGiftGenDate, generateDailyGifts, language, availableGiftsToSend = [] } = useGameState();
  const lastProcessedDateRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded || activeLicenseTier !== 1) return;

    const today = getMoscowDateString();
    
    // Проверка необходимости обновления
    const needsRefresh = lastGiftGenDate !== today && lastProcessedDateRef.current !== today;
    // Проверка наличия излишков (более 1 подарка)
    const hasExcess = (availableGiftsToSend?.length || 0) > 1;

    if (needsRefresh) {
      lastProcessedDateRef.current = today;
      const random = GIFT_POOL[Math.floor(Math.random() * GIFT_POOL.length)];
      const generated: Gift = {
        id: `g_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        type: random.type as any,
        value: random.value,
        label: language === 'ru' ? random.labelRu : random.labelEn,
        createdAt: new Date().toISOString(),
        claimed: false
      };
      // Устанавливаем ровно ОДИН подарок
      generateDailyGifts([generated]);
    } 
    else if (hasExcess) {
      // Если есть излишки от старой версии, оставляем только первый
      generateDailyGifts([availableGiftsToSend[0]]);
    }
  }, [isLoaded, activeLicenseTier, lastGiftGenDate, generateDailyGifts, language, availableGiftsToSend]);

  return null;
}
