'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFirebase } from '@/firebase';

type Diagnostics = Record<string, any>;

export default function MatchSettlementDiagnosticsPage() {
  const { user, isUserLoading, areServicesAvailable } = useFirebase();
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Diagnostics | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!user) {
      setAdmin(false);
      setData(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const tokenResult = await user.getIdTokenResult(true);
      const isAdmin = tokenResult.claims.admin === true;
      setAdmin(isAdmin);
      if (!isAdmin) {
        setData(null);
        setError('Для диагностики требуется admin-доступ Beta.');
        return;
      }
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/match-settlement-diagnostics', {
        method: 'GET',
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      const result = await response.json() as Diagnostics;
      setData(result);
      if (!response.ok || result.success !== true) {
        setError(String(result.error || `Диагностика недоступна (HTTP ${response.status}).`));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось получить диагностику.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!isUserLoading && user) void refresh();
  }, [isUserLoading, user, refresh]);

  const season = data?.season;
  const league = data?.league;
  const cup = data?.pyramidCup;
  const lock = data?.rolloverLock;

  const Stat = ({ label, value }: { label: string; value: unknown }) => (
    <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{value == null ? '—' : String(value)}</dd>
    </div>
  );

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-5 py-10 text-slate-100">
      <header className="mb-7">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Forge-Rivals · Beta Preview · Read only</p>
        <h1 className="mt-2 text-3xl font-bold">Диагностика матчей</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
          Проверка незавершённых матчей лиги и Кубка Пирамиды, сроков, зависших обработок и блокировки перехода сезона.
          Страница ничего не исправляет и не изменяет в Firestore.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Доступ и окружение</h2>
            <p className="mt-1 text-sm text-slate-400">
              {isUserLoading ? 'Проверяю сессию…' : !user ? 'Войдите в Beta под администраторским аккаунтом.' : admin === true ? 'Admin-доступ подтверждён.' : admin === false ? 'Нет admin-доступа.' : 'Проверка прав…'}
            </p>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={!user || loading || !areServicesAvailable}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-50">
            {loading ? 'Проверяю…' : 'Обновить диагностику'}
          </button>
        </div>
        {data && (
          <p className="mt-3 text-xs text-slate-400">
            Проект: {String(data.project || '—')} · Снимок: {String(data.timestamp || '—')} · Записи: {String(data.writesStarted === false ? 'не выполнялись' : 'не подтверждено')}
          </p>
        )}
        {!areServicesAvailable && <p className="mt-3 text-sm text-amber-200">Firebase Client SDK недоступен.</p>}
      </section>

      {error && <p role="alert" className="mt-5 rounded-xl border border-amber-800 bg-amber-950/40 p-4 text-sm text-amber-100">{error}</p>}

      {data && season && (
        <>
          <section className="mt-5 rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
            <h2 className="font-semibold">Сезон</h2>
            <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Номер" value={season.activeSeasonNumber} />
              <Stat label="Фаза" value={season.phase} />
              <Stat label="Мир готов" value={season.worldReady ? 'Да' : 'Нет'} />
              <Stat label="Лига приостановлена" value={season.lifecycle?.leagueMatchesPaused ? 'Да' : 'Нет'} />
            </dl>
            <div className="mt-4 space-y-1 text-xs text-slate-400">
              <p>Начало сезона: {String(season.seasonStart || '—')}</p>
              <p>Следующая граница: {String(season.nextSeasonStart || '—')}</p>
              <p>Начало межсезонья: {String(season.lifecycle?.offseasonStartAt || '—')}</p>
              {season.lifecycleError && <p className="text-amber-300">Ошибка календаря: {String(season.lifecycleError)}</p>}
            </div>
          </section>

          <section className="mt-5 rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
            <h2 className="font-semibold">Лига</h2>
            <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
              <Stat label="Всего матчей" value={league?.total} />
              <Stat label="Завершено" value={league?.finished} />
              <Stat label="Не завершено" value={league?.unfinished} />
              <Stat label="Просрочено" value={league?.overdue} />
              <Stat label="В обработке" value={league?.processing} />
              <Stat label="Зависшие обработки" value={league?.staleProcessing} />
            </dl>
            {Array.isArray(league?.recentErrorCodes) && league.recentErrorCodes.length > 0 && (
              <div className="mt-4"><h3 className="text-sm font-medium">Последние коды ошибок</h3>
                <ul className="mt-2 space-y-1 text-sm text-amber-200">
                  {league.recentErrorCodes.map((item: any, index: number) => <li key={index}>{String(item.code)} · {String(item.count)}</li>)}
                </ul>
              </div>
            )}
          </section>

          <section className="mt-5 rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
            <h2 className="font-semibold">Кубок Пирамиды</h2>
            <p className="mt-1 text-sm text-slate-400">Статус: {String(cup?.status || (cup?.exists ? '—' : 'Кубок не найден'))} · Раунд: {String(cup?.currentRound || '—')}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
              <Stat label="Пар в сетке раунда" value={cup?.roundFixturesInBracket} />
              <Stat label="Документов матчей" value={cup?.roundFixturesWithMatchDocuments} />
              <Stat label="Завершено" value={cup?.finished} />
              <Stat label="Не завершено" value={cup?.unfinished} />
              <Stat label="Просрочено" value={cup?.overdue} />
              <Stat label="Зависшие обработки" value={cup?.staleProcessing} />
            </dl>
          </section>

          <section className="mt-5 rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
            <h2 className="font-semibold">Блокировка перехода сезона</h2>
            <p className="mt-2 text-sm text-slate-300">Существует: {lock?.exists ? 'Да' : 'Нет'} · Активна: {lock?.active ? 'Да' : 'Нет'}</p>
            {lock?.expiresAt && <p className="mt-1 text-xs text-slate-400">Истекает: {String(lock.expiresAt)}</p>}
          </section>

          <details className="mt-5 rounded-xl border border-slate-700 bg-slate-950/60 p-4">
            <summary className="cursor-pointer text-sm font-medium">Полный технический ответ</summary>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-slate-300">{JSON.stringify(data, null, 2)}</pre>
          </details>
        </>
      )}
    </main>
  );
}
