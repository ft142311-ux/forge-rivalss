'use client';

/**
 * ЦЕНТР НЕПРОСМОТРЕННЫХ ОТЧЕТОВ.
 * История всех завершенных матчей находится в «Матч-центр → Мои результаты».
 */

import { useGameState } from '@/app/lib/store';
import { useUser, useFirestore, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, Tv, ChevronRight, FileText, Shield } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { collection, query, where, doc } from 'firebase/firestore';

export default function ReportsPage() {
  const { user, isUserLoading } = useUser();
  const db = useFirestore();
  const router = useRouter();
  const {
    language, isLoaded, isDataReady, matchHistory, allSeasonMatches,
    clubLogo: myClubLogo, rank, selectedLeagueId, leagueLevel, groupId
  } = useGameState();

  useEffect(() => {
    if (!isUserLoading && !user) router.push('/auth/login');
  }, [user, isUserLoading, router]);

  const groupPlayersQuery = useMemoFirebase(() => {
    if (!db || !selectedLeagueId) return null;
    return query(collection(db, 'players_v14'), where('selectedLeagueId', '==', selectedLeagueId), where('leagueLevel', '==', leagueLevel), where('groupId', '==', groupId));
  }, [db, selectedLeagueId, leagueLevel, groupId]);
  const { data: groupPlayers } = useCollection(groupPlayersQuery);

  const userProfileRef = useMemoFirebase(() => user?.uid && db ? doc(db, 'players_v14', user.uid) : null, [db, user?.uid]);
  const { data: profile } = useDoc(userProfileRef);

  // Очередь обзора агрегирует отдельные коллекции игровых режимов.
  // Каждый режим остаётся в собственном хранилище, без копирования в matches_v2.
  const personalHomeQuery = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return query(collection(db, 'matches_v2'), where('homeId', '==', user.uid), where('isFinished', '==', true));
  }, [db, user?.uid]);
  const personalAwayQuery = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return query(collection(db, 'matches_v2'), where('awayId', '==', user.uid), where('isFinished', '==', true));
  }, [db, user?.uid]);
  const { data: personalHomeMatches } = useCollection(personalHomeQuery);
  const { data: personalAwayMatches } = useCollection(personalAwayQuery);

  const friendlyHostQuery = useMemoFirebase(() => user?.uid && db ? query(collection(db, 'friendly_matches_v1'), where('hostId', '==', user.uid)) : null, [db, user?.uid]);
  const friendlyAwayQuery = useMemoFirebase(() => user?.uid && db ? query(collection(db, 'friendly_matches_v1'), where('challengerId', '==', user.uid)) : null, [db, user?.uid]);
  const { data: friendlyHostReports } = useCollection(friendlyHostQuery);
  const { data: friendlyAwayReports } = useCollection(friendlyAwayQuery);

  const cupHomeQuery = useMemoFirebase(() => user?.uid && db ? query(collection(db, 'cup_matches'), where('homeId', '==', user.uid)) : null, [db, user?.uid]);
  const cupAwayQuery = useMemoFirebase(() => user?.uid && db ? query(collection(db, 'cup_matches'), where('awayId', '==', user.uid)) : null, [db, user?.uid]);
  const tournamentHomeQuery = useMemoFirebase(() => user?.uid && db ? query(collection(db, 'tournament_matches_v1'), where('homeId', '==', user.uid)) : null, [db, user?.uid]);
  const tournamentAwayQuery = useMemoFirebase(() => user?.uid && db ? query(collection(db, 'tournament_matches_v1'), where('awayId', '==', user.uid)) : null, [db, user?.uid]);
  const trainingHomeQuery = useMemoFirebase(() => user?.uid && db ? query(collection(db, 'training_matches_v1'), where('homeId', '==', user.uid)) : null, [db, user?.uid]);
  const trainingAwayQuery = useMemoFirebase(() => user?.uid && db ? query(collection(db, 'training_matches_v1'), where('awayId', '==', user.uid)) : null, [db, user?.uid]);
  const associationHostQuery = useMemoFirebase(() => user?.uid && db ? query(collection(db, 'association_matches_v1'), where('hostId', '==', user.uid)) : null, [db, user?.uid]);
  const associationChallengerQuery = useMemoFirebase(() => user?.uid && db ? query(collection(db, 'association_matches_v1'), where('challengerId', '==', user.uid)) : null, [db, user?.uid]);
  const { data: cupHomeMatches } = useCollection(cupHomeQuery);
  const { data: cupAwayMatches } = useCollection(cupAwayQuery);
  const { data: tournamentHomeMatches } = useCollection(tournamentHomeQuery);
  const { data: tournamentAwayMatches } = useCollection(tournamentAwayQuery);
  const { data: trainingHomeMatches } = useCollection(trainingHomeQuery);
  const { data: trainingAwayMatches } = useCollection(trainingAwayQuery);
  const { data: associationHostMatches } = useCollection(associationHostQuery);
  const { data: associationChallengerMatches } = useCollection(associationChallengerQuery);

  const nameMap = useMemo(() => {
    const names: Record<number, string> = {};
    const logos: Record<number, string> = {};
    (groupPlayers || []).forEach(p => {
      names[p.rank] = p.clubName || p.displayName;
      logos[p.rank] = p.clubLogo;
    });
    return { names, logos };
  }, [groupPlayers]);

  const unreadReports = useMemo(() => {
    if (!user || !rank) return [];
    const regTime = profile?.createdAt?.toMillis ? profile.createdAt.toMillis() : (profile?.createdAt ? new Date(profile.createdAt).getTime() : 0);
    let locallyViewed = new Set<string>();
    if (typeof window !== 'undefined') {
      try {
        const raw = JSON.parse(localStorage.getItem('lote_game_state_v245:viewed-match-ids') || '[]');
        if (Array.isArray(raw)) locallyViewed = new Set(raw.map(String));
      } catch {}
    }
    const isLocallyViewed = (m: any) => m?.id ? locallyViewed.has(String(m.id)) : false;

    const history = (matchHistory || [])
      .filter((m: any) => m?.isFinished !== false && m?.seen !== true && m?.reportStatus !== 'viewed' && !isLocallyViewed(m))
      .map((m: any) => ({ ...m, source: 'history', isUnread: true }));

    const personal = [...(personalHomeMatches || []), ...(personalAwayMatches || []), ...(cupHomeMatches || []), ...(cupAwayMatches || []), ...(tournamentHomeMatches || []), ...(tournamentAwayMatches || []), ...(trainingHomeMatches || []), ...(trainingAwayMatches || [])];

    const league = personal
      .filter((m: any) => m?.type === 'league' && m?.isFinished === true)
      .filter((m: any) => {
        const resolved = m.resolvedAt?.toMillis ? m.resolvedAt.toMillis() : (m.resolvedAt ? new Date(m.resolvedAt).getTime() : 0);
        return m.seen !== true && m.reportStatus !== 'viewed' && !isLocallyViewed(m) && (!regTime || resolved > regTime);
      })
      .map((m: any) => ({ ...m, source: 'league', isUnread: true }));

    const cup = personal
      .filter((m: any) => m?.type === 'cup' && m?.source === 'pyramid-cup' && m?.isFinished === true)
      .filter((m: any) => m.seen !== true && m.reportStatus !== 'viewed' && !isLocallyViewed(m))
      .map((m: any) => ({ ...m, source: 'cup', isUnread: true }));

    const friendly = [...personal.filter((m: any) => m?.type === 'friendly' || m?.matchType === 'friendly'), ...(friendlyHostReports || []), ...(friendlyAwayReports || [])]
      .filter((m: any) => (m?.type === 'friendly' || m?.matchType === 'friendly') && m?.isFinished === true && m?.seen !== true && m?.reportStatus !== 'viewed' && !isLocallyViewed(m))
      .map((m: any) => ({ ...m, source: 'friendly', isUnread: true }));

    const association = [...(associationHostMatches || []), ...(associationChallengerMatches || [])]
      .filter((m: any) => (m?.type === 'basket' || m?.matchType === 'basket' || m?.matchType === 'cw-basket') && m?.isFinished === true && m?.seen !== true && m?.reportStatus !== 'viewed' && !isLocallyViewed(m))
      .map((m: any) => ({ ...m, source: 'basket', isUnread: true }));

    const tournament = personal
      .filter((m: any) => (m?.type === 'tournament' || m?.matchType === 'tournament') && m?.isFinished === true && m?.seen !== true && m?.reportStatus !== 'viewed' && !isLocallyViewed(m))
      .map((m: any) => ({ ...m, source: 'tournament', isUnread: true }));

    const trial = personal
      .filter((m: any) => (m?.type === 'trial' || m?.matchType === 'trial' || m?.isTrial === true) && m?.isFinished === true && m?.seen !== true && m?.reportStatus !== 'viewed' && !isLocallyViewed(m))
      .map((m: any) => ({ ...m, source: 'trial', isUnread: true }));

    const unique = new Map<string, any>();
    [...history, ...league, ...cup, ...friendly, ...association, ...tournament, ...trial].forEach(m => { if (m?.id && !unique.has(m.id)) unique.set(m.id, m); });
    return [...unique.values()].sort((a, b) => {
      const ta = new Date(a.playedAt || a.resolvedAt || a.startTime || 0).getTime();
      const tb = new Date(b.playedAt || b.resolvedAt || b.startTime || 0).getTime();
      return tb - ta;
    });
  }, [user, rank, profile, matchHistory, allSeasonMatches, nameMap, leagueLevel, groupId, personalHomeMatches, personalAwayMatches, cupHomeMatches, cupAwayMatches, tournamentHomeMatches, tournamentAwayMatches, trainingHomeMatches, trainingAwayMatches, associationHostMatches, associationChallengerMatches, friendlyHostReports, friendlyAwayReports]);

  // «Обзор матча» — это вход непосредственно в просмотр.
  // Промежуточная карточка со сведениями о матче больше не показывается.
  // Всегда открываем самый новый непросмотренный матч; сама страница /match
  // начинает с шага preview.
  useEffect(() => {
    if (isUserLoading || !isLoaded || !isDataReady || !user) return;
    if (unreadReports.length > 0) {
      const nextId = String(unreadReports[0].id);
      router.replace(`/match?id=${encodeURIComponent(nextId)}`);
    }
  }, [isUserLoading, isLoaded, isDataReady, user, unreadReports, router]);

  if (isUserLoading || !isLoaded || !isDataReady) return <LoadingScreen />;
  if (unreadReports.length > 0) return <LoadingScreen />;

  const t = language === 'ru' ? {
    title: 'ОБЗОР МАТЧА', subtitle: 'Последовательный просмотр новых матчей', unread: 'НОВЫЙ', view: 'НАЧАТЬ ПРОСМОТР',
    noUnread: 'ВСЕ ОТЧЕТЫ ПРОСМОТРЕНЫ', noUnreadDesc: 'Новых завершенных матчей нет. Старые результаты доступны в «Матч-центр → Мои результаты».',
    league: 'Лига', tournament: 'Турнир', friendly: 'Товарищеский', trial: 'Пробный матч', cup: 'Кубок', basket: 'КВ', scrim: 'Скрим'
  } : {
    title: 'MATCH OVERVIEW', subtitle: 'Sequential review of new matches', unread: 'NEW', view: 'START REVIEW',
    noUnread: 'ALL REPORTS REVIEWED', noUnreadDesc: 'There are no new completed matches. Old results remain in Match Center → My Results.',
    league: 'League', tournament: 'Tournament', friendly: 'Friendly', trial: 'Trial Match', cup: 'Cup', basket: 'CW', scrim: 'Scrim'
  };

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-32">
      <header className="mb-8 flex items-center gap-4">
        <Link href="/"><Button variant="ghost" size="icon" className="rounded-full bg-secondary/50 border border-white/5"><ChevronLeft className="w-6 h-6" /></Button></Link>
        <div>
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter text-white flex items-center gap-2"><Tv className="w-6 h-6 text-primary" />{t.title}</h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-black opacity-50">{t.subtitle}</p>
        </div>
        {unreadReports.length > 0 && <Badge className="ml-auto bg-primary text-primary-foreground">{t.unread}</Badge>}
      </header>

      <div className="space-y-3">
        {unreadReports.length ? (() => {
          const report: any = unreadReports[0];
          const isMeHome = Number(report.homeRank) === Number(rank) || report.homeId === user?.uid;
          const isMeAway = Number(report.awayRank) === Number(rank) || report.awayId === user?.uid;
          const typeLabel = (t as any)[report.type] || report.type || t.league;
          const score = report.seriesScore?.home !== undefined
            ? `${report.seriesScore.home}:${report.seriesScore.away}`
            : (report.seriesScore || `${report.scoreA ?? report.homeScore ?? 0}:${report.scoreB ?? report.awayScore ?? 0}`);
          const homeLogo = isMeHome ? myClubLogo : report.homeLogo;
          const awayLogo = isMeAway ? myClubLogo : report.awayLogo;
          const position = 1;
          return (
            <Card key={report.id} className="glass-card border-primary/40 bg-primary/5 ring-1 ring-primary/10 shadow-[0_0_15px_rgba(var(--primary),0.1)] overflow-hidden">
              <CardContent className="p-4">
                <div className="flex justify-between items-center mb-3">
                  <div className="flex items-center gap-2"><Badge variant="outline" className="text-[7px] font-black h-4 px-2 border-white/10 uppercase">{typeLabel}</Badge><Badge className="bg-primary text-primary-foreground text-[7px] font-black h-4 px-2">{t.unread}</Badge></div>
                  <span className="text-[8px] font-mono font-bold text-muted-foreground">{new Date(report.playedAt || report.resolvedAt || report.startTime).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="mb-3 text-center text-[8px] font-black uppercase tracking-widest text-muted-foreground">МАТЧ {position} • НОВЕЙШИЙ НЕПРОСМОТРЕННЫЙ</div>
                <div className="grid grid-cols-[1fr_50px_1fr] items-center gap-3 mb-4">
                  <div className="flex flex-col items-center gap-2 text-center min-w-0"><div className="w-10 h-10 rounded-xl bg-secondary/50 border border-white/5 flex items-center justify-center overflow-hidden p-1.5">{homeLogo ? <img src={homeLogo} alt="" className="w-full h-full object-contain" /> : <Shield className="w-5 h-5 text-muted-foreground/40" />}</div><p className={cn('text-[10px] font-bold uppercase truncate w-full px-1', isMeHome ? 'text-primary font-black' : 'text-white')}>{report.homeName}</p></div>
                  <div className="text-center text-xl font-headline font-black italic">{score}</div>
                  <div className="flex flex-col items-center gap-2 text-center min-w-0"><div className="w-10 h-10 rounded-xl bg-secondary/50 border border-white/5 flex items-center justify-center overflow-hidden p-1.5">{awayLogo ? <img src={awayLogo} alt="" className="w-full h-full object-contain" /> : <Shield className="w-5 h-5 text-muted-foreground/40" />}</div><p className={cn('text-[10px] font-bold uppercase truncate w-full px-1', isMeAway ? 'text-primary font-black' : 'text-white')}>{report.awayName}</p></div>
                </div>
                <Link href={`/match?id=${encodeURIComponent(report.id)}`}><Button className="w-full h-10 text-[9px] font-black uppercase tracking-[0.2em] hero-gradient shadow-lg">{t.view} <ChevronRight className="w-3.5 h-3.5 ml-2" /></Button></Link>
                <p className="text-center text-[8px] uppercase tracking-widest text-muted-foreground/60 mt-3">После завершения просмотра этот матч исчезнет из очереди, а следующим откроется следующий по дате.</p>
              </CardContent>
            </Card>
          );
        })() : (
          <div className="py-20 text-center opacity-30 border border-dashed border-white/5 rounded-3xl p-10 flex flex-col items-center gap-4"><FileText className="w-12 h-12" /><div className="space-y-1"><p className="text-sm font-bold uppercase text-white">{t.noUnread}</p><p className="text-[9px] uppercase font-black tracking-widest max-w-[260px] leading-relaxed">{t.noUnreadDesc}</p></div></div>
        )}
      </div>
    </div>
  );
}
