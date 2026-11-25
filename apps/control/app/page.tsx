'use client';

import { FormEvent, useCallback, useEffect, useState, type CSSProperties } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from 'firebase/auth';
import { getControlAuth } from '../lib/firebase-client';

type CupControl = { success?: boolean; exists?: boolean; error?: string; season?: number; cupId?: string; name?: string; status?: string; currentRound?: number; totalRounds?: number; participants?: number; totalMatches?: number; actualPairings?: number; finishedMatches?: number; scheduledMatches?: number; fixtureDocuments?: number; dedicatedFixtureDocuments?: number; legacyFixtureDocuments?: number; winner?: { id: string; name: string } | null; healthy?: boolean; issues?: string[]; rounds?: Array<{ round: number; expectedMatches: number; pairingCount: number; finished: number; scheduled: number; missingFixtures: number; resultMismatches: number; matches: Array<{ id: string; index: number; matchId: string | null; status: string; home: { id: string; name: string } | null; away: { id: string; name: string } | null; scoreA: number | null; scoreB: number | null; winnerId: string | null; technicalDecision: boolean; fixtureStatus: string; startAt: string | null; storage: string | null; reportStatus: string | null }> }> };\n\ntype Overview = {
  success?: boolean; network?: string; error?: string; playersTotal?: number; registeredHumans?: number; playersOnline?: number;
  season?: { number: number; phase: string; worldReady: boolean };
  pyramidCup?: { exists: boolean; status: string; currentRound: number; totalMatches: number };
  updatedAt?: string;
};

const panel: CSSProperties = { background: '#111827', border: '1px solid #263449', borderRadius: 16, padding: 20 };
const muted: React.CSSProperties = { color: '#93a4bb', fontSize: 13 };

export default function ControlHome() {
  const [auth, setAuth] = useState<ReturnType<typeof getControlAuth> | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [setupSecret, setSetupSecret] = useState('');
  const [bootstrapEnabled, setBootstrapEnabled] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);\n  const [cup, setCup] = useState<CupControl | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    try {
      const instance = getControlAuth();
      setAuth(instance);
      return onAuthStateChanged(instance, setUser);
    } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/bootstrap-admin', { cache: 'no-store' })
      .then(r => r.json()).then(data => { if (active) setBootstrapEnabled(data.enabled === true); })
      .catch(() => { if (active) setBootstrapEnabled(false); });
    return () => { active = false; };
  }, []);

  const refresh = useCallback(async (current: User) => {
    setBusy(true); setError('');
    try {
      const token = await current.getIdToken(true);
      const res = await fetch('/api/overview', { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'CONTROL_OVERVIEW_UNAVAILABLE');
      setOverview(data);
    } catch (e) { setError((e as Error).message); setOverview(null); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { if (user) void refresh(user); else setOverview(null); }, [user, refresh]);

  async function login(event: FormEvent) {
    event.preventDefault(); if (!auth) return;
    setBusy(true); setError(''); setNotice('');
    try { await signInWithEmailAndPassword(auth, email.trim(), password); setPassword(''); }
    catch { setError('Не удалось войти. Проверьте email и пароль.'); }
    finally { setBusy(false); }
  }

  async function bootstrap(event: FormEvent) {
    event.preventDefault(); if (!auth) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/bootstrap-admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, setupSecret }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'ADMIN_BOOTSTRAP_FAILED');
      setBootstrapEnabled(false);
      setSetupSecret('');
      setNotice('Администратор создан. Выполняем вход…');
      await signInWithEmailAndPassword(auth, email.trim(), password);
      setPassword('');
    } catch (e) {
      setError((e as Error).message === 'ADMIN_BOOTSTRAP_FAILED' ? 'Не удалось создать администратора.' : (e as Error).message);
    } finally { setBusy(false); }
  }

  return <main style={{ maxWidth: 1080, margin: '0 auto', padding: '44px 22px' }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 32 }}>
      <div><div style={{ color: '#60a5fa', fontSize: 12, letterSpacing: 3, fontWeight: 700 }}>PRIVATE OPERATIONS</div><h1 style={{ margin: '8px 0', fontSize: 30 }}>Forge-Rivals Control</h1><div style={muted}>Изолированная панель управления · Beta</div></div>
      {user && <button onClick={() => auth && void signOut(auth)} style={buttonStyle}>Выйти</button>}
    </header>
    {!user ? <div style={{ display: 'grid', gap: 16, maxWidth: 440 }}>
      <form onSubmit={login} style={{ ...panel, display: 'grid', gap: 14 }}>
        <h2 style={{ margin: 0 }}>Вход администратора</h2>
        <input aria-label="Email" type="email" autoComplete="username" required placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle}/>
        <input aria-label="Пароль" type="password" autoComplete="current-password" required placeholder="Пароль" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle}/>
        <button disabled={busy || !auth} style={primaryStyle}>{busy ? 'Проверка…' : 'Войти'}</button>
      </form>
      {bootstrapEnabled && <form onSubmit={bootstrap} style={{ ...panel, display: 'grid', gap: 14, borderColor: '#36547c' }}>
        <h2 style={{ margin: 0 }}>Первичная настройка администратора</h2>
        <p style={muted}>Одноразовая регистрация. После успешного создания повторная регистрация будет заблокирована.</p>
        <input aria-label="Email администратора" type="email" autoComplete="email" required placeholder="Email администратора" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle}/>
        <input aria-label="Надёжный пароль" type="password" autoComplete="new-password" minLength={12} maxLength={128} required placeholder="Пароль (не менее 12 символов)" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle}/>
        <input aria-label="Одноразовый код настройки" type="password" autoComplete="off" minLength={32} required placeholder="Одноразовый код настройки" value={setupSecret} onChange={e => setSetupSecret(e.target.value)} style={inputStyle}/>
        <button disabled={busy || !auth} style={primaryStyle}>{busy ? 'Создание…' : 'Создать администратора'}</button>
      </form>}
    </div> : <section>
      <div style={{ ...panel, marginBottom: 18, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div><div style={muted}>Аккаунт</div><strong>{user.email || user.uid}</strong></div>
        <div><div style={muted}>Firebase project</div><strong>forge-rivals-beta</strong></div>
        <button onClick={() => void refresh(user)} disabled={busy} style={buttonStyle}>{busy ? 'Обновление…' : 'Обновить данные'}</button>
      </div>
      {overview && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 14 }}>
        <article style={panel}><div style={muted}>Сеть / API</div><h2 style={{ color: '#34d399' }}>Подключена</h2><div style={muted}>Beta Firestore доступен</div></article>
        <article style={panel}><div style={muted}>Зарегистрировано людей</div><h2>{overview.registeredHumans ?? '—'}</h2><div style={muted}>Активные аккаунты Firebase Auth, без ботов</div></article>
        <article style={panel}><div style={muted}>Игровые записи</div><h2>{overview.playersTotal ?? '—'}</h2><div style={muted}>Все документы игроков, включая ботов</div></article>
        <article style={panel}><div style={muted}>Сейчас в сети</div><h2>{overview.playersOnline ?? '—'}</h2><div style={muted}>Heartbeat за 2 минуты</div></article>
        <article style={panel}><div style={muted}>Сезон</div><h2>№ {overview.season?.number ?? '—'}</h2><div style={muted}>{overview.season?.phase || '—'} · {overview.season?.worldReady ? 'Мир готов' : 'Мир не готов'}</div></article>
        <article style={panel}><div style={muted}>Кубок Пирамиды</div><h2>{overview.pyramidCup?.exists ? overview.pyramidCup.status : 'Не создан'}</h2><div style={muted}>Раунд {overview.pyramidCup?.currentRound ?? 0} · матчей {overview.pyramidCup?.totalMatches ?? 0}</div></article>
      </div>}
      {cup && <section style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div><h2 style={{ margin: 0 }}>Кубок Пирамиды · контроль матчей</h2><p style={muted}>Сезон {cup.season ?? '—'} · {cup.cupId || 'Кубок не создан'}</p></div>
          <strong style={{ color: cup.healthy ? '#34d399' : '#fca5a5' }}>{cup.exists ? (cup.healthy ? 'Проверка пройдена' : 'Обнаружены проблемы') : 'Не создан'}</strong>
        </div>
        {cup.exists ? <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 16 }}>
            <article style={panel}><div style={muted}>Участники</div><h2>{cup.participants ?? '—'}</h2></article>
            <article style={panel}><div style={muted}>Матчи по сетке</div><h2>{cup.actualPairings ?? '—'} / {cup.totalMatches ?? '—'}</h2></article>
            <article style={panel}><div style={muted}>Завершены</div><h2>{cup.finishedMatches ?? '—'}</h2></article>
            <article style={panel}><div style={muted}>Ожидают</div><h2>{cup.scheduledMatches ?? '—'}</h2></article>
            <article style={panel}><div style={muted}>Документы матчей</div><h2>{cup.fixtureDocuments ?? '—'}</h2></article>
            <article style={panel}><div style={muted}>Текущий раунд</div><h2>{cup.currentRound ?? '—'} / {cup.totalRounds ?? 7}</h2></article>
          </div>
          {cup.winner && <p style={panel}>Победитель: <strong>{cup.winner.name}</strong></p>}
          {(cup.issues || []).length > 0 && <div style={{ ...panel, borderColor: '#7f1d1d', marginBottom: 16 }}><strong style={{ color: '#fca5a5' }}>Проблемы целостности</strong><ul>{cup.issues?.slice(0, 30).map((issue, index) => <li key={index}>{issue}</li>)}</ul></div>}
          <div style={{ display: 'grid', gap: 12 }}>
            {(cup.rounds || []).map(round => <details key={round.round} style={panel} open={round.round === cup.currentRound}>
              <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Раунд {round.round}: {round.finished} завершено / {round.expectedMatches} · {round.scheduled} ожидают · {round.missingFixtures} без документа</summary>
              <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                {round.matches.map(match => <div key={match.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', gap: 8, alignItems: 'center', padding: 9, borderTop: '1px solid #263449' }}>
                  <div><strong>{match.home?.name || '—'}</strong><div style={muted}>{match.home?.id || ''}</div></div>
                  <div style={{ textAlign: 'center', minWidth: 76 }}><strong>{match.scoreA ?? '—'} : {match.scoreB ?? '—'}</strong><div style={muted}>{match.status === 'finished' ? 'Завершён' : 'Ожидает'}</div></div>
                  <div style={{ textAlign: 'right' }}><strong>{match.away?.name || '—'}</strong><div style={muted}>{match.away?.id || ''}</div></div>
                  <div style={{ gridColumn: '1 / -1', ...muted }}>ID: {match.matchId || 'нет'} · {match.fixtureStatus} · {match.storage || 'документ отсутствует'} · отчёт: {match.reportStatus || '—'}{match.technicalDecision ? ' · техническое решение' : ''}</div>
                </div>)}
              </div>
            </details>)}
          </div>
        </> : <div style={panel}>Для активного сезона Кубок Пирамиды пока не найден. Данные не изменялись.</div>}
      </section>}
      {overview?.updatedAt && <p style={muted}>Обновлено: {new Date(overview.updatedAt).toLocaleString()}</p>}
    </section>}
    {notice && <p role="status" style={{ ...panel, borderColor: '#166534', color: '#86efac', marginTop: 18 }}>{notice}</p>}
    {error && <p role="alert" style={{ ...panel, borderColor: '#7f1d1d', color: '#fca5a5', marginTop: 18 }}>{error}</p>}
    <footer style={{ ...muted, marginTop: 40 }}>Отдельная панель Beta. Создание администратора доступно только один раз по секрету настройки.</footer>
  </main>;
}

const inputStyle: React.CSSProperties = { background: '#0b1220', color: '#e8edf7', border: '1px solid #334155', borderRadius: 9, padding: 12 };
const buttonStyle: React.CSSProperties = { background: '#1e293b', color: '#e8edf7', border: '1px solid #475569', borderRadius: 9, padding: '10px 14px', cursor: 'pointer' };
const primaryStyle: React.CSSProperties = { ...buttonStyle, background: '#1d4ed8', borderColor: '#2563eb', fontWeight: 700 };
