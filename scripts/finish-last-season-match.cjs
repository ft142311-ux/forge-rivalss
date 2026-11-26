#!/usr/bin/env node
'use strict';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = 'studio-2788872209-f7092';

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
}

const db = admin.firestore();
const MATCH_ID = 'match_v140_S1_LALPHA_V3_G1_T14_R2_vs_R1';

async function main() {
  const ref = db.collection('matches_v2').doc(MATCH_ID);
  const snap = await ref.get();

  if (!snap.exists) {
    throw new Error(`Матч не найден: ${MATCH_ID}`);
  }

  const m = snap.data();

  console.log('Эмулятор: 127.0.0.1:8080');
  console.log('Матч:', snap.id);
  console.log('Сезон:', m.season, 'Версия:', m.version);
  console.log('Тип:', m.type, 'Группа:', m.groupId);
  console.log('Команды:', m.homeId, 'vs', m.awayId);
  console.log('Счёт сейчас:', m.scoreA, ':', m.scoreB);
  console.log('Завершён:', m.isFinished);
  console.log('Обрабатывается:', m.isProcessing);

  if (Number(m.season) !== 1 || Number(m.version) !== 140) {
    throw new Error('Отказ: сезон или версия не совпадают с ожидаемыми.');
  }
  if (String(m.type || 'league').toLowerCase() !== 'league') {
    throw new Error('Отказ: это не матч лиги.');
  }
  if (m.isFinished === true) {
    throw new Error('Матч уже завершён. Изменений нет.');
  }
  if (!m.homeId || !m.awayId || m.homeId === m.awayId) {
    throw new Error('Некорректные команды. Изменений нет.');
  }

  console.log('\nБудет установлен технический результат 1:0.');
  console.log('Запись будет изменена только после подтверждения в консоли.');

  if (process.argv.includes('--apply') !== true) {
    console.log('\nПроверка завершена. Данные НЕ изменены.');
    console.log('Если данные верны, повтори запуск с аргументом --apply.');
    return;
  }

  await db.runTransaction(async tx => {
    const fresh = await tx.get(ref);
    if (!fresh.exists) throw new Error('Матч исчез до записи.');

    const current = fresh.data();
    if (
      Number(current.season) !== 1 ||
      Number(current.version) !== 140 ||
      current.isFinished === true ||
      !current.homeId ||
      !current.awayId
    ) {
      throw new Error('Запись изменилась; безопасная запись отменена.');
    }

    tx.update(ref, {
      scoreA: 1,
      scoreB: 0,
      seriesScore: { home: 1, away: 0 },
      winnerId: current.homeId,
      bestOf: 2,
      matchFormat: 'BO2',
      status: 'finished',
      isFinished: true,
      isProcessing: false,
      processingStartedAt: admin.firestore.FieldValue.delete(),
      resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
      technicalResult: true,
      technicalResultReason: 'Season 1 completion recovery',
    });
  });

  const verify = await ref.get();
  const result = verify.data();
  console.log('\nРезультат записан.');
  console.log('Матч:', verify.id);
  console.log('Счёт:', result.scoreA, ':', result.scoreB);
  console.log('Завершён:', result.isFinished);
  console.log('Остальные матчи не изменялись этим скриптом.');
}

main()
  .catch(error => {
    console.error('ОШИБКА:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.terminate();
  });