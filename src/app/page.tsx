'use client';

import { useGameState } from './lib/store';
import { 
  Users, MessageSquare, ShoppingCart, 
  CalendarDays, Medal, ArrowRightLeft, 
  Shield, Construction, Briefcase, 
  LineChart, Heart, Newspaper, Settings, Search, Tv, User as UserIcon, UserCheck,
  Radar, LayoutList, Swords, Timer, Activity, ChevronRight
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { Badge } from '@/components/ui/badge';
import { useState, useEffect, useMemo } from 'react';
import { getMoscowTime, getGlobalSeasonInfo, isMatchLive } from './lib/time-utils';
import { collection, query, where, doc } from 'firebase/firestore';
import { getBotName, LEAGUES } from './lib/leagues-data';
import { PlaceHolderImages } from './lib/placeholder-images';

export default function Home() {
  const { user, isUserLoading } = useUser();
  const db = useFirestore();
  const { 
    language, isLoaded, isDataReady, experiencePoints, managerLevel, clubName, 
    allSeasonMatches, rank, selectedLeagueId,
    leagueLevel, groupId, clubLogo: myClubLogo, numericId
  } = useGameState();

  const [now, setNow] = useState(getMoscowTime());
  const [officialLeagueMatches, setOfficialLeagueMatches] = useState<any[] | null>(null);
  const seasonConfigRef = useMemoFirebase(() => {
    if (!db) return null;
    return doc(db, 'system_v1', 'season_config');
  }, [db]);
  const { data: seasonConfig } = useDoc(seasonConfigRef);

  const effectiveSeason = Math.max(1, Number((seasonConfig as any)?.activeSeasonNumber || 1));
  useEffect(() => {
    if (!user || !selectedLeagueId || !rank || Number(leagueLevel) < 1 || Number(leagueLevel) > 4 || Number(groupId) < 1) {
      setOfficialLeagueMatches(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const token = await user.getIdToken();
        const response = await fetch('/api/league/matches', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ leagueId: selectedLeagueId, level: Number(leagueLevel), group: Number(groupId), season: effectiveSeason }),
          cache: 'no-store',
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok || result?.success !== true) throw new Error(result?.error || 'LEAGUE_MATCHES_UNAVAILABLE');
        if (!cancelled) setOfficialLeagueMatches(Array.isArray(result.matches) ? result.matches : []);
      } catch (error) {
        if (!cancelled && !controller.signal.aborted) {
          console.error('[HOME NEXT MATCH] official fixtures unavailable', error);
          setOfficialLeagueMatches([]);
        }
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [user, selectedLeagueId, leagueLevel, groupId, rank, effectiveSeason]);


  const nameMap = useMemo(() => {
    const names: Record<number, string> = {};
    const logos: Record<number, string> = {};
    if (groupPlayers) {
      groupPlayers.forEach(p => {
        names[p.rank] = p.clubName || p.displayName;
        logos[p.rank] = p.clubLogo;
      });
    }
    return { names, logos };
  }, [groupPlayers]);

  const resolvedNextMatch = useMemo(() => {
    const sourceMatches = officialLeagueMatches ?? allSeasonMatches ?? [];
    if (!sourceMatches.length || !rank) return null;
    const myMatches = sourceMatches
      .filter(m => (Number(m.homeRank) === rank || Number(m.awayRank) === rank) && !m.isFinished)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    const nowMs = now.getTime();
    // The card is for the NEXT opponent, so prefer the next future match.
    // A currently started match is shown as LIVE only when there is no future match.
    const myNext = myMatches.find(m => new Date(m.startTime).getTime() > nowMs) || myMatches[0];
    if (!myNext) return null;
    const isHome = Number(myNext.homeRank) === rank;
    const oppRank = isHome ? Number(myNext.awayRank) : Number(myNext.homeRank);
    return {
      match: myNext,
      opponentName: (isHome ? myNext.awayName : myNext.homeName) || nameMap.names[oppRank] || getBotName(leagueLevel, groupId, oppRank),
      opponentLogo: nameMap.logos[oppRank] || null
    };
  }, [officialLeagueMatches, allSeasonMatches, rank, nameMap, leagueLevel, groupId, now]);

  const toMillis = (value: any): number => {
    if (value == null) return Number.NaN;
    if (typeof value === 'number') return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value?.toMillis === 'function') return value.toMillis();
    const seconds = value?.seconds ?? value?._seconds;
    if (typeof seconds === 'number') {
      const nanos = value?.nanoseconds ?? value?._nanoseconds ?? 0;
      return seconds * 1000 + Math.floor(nanos / 1_000_000);
    }
    if (typeof value === 'string') return new Date(value).getTime();
    return Number.NaN;
  };

  const getCountdown = (targetTimeIso: any) => {
    const targetMs = toMillis(targetTimeIso);
    if (!Number.isFinite(targetMs)) return '--:--:--';
    const diff = targetMs - now.getTime();
    if (diff > 0) {
      const hh = Math.floor(diff / 3600000);
      const mm = Math.floor((diff % 3600000) / 60000);
      const ss = Math.floor((diff % 60000) / 1000);
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    }
    return 'LIVE';
  };

  const mapCardBg = PlaceHolderImages.find(img => img.id === 'tactical-map-card')?.imageUrl;
  const systemIconUrl = PlaceHolderImages.find(img => img.id === 'ui-system-icon')?.imageUrl;

  if (isUserLoading || !isLoaded || !isDataReady) return <LoadingScreen />;

  const currentNextMatch = resolvedNextMatch?.match;
  const seasonInfo = getGlobalSeasonInfo();
  const configSeasonStartMs = toMillis((seasonConfig as any)?.seasonStart);
  const configNextSeasonStartMs = toMillis((seasonConfig as any)?.nextSeasonStart);
  const seasonStartMs = Number.isFinite(configSeasonStartMs) && configSeasonStartMs > 0
    ? configSeasonStartMs
    : seasonInfo.currentSeasonStart.getTime();
  const nextSeasonStartMs = Number.isFinite(configNextSeasonStartMs) && configNextSeasonStartMs > 0
    ? configNextSeasonStartMs
    : seasonInfo.nextSeasonStart.getTime();
  const nowMs = now.getTime();
  const isWithinCurrentSeasonWindow = nowMs >= seasonStartMs && nowMs < nextSeasonStartMs;
  const effectiveSeasonWindowIsActive = isWithinCurrentSeasonWindow || (!Number.isFinite(configSeasonStartMs) && !Number.isFinite(configNextSeasonStartMs));
  // Match the server lifecycle policy: finalization starts 2 hours before
  // the Day-15 boundary (seasonStart + 14 days), using the same UTC instant.
  const offseasonTargetMs = seasonStartMs + 14 * 24 * 60 * 60 * 1000 - 2 * 60 * 60 * 1000;
  // The 17-day S1 calendar window includes the offseason and preparation gap.
  // Do not treat that entire interval as active league play in the home card.
  const offseasonDisplayWindowActive = Number.isFinite(nextSeasonStartMs) &&
    nowMs >= offseasonTargetMs && nowMs < nextSeasonStartMs;
  const myCurrentSeasonMatches = (allSeasonMatches || []).filter((m: any) => {
    const mine = Number(m.homeRank) === Number(rank) || Number(m.awayRank) === Number(rank);
    const tour = Number(m.tour);
    return mine && Number.isFinite(tour) && tour >= 1 && tour <= 14;
  });
  const regularSeasonFinished = myCurrentSeasonMatches.length > 0 && myCurrentSeasonMatches.every((m: any) => m.isFinished === true);
  const configPhase = String((seasonConfig as any)?.phase || '').toUpperCase();
  const offseasonPhases = ['FINALIZING','GENERATING_NEXT','OFFSEASON','PREPARING_NEXT_SEASON','PREPARATION','WORLD_BUILDING'];
  const seasonTransitionPending = Boolean(seasonConfig) && (
    (seasonConfig as any).worldReady === false || offseasonPhases.includes(configPhase)
  );
  const shouldTreatAsOffseason = offseasonDisplayWindowActive || (!effectiveSeasonWindowIsActive && (
    seasonTransitionPending || seasonInfo.dayOfCycle >= 14 || seasonInfo.isOffseason ||
    (regularSeasonFinished && !currentNextMatch) ||
    (nowMs < offseasonTargetMs && offseasonPhases.includes(configPhase))
  ));
  const showOffseason = shouldTreatAsOffseason;
  const cardCountdown = showOffseason
    ? (seasonTransitionPending || nowMs >= offseasonTargetMs
        ? (language === 'ru' ? 'ПОДГОТОВКА' : 'PREPARING')
        : getCountdown(offseasonTargetMs))
    : currentNextMatch ? getCountdown(currentNextMatch.startTime) : '--:--:--';
  const cardTitle = showOffseason ? (language === 'ru' ? 'МЕЖСЕЗОНЬЕ' : 'OFFSEASON') : (language === 'ru' ? 'СЛЕДУЮЩИЙ СОПЕРНИК' : 'NEXT OPPONENT');

  const matchStartMs = currentNextMatch?.startTime ? toMillis(currentNextMatch.startTime) : Number.NaN;
  const matchDate = Number.isFinite(matchStartMs) ? new Date(matchStartMs) : null;
  const matchDateLabel = matchDate && Number.isFinite(matchDate.getTime())
    ? `${matchDate.toLocaleDateString(language === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' })} · ${matchDate.toLocaleTimeString(language === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })}`
    : (language === 'ru' ? 'Ожидается расписание' : 'Schedule pending');
  const opponentLogo = resolvedNextMatch?.opponentLogo;
  const mainOpponent = resolvedNextMatch?.opponentName || (language === 'ru' ? 'СОПЕРНИК НЕ ОПРЕДЕЛЁН' : 'OPPONENT TBD');
  const xp = Math.max(0, Number(experiencePoints || 0));
  const managerLevelValue = Math.max(1, Number(managerLevel || 1));
  const menuCards = [
    { id: 'team', title: language === 'ru' ? 'КОМАНДА' : 'TEAM', subtitle: language === 'ru' ? 'Управляй своим клубом' : 'Manage your club', href: '/roster', image: PlaceHolderImages.find(img => img.id === 'hero-tank')?.imageUrl, icon: Users, tone: 'text-primary' },
    { id: 'matches', title: language === 'ru' ? 'МАТЧИ' : 'MATCHES', subtitle: language === 'ru' ? 'Просмотр и участие в играх' : 'View and play matches', href: '/matches', image: PlaceHolderImages.find(img => img.id === 'arena-starter')?.imageUrl, icon: CalendarDays, tone: 'text-primary' },
    { id: 'transfers', title: language === 'ru' ? 'ТРАНСФЕРЫ' : 'TRANSFERS', subtitle: language === 'ru' ? 'Покупай и продавай игроков' : 'Buy and sell players', href: '/transfers', image: PlaceHolderImages.find(img => img.id === 'hero-mage')?.imageUrl, icon: ArrowRightLeft, tone: 'text-sky-300' },
    { id: 'cups', title: language === 'ru' ? 'ТУРНИРЫ' : 'TOURNAMENTS', subtitle: language === 'ru' ? 'Соревнуйся за награды' : 'Compete for rewards', href: '/tournaments', image: PlaceHolderImages.find(img => img.id === 'hq-starter')?.imageUrl, icon: Medal, tone: 'text-amber-300' },
  ];
  const navItems = [
    { label: language === 'ru' ? 'Главная' : 'Home', href: '/', icon: Activity },
    { label: language === 'ru' ? 'Команда' : 'Team', href: '/roster', icon: Users },
    { label: language === 'ru' ? 'Игроки' : 'Players', href: '/roster/squad', icon: UserIcon },
    { label: language === 'ru' ? 'Турниры' : 'Cups', href: '/tournaments', icon: Medal },
    { label: language === 'ru' ? 'Магазин' : 'Shop', href: '/shop', icon: ShoppingCart },
  ];

  return (
    <div className="relative min-h-[calc(100dvh-4rem-3.5rem)] overflow-y-auto overflow-x-hidden bg-[#050a12] pb-24 text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[560px] opacity-35" style={{ backgroundImage: `linear-gradient(180deg,rgba(3,8,16,.12),#050a12 95%),url('${mapCardBg || ''}')`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
      <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 pb-6 pt-4 sm:px-5">
        <section className="relative min-h-[330px] overflow-hidden rounded-[26px] border border-cyan-300/25 bg-[#071421] shadow-[0_18px_60px_rgba(0,0,0,.55)]">
          {PlaceHolderImages.find(img => img.id === 'hero-carry')?.imageUrl && <img src={PlaceHolderImages.find(img => img.id === 'hero-carry')?.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover object-[center_25%] opacity-75" />}
          <div className="absolute inset-0 bg-gradient-to-r from-[#03101b]/95 via-[#03101b]/70 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#04101a] via-transparent to-transparent" />
          <div className="relative flex min-h-[330px] flex-col justify-end p-4 sm:p-6">
            <div className="mb-auto flex items-center gap-2 pt-1 text-[11px] font-black uppercase tracking-[.18em] text-cyan-200">
              <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-300 shadow-[0_0_12px_#22d3ee]" />
              {language === 'ru' ? 'СЛЕДУЮЩИЙ МАТЧ' : 'NEXT MATCH'}
            </div>
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-200">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/35 px-3 py-1.5"><Timer className="h-4 w-4 text-cyan-300" />{matchDateLabel}</span>
              <span className="rounded-full border border-white/15 bg-black/30 px-3 py-1.5">{language === 'ru' ? 'ЛИГА СЕЗОНА' : 'SEASON LEAGUE'}</span>
              {currentNextMatch?.startTime && <span className={`rounded-full border px-3 py-1.5 font-black tabular-nums ${getCountdown(currentNextMatch.startTime) === 'LIVE' ? 'border-rose-400/40 bg-rose-500/15 text-rose-200' : 'border-cyan-300/25 bg-cyan-300/10 text-cyan-100'}`}>{getCountdown(currentNextMatch.startTime) === 'LIVE' ? (language === 'ru' ? 'МАТЧ ИДЁТ' : 'LIVE NOW') : (language === 'ru' ? 'ДО НАЧАЛА ' : 'STARTS IN ') + getCountdown(currentNextMatch.startTime)}</span>}
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:max-w-lg">
              <div className="flex min-w-0 flex-col items-center gap-2">
                <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-cyan-300/20 bg-black/35 p-2 sm:h-24 sm:w-24">
                  {myClubLogo ? <img src={myClubLogo} alt="" className="h-full w-full object-contain" /> : <Shield className="h-12 w-12 text-cyan-300" />}
                </div>
                <span className="max-w-full truncate text-center text-sm font-black uppercase sm:text-base">{clubName || (language === 'ru' ? 'МОЯ КОМАНДА' : 'MY TEAM')}</span>
              </div>
              <span className="text-2xl font-black italic text-white drop-shadow-[0_0_14px_rgba(34,211,238,.7)]">VS</span>
              <div className="flex min-w-0 flex-col items-center gap-2">
                <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-amber-300/20 bg-black/35 p-2 sm:h-24 sm:w-24">
                  {opponentLogo ? <img src={opponentLogo} alt="" className="h-full w-full object-contain" /> : <Swords className="h-12 w-12 text-amber-300" />}
                </div>
                <span className="max-w-full truncate text-center text-sm font-black uppercase sm:text-base">{mainOpponent}</span>
              </div>
            </div>
            <a href="/matches" className="mt-5 flex h-14 items-center justify-center gap-3 rounded-xl bg-gradient-to-r from-cyan-300 to-teal-400 text-base font-black uppercase tracking-wider text-[#031018] shadow-[0_8px_28px_rgba(20,220,200,.25)] transition hover:brightness-110 active:scale-[.99]">
              <span className="text-xl">▶</span>{language === 'ru' ? 'ПЕРЕЙТИ К МАТЧАМ' : 'GO TO MATCHES'}
            </a>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3">
          {menuCards.map(item => (
            <a key={item.id} href={item.href} className="group relative min-h-[150px] overflow-hidden rounded-2xl border border-slate-500/40 bg-[#0b1725] shadow-lg transition hover:-translate-y-0.5 hover:border-cyan-300/60">
              {item.image && <img src={item.image} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40 transition duration-500 group-hover:scale-105 group-hover:opacity-55" />}
              <div className="absolute inset-0 bg-gradient-to-r from-[#07111e] via-[#07111e]/80 to-transparent" />
              <div className="relative flex min-h-[150px] flex-col justify-between p-3 sm:p-4">
                <item.icon className={`h-8 w-8 ${item.tone}`} />
                <div className="pr-5">
                  <h2 className="text-sm font-black tracking-wide sm:text-base">{item.title}</h2>
                  <p className="mt-1 text-[11px] leading-snug text-slate-300 sm:text-xs">{item.subtitle}</p>
                </div>
                <ChevronRight className="absolute bottom-4 right-3 h-5 w-5 text-slate-300 transition group-hover:translate-x-1 group-hover:text-cyan-200" />
              </div>
            </a>
          ))}
        </section>

        <a href="/profile" className="group relative flex min-h-[132px] items-center justify-between overflow-hidden rounded-2xl border border-violet-400/35 bg-gradient-to-r from-[#21134d] via-[#24105a] to-[#0d1634] p-4 shadow-[0_12px_38px_rgba(56,30,140,.25)]">
          <div className="absolute -right-4 -top-12 h-48 w-48 rounded-full bg-violet-500/20 blur-3xl" />
          <div className="relative flex items-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-400/15 text-violet-200"><Medal className="h-10 w-10" /></div>
            <div>
              <p className="text-base font-black uppercase">{language === 'ru' ? 'ПРОФИЛЬ МЕНЕДЖЕРА' : 'MANAGER PROFILE'}</p>
              <p className="mt-1 text-xs text-violet-100/80">{language === 'ru' ? `Уровень ${managerLevelValue} · ${xp.toLocaleString()} XP` : `Level ${managerLevelValue} · ${xp.toLocaleString()} XP`}</p>
              
            </div>
          </div>
          <ChevronRight className="relative h-6 w-6 text-violet-100" />
        </a>

        <a href="/news" className="flex items-center gap-3 rounded-xl border border-slate-500/40 bg-[#0b1420]/90 px-4 py-3 text-sm text-slate-200 transition hover:border-cyan-300/50">
          <span className="h-2 w-2 shrink-0 rounded-full bg-cyan-300 shadow-[0_0_10px_#22d3ee]" />
          <Newspaper className="h-5 w-5 shrink-0 text-cyan-200" />
          <span className="min-w-0 flex-1 truncate">{language === 'ru' ? 'Открой новости и события Forge-Rivals' : 'Read Forge-Rivals news and events'}</span>
          <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
        </a>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[#050a12]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
        <div className="mx-auto grid h-[68px] max-w-3xl grid-cols-5">
          {navItems.map(item => {
            const active = item.href === '/';
            return <a key={item.href} href={item.href} className={`relative flex flex-col items-center justify-center gap-1 text-[10px] font-bold transition ${active ? 'text-cyan-300' : 'text-slate-400 hover:text-white'}`}>
              {active && <span className="absolute top-0 h-[2px] w-10 rounded-full bg-cyan-300 shadow-[0_0_12px_#22d3ee]" />}
              <item.icon className="h-5 w-5" />
              <span>{item.label}</span>
            </a>;
          })}
        </div>
      </nav>
    </div>
  );
}
