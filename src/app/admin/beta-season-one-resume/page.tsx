'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFirebase } from '@/firebase';

type WorldStatus = {
  status?: string;
  activeSeason?: number;
  phase?: string;
  worldStatus?: {
    ready?: boolean;
    groupsReady?: number;
    totalGroups?: number;
    tables?: number;
    matches?: number;
    expectedMatches?: number;
  };
  error?: string;
};

type BootstrapResult = Record<string, unknown> & {
  success?: boolean;
  error?: string;
  action?: string;
  writesStarted?: boolean;
};

export default function BetaSeasonOneResumePage() {
  const { user, isUserLoading, areServicesAvailable } = useFirebase();
  const [world, setWorld] = useState<WorldStatus | null>(null);
  const [worldLoading, setWorldLoading] = useState(true);
  const [adminClaim, setAdminClaim] = useState<boolean | null>(null);
  const [claimLoading, setClaimLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<BootstrapResult | null>(null);

  const refreshWorld = useCallback(async () => {
    setWorldLoading(true);
    try {
      const response = await fetch('/api/health/game-world', {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      const data = (await response.json()) as WorldStatus;
      setWorld(data);
    } catch (cause) {
      setWorld({ error: cause instanceof Error ? cause.message : 'Не удалось прочитать состояние мира' });
    } finally {
      setWorldLoading(false);
    }
  }, []);

  const refreshAdminClaim = useCallback(async () => {
    if (!user) {
      setAdminClaim(false);
      return;
    }
    setClaimLoading(true);
    try {
      const token = await user.getIdTokenResult(true);
      setAdminClaim(token.claims.admin === true);
    } catch {
      setAdminClaim(null);
    } finally {
      setClaimLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refreshWorld();
  }, [refreshWorld]);

  useEffect(() => {
    void refreshAdminClaim();
  }, [refreshAdminClaim]);

  const startBootstrap = async () => {
    if (!user || running || adminClaim !== true) return;
    setRunning(true);
    setError('');
    setResult(null);
    try {
      const idToken = await user.getIdToken(true);
      const response = await fetch('/api/admin/beta-season-one-bootstrap', {
        method: 'POST',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ confirmation: 'CREATE_BETA_SEASON_ONE' }),
      });
      const data = (await response.json()) as BootstrapResult;
      setResult(data);
      if (!response.ok || data.success !== true) {
        setError(String(data.error || `Запуск остановлен (HTTP ${response.status})`));
      }
      await refreshWorld();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось выполнить защищённый запуск');
    } finally {
      setRunning(false);
    }
  };

  const counts = world?.worldStatus;
  const ready = counts?.ready === true;

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-5 py-10 text-slate-100">
      <header className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-300">Forge-Rivals · Beta Preview</p>
        <h1 className="mt-3 text-3xl font-bold">Создание нового Season 1</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
          Защищённый запуск создаёт новый мир только в Firebase-проекте Beta. Старые аккаунты и клубы не переносятся.
          Никакие операции со старой базой или Production эта страница не выполняет.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Текущее состояние мира</h2>
          <button type="button" onClick={() => void refreshWorld()} disabled={worldLoading || running}
            className="rounded-lg border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-50">
            Обновить
          </button>
        </div>
        {worldLoading ? <p className="mt-5 text-sm text-slate-300">Проверяю Beta Firestore…</p> : (
          <dl className="mt-5 grid grid-cols-2 gap-4">
            <div><dt className="text-xs text-slate-400">Состояние</dt><dd className="mt-1 font-medium">{ready ? 'Мир готов' : 'Мир ещё не создан'}</dd></div>
            <div><dt className="text-xs text-slate-400">Сезон / фаза</dt><dd className="mt-1 font-medium">{world?.activeSeason ?? '—'} / {world?.phase || '—'}</dd></div>
            <div><dt className="text-xs text-slate-400">Таблицы</dt><dd className="mt-1 font-medium">{counts?.tables ?? 0} / 15</dd></div>
            <div><dt className="text-xs text-slate-400">Группы</dt><dd className="mt-1 font-medium">{counts?.groupsReady ?? 0} / 15</dd></div>
            <div><dt className="text-xs text-slate-400">Матчи лиги</dt><dd className="mt-1 font-medium">{counts?.matches ?? 0} / 840</dd></div>
          </dl>
        )}
        <p className="mt-4 text-xs text-slate-400">
          Диагностика мира — только чтение. Фактическая готовность подтверждается серверной postflight-проверкой после запуска.
        </p>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
        <h2 className="text-lg font-semibold">Проверка доступа</h2>
        {isUserLoading || claimLoading ? <p className="mt-3 text-sm text-slate-300">Проверяю Firebase-сессию и права…</p> : (
          <div className="mt-3 space-y-2 text-sm">
            <p>Аккаунт: <span className="font-medium">{user ? 'Firebase авторизован' : 'Не авторизован'}</span></p>
            {user && <p className="break-all">Firebase UID: <code className="select-all text-cyan-200">{user.uid}</code></p>}
            <p>Администратор Beta: <span className="font-medium">{adminClaim === true ? 'Подтверждён' : adminClaim === false ? 'Нет admin-права' : 'Не удалось проверить'}</span></p>
          </div>
        )}
        {!areServicesAvailable && <p className="mt-3 text-sm text-amber-200">Firebase Client SDK недоступен.</p>}
        {adminClaim === false && user && (
          <p className="mt-3 rounded-lg bg-amber-950/50 p-3 text-sm text-amber-200">
            У текущего аккаунта пока нет custom claim admin=true. Для безопасного назначения права нужен UID именно этого аккаунта; он показан выше. Серверная проверка останется включённой.
          </p>
        )}
        {!user && !isUserLoading && (
          <p className="mt-3 text-sm text-amber-200">Войди в Beta под администраторским аккаунтом, затем обнови страницу.</p>
        )}
      </section>

      <section className="mt-6 rounded-2xl border border-cyan-900 bg-slate-900/70 p-5">
        <h2 className="text-lg font-semibold">Запустить создание Season 1</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Сервер повторно проверит Firebase ID token, admin claim, Preview-окружение, точную Git-ветку,
          Firebase project ID и отсутствие уже созданных игровых данных. При существующих данных запуск будет остановлен.
        </p>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-300">
          <li>15 групп и 120 клубных мест</li>
          <li>840 матчей лиги</li>
          <li>Кубок Пирамиды: 120 участников, 119 матчей, без BYE; D1 пропускает первый раунд</li>
          <li>Финал Кубка — BO3, остальные раунды — BO1</li>
        </ul>
        <p className="mt-5 rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300">
          Нажатие кнопки ниже является подтверждением создания нового мира Season 1 в Beta Firestore.
        </p>
        <button type="button" onClick={() => void startBootstrap()}
          disabled={!user || adminClaim !== true || running || worldLoading || ready}
          className="mt-5 w-full rounded-xl bg-cyan-500 px-4 py-3 font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">
          {running ? 'Создаю Season 1 и Кубок…' : ready ? 'Мир уже создан — повторный запуск заблокирован' : 'Создать Season 1 в Beta'}
        </button>
        <p className="mt-3 text-xs text-slate-400">Нажатие кнопки отправляет защищённый запрос. Серверные проверки прав и проекта остаются обязательными. Секреты CRON и service account остаются на сервере.</p>
      </section>

      {error && <p role="alert" className="mt-5 rounded-lg border border-red-800 bg-red-950/50 p-3 text-sm text-red-200">{error}</p>}
      {result && <pre className="mt-5 overflow-x-auto rounded-xl border border-slate-700 bg-slate-950 p-4 text-xs text-slate-200">{JSON.stringify(result, null, 2)}</pre>}
    </main>
  );
}
