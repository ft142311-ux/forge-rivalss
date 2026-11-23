'use client';

import { useCallback, useEffect, useState } from 'react';

type ResetStatus = {
  success?: boolean;
  readOnly?: boolean;
  project?: string;
  error?: string;
  plan?: {
    ready?: boolean;
    reasons?: string[];
    expected?: Record<string, number>;
    target?: { season?: number; seasonStart?: string; nextSeasonStart?: string };
  };
  diagnostics?: {
    config?: {
      worldReady?: boolean;
      stagingSeasonOneResetInProgress?: boolean;
      worldGeneration?: string;
      pyramidCupReady?: boolean;
    };
    journal?: {
      exists?: boolean;
      status?: string;
      stepIndex?: number;
      leaseActive?: boolean;
      leaseExpiresAtMs?: number;
      hasSourceConfig?: boolean;
      counts?: Record<string, number>;
      target?: { seasonStart?: string; nextSeasonStart?: string };
    };
    workerLocks?: {
      seasonRollover?: { active?: boolean };
      seasonCalendarBuild?: { active?: boolean };
    };
  };
};

function formatDate(value?: string | number) {
  if (!value) return '—';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export default function BetaSeasonOneResumePage() {
  const [status, setStatus] = useState<ResetStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/staging-season-one-preflight', {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      const data = (await response.json()) as ResetStatus;
      setStatus(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось получить состояние Beta Preview');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const journal = status?.diagnostics?.journal;
  const locks = status?.diagnostics?.workerLocks;
  const canResume =
    status?.project === 'forge-rivalstest' &&
    journal?.exists === true &&
    journal.status === 'RUNNING' &&
    journal.leaseActive === false &&
    journal.hasSourceConfig === true &&
    locks?.seasonRollover?.active !== true &&
    locks?.seasonCalendarBuild?.active !== true &&
    status?.diagnostics?.config?.stagingSeasonOneResetInProgress === true;

  const resume = async () => {
    if (!canResume || !confirmed || running) return;
    setRunning(true);
    setError('');
    setResult(null);
    try {
      const response = await fetch('/api/admin/staging-season-one-preflight', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ confirmation: 'RESET_BETA_SEASON_ONE' }),
      });
      const data = await response.json();
      setResult(data);
      if (!response.ok || data?.success !== true) {
        setError(String(data?.error || data?.message || `Операция остановлена (HTTP ${response.status})`));
      }
      setConfirmed(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось продолжить восстановление');
    } finally {
      setRunning(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-5 py-10 text-slate-100">
      <div className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-300">Forge-Rivals · Beta</p>
        <h1 className="mt-3 text-3xl font-bold">Восстановление нового сезона 1</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
          Страница продолжает только уже начатую операцию по журналу. Она не создаёт новый сброс,
          не меняет Firebase Auth и не отключает защиту Preview.
        </p>
      </div>

      <section className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Состояние операции</h2>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading || running}
            className="rounded-lg border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
          >
            Обновить
          </button>
        </div>

        {loading ? (
          <p className="mt-5 text-sm text-slate-300">Читаю состояние Firestore…</p>
        ) : (
          <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><dt className="text-xs text-slate-400">Проект</dt><dd className="mt-1 font-medium">{status?.project || status?.error || 'Недоступен'}</dd></div>
            <div><dt className="text-xs text-slate-400">Журнал</dt><dd className="mt-1 font-medium">{journal?.status || 'Не найден'}</dd></div>
            <div><dt className="text-xs text-slate-400">Шаг</dt><dd className="mt-1 font-medium">{journal?.stepIndex ?? '—'} / 4</dd></div>
            <div><dt className="text-xs text-slate-400">Аренда операции</dt><dd className="mt-1 font-medium">{journal?.leaseActive ? 'Ещё действует' : journal?.exists ? 'Истекла' : '—'}</dd></div>
            <div><dt className="text-xs text-slate-400">Архив исходных данных</dt><dd className="mt-1 font-medium">{journal?.hasSourceConfig ? `${journal.counts?.archiveDocuments ?? 'Проверка завершена'} документов` : 'Не подтверждён'}</dd></div>
            <div><dt className="text-xs text-slate-400">Блокировки календаря / перехода</dt><dd className="mt-1 font-medium">{locks?.seasonCalendarBuild?.active || locks?.seasonRollover?.active ? 'Есть активная блокировка' : 'Нет активных блокировок'}</dd></div>
            <div><dt className="text-xs text-slate-400">Плановая дата начала</dt><dd className="mt-1 font-medium">{formatDate(journal?.target?.seasonStart)}</dd></div>
            <div><dt className="text-xs text-slate-400">Следующий сезон</dt><dd className="mt-1 font-medium">{formatDate(journal?.target?.nextSeasonStart)}</dd></div>
          </dl>
        )}

        {status?.plan?.reasons?.length ? (
          <p className="mt-5 rounded-lg bg-amber-950/50 p-3 text-sm text-amber-200">
            Общий preflight пока не считает мир готовым: {status.plan.reasons.join(', ')}. Для восстановления используется сохранённый журнал, а не новый сброс.
          </p>
        ) : null}
      </section>

      <section className="mt-6 rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
        <h2 className="text-lg font-semibold">Продолжить с сохранённого шага</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          После подтверждения система продолжит с шага 2: построит 840 матчей лиги и Кубок пирамиды,
          затем проверит 15 таблиц, 120 слотов, 120 участников Кубка и завершит журнал.
        </p>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-300">
          <li>25 Firebase Auth аккаунтов и их UID сохраняются</li>
          <li>Существующий архив из 2 021 документа не пересоздаётся</li>
          <li>При ошибке операция останется в журнале для безопасного восстановления</li>
        </ul>

        <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            disabled={!canResume || running}
            className="mt-1 h-4 w-4 accent-cyan-400"
          />
          <span>Подтверждаю продолжение уже начатого сброса Beta Season 1 с сохранённого шага. Это изменит данные мира Beta.</span>
        </label>

        <button
          type="button"
          onClick={() => void resume()}
          disabled={!canResume || !confirmed || running || loading}
          className="mt-5 w-full rounded-xl bg-cyan-500 px-4 py-3 font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          {running ? 'Восстанавливаю сезон…' : 'Продолжить восстановление'}
        </button>

        {!loading && !canResume ? (
          <p className="mt-3 text-sm text-slate-400">
            Продолжение пока недоступно: требуется существующий журнал RUNNING, истёкшая аренда и отсутствие активных блокировок.
          </p>
        ) : null}
      </section>

      {error ? <p role="alert" className="mt-5 rounded-lg border border-red-800 bg-red-950/50 p-3 text-sm text-red-200">{error}</p> : null}
      {result ? (
        <pre className="mt-5 overflow-x-auto rounded-xl border border-slate-700 bg-slate-950 p-4 text-xs text-slate-200">{JSON.stringify(result, null, 2)}</pre>
      ) : null}
    </main>
  );
}
