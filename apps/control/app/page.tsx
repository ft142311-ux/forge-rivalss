'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from 'firebase/auth';
import { getControlAuth } from '../lib/firebase-client';

type Overview = {
  success?: boolean; network?: string; error?: string; playersTotal?: number;
  season?: { number: number; phase: string; worldReady: boolean };
  pyramidCup?: { exists: boolean; status: string; currentRound: number; totalMatches: number };
  updatedAt?: string;
};

const panel: React.CSSProperties = { background: '#111827', border: '1px solid #263449', borderRadius: 16, padding: 20 };
const muted: React.CSSProperties = { color: '#93a4bb', fontSize: 13 };

export default function ControlHome() {
  const [auth, setAuth] = useState<ReturnType<typeof getControlAuth> | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      const instance = getControlAuth();
      setAuth(instance);
      return onAuthStateChanged(instance, setUser);
    } catch (e) { setError((e as Error).message); }
  }, []);

  const refresh = useCallback(async (current: User) => {
    setBusy(true); setError('');
    try {
      const token = await current.getIdToken();
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
    setBusy(true); setError('');
    try { await signInWithEmailAndPassword(auth, email.trim(), password); setPassword(''); }
    catch { setError('Не удалось войти. Проверьте данные учётной записи.'); }
    finally { setBusy(false); }
  }

  return <main style={{ maxWidth: 1080, margin: '0 auto', padding: '44px 22px' }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 32 }}>
      <div><div style={{ color: '#60a5fa', fontSize: 12, letterSpacing: 3, fontWeight: 700 }}>PRIVATE OPERATIONS</div><h1 style={{ margin: '8px 0', fontSize: 30 }}>Forge-Rivals Control</h1><div style={muted}>Изолированная панель управления · Beta</div></div>
      {user && <button onClick={() => auth && void signOut(auth)} style={buttonStyle}>Выйти</button>}
    </header>
    {!user ? <form onSubmit={login} style={{ ...panel, maxWidth: 420, display: 'grid', gap: 14 }}>
      <h2 style={{ margin: 0 }}>Вход администратора</h2><p style={muted}>Доступ проверяется сервером по административному claim и списку разрешённых UID.</p>
      <input aria-label="Email" type="email" autoComplete="username" required placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle}/>
      <input aria-label="Пароль" type="password" autoComplete="current-password" required placeholder="Пароль" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle}/>
      <button disabled={busy || !auth} style={primaryStyle}>{busy ? 'Проверка…' : 'Войти'}</button>
    </form> : <section>
      <div style={{ ...panel, marginBottom: 18, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div><div style={muted}>Аккаунт</div><strong>{user.email || user.uid}</strong></div>
        <div><div style={muted}>Firebase project</div><strong>forge-rivals-beta</strong></div>
        <button onClick={() => void refresh(user)} disabled={busy} style={buttonStyle}>{busy ? 'Обновление…' : 'Обновить данные'}</button>
      </div>
      {overview && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 14 }}>
        <article style={panel}><div style={muted}>Сеть / API</div><h2 style={{ color: '#34d399' }}>Подключена</h2><div style={muted}>Beta Firestore доступен</div></article>
        <article style={panel}><div style={muted}>Всего игроков</div><h2>{overview.playersTotal ?? '—'}</h2><div style={muted}>Агрегированный счётчик</div></article>
        <article style={panel}><div style={muted}>Сезон</div><h2>№ {overview.season?.number ?? '—'}</h2><div style={muted}>{overview.season?.phase || '—'} · {overview.season?.worldReady ? 'Мир готов' : 'Мир не готов'}</div></article>
        <article style={panel}><div style={muted}>Кубок Пирамиды</div><h2>{overview.pyramidCup?.exists ? overview.pyramidCup.status : 'Не создан'}</h2><div style={muted}>Раунд {overview.pyramidCup?.currentRound ?? 0} · матчей {overview.pyramidCup?.totalMatches ?? 0}</div></article>
      </div>}
      {overview?.updatedAt && <p style={muted}>Обновлено: {new Date(overview.updatedAt).toLocaleString()}</p>}
    </section>}
    {error && <p role="alert" style={{ ...panel, borderColor: '#7f1d1d', color: '#fca5a5', marginTop: 18 }}>{error}</p>}
    <footer style={{ ...muted, marginTop: 40 }}>Панель не подключает игровые компоненты и не содержит операций изменения игрового мира.</footer>
  </main>;
}

const inputStyle: React.CSSProperties = { background: '#0b1220', color: '#e8edf7', border: '1px solid #334155', borderRadius: 9, padding: 12 };
const buttonStyle: React.CSSProperties = { background: '#1e293b', color: '#e8edf7', border: '1px solid #475569', borderRadius: 9, padding: '10px 14px', cursor: 'pointer' };
const primaryStyle: React.CSSProperties = { ...buttonStyle, background: '#1d4ed8', borderColor: '#2563eb', fontWeight: 700 };
