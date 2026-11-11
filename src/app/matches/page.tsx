
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useGameState } from '../lib/store';
import { 
  ChevronLeft, CalendarClock, History, Swords, 
  ChevronRight, Clock, Target, LayoutList, ListChecks,
  Shield, Timer, RefreshCw
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where, orderBy } from 'firebase/firestore';
import { getMoscowTime, isMatchLive } from '../lib/time-utils';
import { LoadingScreen } from '@/components/game/LoadingScreen';

type MatchView = 'menu' | 'next' | 'my_future' | 'my_history' | 'league_future' | 'league_history';

export default function MatchesPage() {
  const { user, isUserLoading } = useUser();
  const db = useFirestore();
  const router = useRouter();
  const { 
    isLoaded, language,
    selectedLeagueId, leagueLevel, groupId,
    clubLogo: myClubLogo, seasonNumber, matchHistory, rank
  } = useGameState();
  
  const [view, setView] = useState<MatchView>('menu');
  const [now, setNow] = useState(getMoscowTime());

  useEffect(() => {
    const timer = setInterval(() => setNow(getMoscowTime()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ИСПОЛЬЗУЕМ ТОЛЬКО v14
  const groupPlayersQuery = useMemoFirebase(() => {
    if (!db || !selectedLeagueId) return null;
    return query(collection(db, 'players_v14'), 
      where('selectedLeagueId', '==', selectedLeagueId),
      where('leagueLevel', '==', leagueLevel),
      where('groupId', '==', groupId)
    );
  }, [db, selectedLeagueId, leagueLevel, groupId]);

  const { data: players } = useCollection(groupPlayersQuery);

  // ФИЛЬТРАЦИЯ ПО ВЕРСИИ 140
  const groupMatchesQuery = useMemoFirebase(() => {
    if (!db || !selectedLeagueId) return null;
    return query(collection(db, 'matches_v2'), 
      where('leagueId', '==', selectedLeagueId),
      where('level', '==', leagueLevel),
      where('groupId', '==', groupId),
      where('season', '==', seasonNumber)
    );
  }, [db, selectedLeagueId, leagueLevel, groupId, seasonNumber]);

  const { data: fixedMatches, isLoading: isMatchesLoading } = useCollection(groupMatchesQuery);

  // Все завершённые матчи конкретного менеджера, включая товарищеские.
  // Friendly-отчёты не имеют leagueId/level/groupId, поэтому они не попадают
  // в официальный groupMatchesQuery и должны загружаться отдельно.
  const myHomeMatchesQuery = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return query(collection(db, 'matches_v2'), where('homeId', '==', user.uid), where('isFinished', '==', true));
  }, [db, user?.uid]);
  const myAwayMatchesQuery = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return query(collection(db, 'matches_v2'), where('awayId', '==', user.uid), where('isFinished', '==', true));
  }, [db, user?.uid]);
  const { data: myHomeMatches, isLoading: isHomeHistoryLoading } = useCollection(myHomeMatchesQuery);
  const { data: myAwayMatches, isLoading: isAwayHistoryLoading } = useCollection(myAwayMatchesQuery);

  const friendlyHostQuery = useMemoFirebase(() => user?.uid && db ? query(collection(db, 'friendly_matches_v1'), where('hostId', '==', user.uid)) : null, [db, user?.uid]);
  const friendlyAwayQuery = useMemoFirebase(() => user?.uid && db ? query(collection(db, 'friendly_matches_v1'), where('challengerId', '==', user.uid)) : null, [db, user?.uid]);
  const cupHomeQuery = useMemoFirebase(() => user?.uid && db ? query(collection(db, 'cup_matches'), where('homeId', '==', user.uid)) : null, [db, user?.uid]);
  const cupAwayQuery = useMemoFirebase(() => user?.uid && db ? query(collection(db, 'cup_matches'), where('awayId', '==', user.uid)) : null, [db, user?.uid]);
  const tournamentHomeQuery = useMemoFirebase(() => user?.uid && db ? query(collection(db, 'tournament_matches_v1'), where('homeId', '==', user.uid)) : null, [db, user?.uid]);
  const tournamentAwayQuery = useMemoFirebase(() => user?.uid && db ? query(collection(db, 'tournament_matches_v1'), where('awayId', '==', user.uid)) : null, [db, user?.uid]);
  const trainingHomeQuery = useMemoFirebase(() => user?.uid && db ? query(collection(db, 'training_matches_v1'), where('homeId', '==', user.uid)) : null, [db, user?.uid]);
  const trainingAwayQuery = useMemoFirebase(() => user?.uid && db ? query(collection(db, 'training_matches_v1'), where('awayId', '==', user.uid)) : null, [db, user?.uid]);
  const associationHostQuery = useMemoFirebase(() => user?.uid && db ? query(collection(db, 'association_matches_v1'), where('hostId', '==', user.uid)) : null, [db, user?.uid]);
  const associationChallengerQuery = useMemoFirebase(() => user?.uid && db ? query(collection(db, 'association_matches_v1'), where('challengerId', '==', user.uid)) : null, [db, user?.uid]);
  const { data: friendlyHostMatches } = useCollection(friendlyHostQuery);
  const { data: friendlyAwayMatches } = useCollection(friendlyAwayQuery);
  const { data: cupHomeMatches } = useCollection(cupHomeQuery);
  const { data: cupAwayMatches } = useCollection(cupAwayQuery);
  const { data: tournamentHomeMatches } = useCollection(tournamentHomeQuery);
  const { data: tournamentAwayMatches } = useCollection(tournamentAwayQuery);
  const { data: trainingHomeMatches } = useCollection(trainingHomeQuery);
  const { data: trainingAwayMatches } = useCollection(trainingAwayQuery);
  const { data: associationHostMatches } = useCollection(associationHostQuery);
  const { data: associationChallengerMatches } = useCollection(associationChallengerQuery);

  const t = {
    ru: {
      title: "МАТЧ-ЦЕНТР", subtitle: "Оперативные сводки и расписания",
      backToMenu: "В меню матчей", empty: "ОФИЦИАЛЬНОЕ РАСПИСАНИЕ СИНХРОНИЗИРУЕТСЯ...", tour: "ТУР",
      menu: [
        { id: 'next', label: 'Следующий тур', desc: 'Ближайшее сражение лиги', icon: Target, color: 'text-primary' },
        { id: 'my_future', label: 'Мой календарь', desc: 'Ваше расписание на 14 туров', icon: CalendarClock, color: 'text-accent' },
        { id: 'my_history', label: 'Мои результаты', desc: 'Архив всех сражений клуба', icon: History, color: 'text-green-400' },
        { id: 'league_future', label: 'Календарь лиги', desc: 'Расписание всей группы', icon: LayoutList, color: 'text-blue-400' },
        { id: 'league_history', label: 'Результаты лиги', desc: 'Итоги всех сражений группы', icon: ListChecks, color: 'text-yellow-500' },
      ]
    },
    en: {
      title: "MATCH CENTER", subtitle: "Operational briefings",
      backToMenu: "Back to menu", empty: "SYNCING OFFICIAL SCHEDULE...", tour: "TOUR",
      menu: [
        { id: 'next', label: 'Next Tour', desc: 'Nearest tactical engagement', icon: Target, color: 'text-primary' },
        { id: 'my_future', label: 'My Schedule', desc: 'Your 14-day season plan', icon: CalendarClock, color: 'text-accent' },
        { id: 'my_history', label: 'My Results', desc: 'Full club battle archive', icon: History, color: 'text-green-400' },
        { id: 'league_future', label: 'League Calendar', desc: 'Schedule of all group teams', icon: LayoutList, color: 'text-blue-400' },
        { id: 'league_history', label: 'League Results', desc: 'Outcomes of all group battles', icon: ListChecks, color: 'text-yellow-500' },
      ]
    }
  }[language === 'ru' ? 'ru' : 'en'];

  const nameMap = useMemo(() => {
    const names: Record<number, string> = {};
    const logos: Record<number, string> = {};
    if (players) {
      players.forEach(p => {
        names[p.rank] = p.clubName || p.displayName;
        logos[p.rank] = p.clubLogo;
      });
    }
    return { names, logos };
  }, [players]);

  const resolveMatchData = useCallback((m: any) => {
    const hRank = Number(m.homeRank);
    const aRank = Number(m.awayRank);
    const botHome = `BOT_ALPHA_L${leagueLevel}_G${groupId}_R${hRank}`;
    const botAway = `BOT_ALPHA_L${leagueLevel}_G${groupId}_R${aRank}`;

    const homeName = nameMap.names[hRank] || m.homeName || botHome;
    const awayName = nameMap.names[aRank] || m.awayName || botAway;
    const homeLogo = nameMap.logos[hRank] || null;
    const awayLogo = nameMap.logos[aRank] || null;
    return { ...m, homeName, awayName, homeLogo, awayLogo };
  }, [nameMap, leagueLevel, groupId]);

  const renderMatchCard = useCallback((raw: any, idx: number) => {
    const m = resolveMatchData(raw);
    const isLive = isMatchLive(m.startTime);
    const isFinished = m.isFinished;
    const myRank = players?.find(p => p.id === user?.uid)?.rank || 0;
    const isMeHome = Number(m.homeRank) === Number(myRank) || m.homeId === user?.uid;
    const isMeAway = Number(m.awayRank) === Number(myRank) || m.awayId === user?.uid;

    return (
      <Card key={m.id || idx} className={cn(
        "glass-card border-white/5 transition-all overflow-hidden mb-2",
        isLive && "border-primary/40 bg-primary/5",
        (isMeHome || isMeAway) && "border-primary/20 bg-primary/5"
      )}>
        <CardContent className="p-3">
          <div className="flex justify-between items-center mb-3">
             <Badge variant="outline" className="text-[7px] font-black h-4 px-1.5 uppercase border-white/10 opacity-70">
                {m.tour ? `${t.tour} ${m.tour}` : ((m.type || 'MATCH').toUpperCase())}
             </Badge>
             <span className="text-[8px] font-mono font-bold text-muted-foreground">
               {new Date(m.startTime || m.playedAt || m.resolvedAt || Date.now()).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
             </span>
          </div>
          <div className="grid grid-cols-[1fr_40px_1fr] items-center gap-2">
            <div className="flex flex-col items-center gap-1 min-w-0">
               <div className="w-8 h-8 rounded-lg bg-secondary/50 border border-white/5 flex items-center justify-center overflow-hidden p-1">
                 {m.homeLogo ? <img src={m.homeLogo} alt="" className="w-full h-full object-contain" /> : <Shield className="w-4 h-4 text-muted-foreground/30" />}
               </div>
               <p className={cn("text-[9px] font-bold uppercase truncate w-full text-center", isMeHome ? "text-primary" : "text-white")}>{m.homeName}</p>
            </div>
            <div className="flex justify-center items-center">
              {isFinished ? <span className="text-sm font-headline font-black italic">{m.scoreA}:{m.scoreB}</span> : <Swords className="w-4 h-4 text-accent/40" />}
            </div>
            <div className="flex flex-col items-center gap-1 min-w-0">
               <div className="w-8 h-8 rounded-lg bg-secondary/50 border border-white/5 flex items-center justify-center overflow-hidden p-1">
                 {m.awayLogo ? <img src={m.awayLogo} alt="" className="w-full h-full object-contain" /> : <Shield className="w-4 h-4 text-muted-foreground/30" />}
               </div>
               <p className={cn("text-[9px] font-bold uppercase truncate w-full text-center", isMeAway ? "text-primary" : "text-white")}>{m.awayName}</p>
            </div>
          </div>
          {isFinished && (
            <Link href={`/match?id=${m.id}`} className="block mt-3">
              <Button variant="outline" className="w-full h-8 text-[8px] font-black uppercase border-white/10">ОТЧЕТ БОЯ <ChevronRight className="w-3.5 h-3.5 ml-1" /></Button>
            </Link>
          )}
        </CardContent>
      </Card>
    );
  }, [players, resolveMatchData, t.tour, user]);

  const renderGrouped = (matches: any[]) => {
    const tours = [...new Set(matches.map(m => m.tour))].sort((a, b) => a - b);
    return tours.map(tour => (
      <div key={tour} className="mb-6">
        <h3 className="text-[10px] font-black uppercase text-accent tracking-widest mb-2 border-l-2 border-accent pl-2">{t.tour} {tour}</h3>
        {matches.filter(m => m.tour === tour).map((m, i) => renderMatchCard(m, i))}
      </div>
    ));
  };

  const renderContent = () => {
    if (isMatchesLoading || isHomeHistoryLoading || isAwayHistoryLoading) {
      return (
        <div className="py-20 flex flex-col items-center justify-center space-y-4 opacity-50">
          <RefreshCw className="w-8 h-8 animate-spin text-primary" />
          <p className="text-[10px] font-black uppercase tracking-widest">{t.empty}</p>
        </div>
      );
    }

    const allMatches = [...(fixedMatches || [])].sort((a, b) => a.tour - b.tour);
    const myRank = players?.find(p => p.id === user?.uid)?.rank || 0;

    switch(view) {
      case 'next':
        const next = allMatches.filter(m => (Number(m.homeRank) === Number(myRank) || Number(m.awayRank) === Number(myRank)) && !m.isFinished).sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0];
        return (
          <div className="animate-in fade-in">
            <Button variant="ghost" size="sm" onClick={() => setView('menu')} className="mb-4 h-8 text-[10px] font-bold uppercase text-primary"><ChevronLeft className="w-4 h-4 mr-1" /> {t.backToMenu}</Button>
            {next ? renderMatchCard(next, 0) : <div className="py-20 text-center opacity-30 uppercase font-black text-[10px]">ТУРОВ НЕ ОСТАЛОСЬ</div>}
          </div>
        );
      case 'my_future':
        const myFuture = allMatches.filter(m => (Number(m.homeRank) === Number(myRank) || Number(m.awayRank) === Number(myRank)) && !m.isFinished);
        return (
          <div className="animate-in fade-in">
            <Button variant="ghost" size="sm" onClick={() => setView('menu')} className="mb-4 h-8 text-[10px] font-bold uppercase text-primary"><ChevronLeft className="w-4 h-4 mr-1" /> {t.backToMenu}</Button>
            {myFuture.map((m, i) => renderMatchCard(m, i))}
          </div>
        );
      case 'league_future':
        return (
          <div className="animate-in fade-in pb-20">
            <Button variant="ghost" size="sm" onClick={() => setView('menu')} className="mb-4 h-8 text-[10px] font-bold uppercase text-primary"><ChevronLeft className="w-4 h-4 mr-1" /> {t.backToMenu}</Button>
            {renderGrouped(allMatches.filter(m => !m.isFinished))}
          </div>
        );
      case 'my_history':
        const leagueHistory = allMatches.filter(m => (Number(m.homeRank) === Number(myRank) || Number(m.awayRank) === Number(myRank) || m.homeId === user?.uid || m.awayId === user?.uid) && m.isFinished);
        const personalHistory = [...(myHomeMatches || []), ...(myAwayMatches || []), ...(friendlyHostMatches || []), ...(friendlyAwayMatches || []), ...(cupHomeMatches || []), ...(cupAwayMatches || []), ...(tournamentHomeMatches || []), ...(tournamentAwayMatches || []), ...(trainingHomeMatches || []), ...(trainingAwayMatches || []), ...(associationHostMatches || []), ...(associationChallengerMatches || [])].filter((m: any) => m?.isFinished === true);
        const extraHistory = (matchHistory || []).filter((m: any) => m?.isFinished !== false && (m.homeId === user?.uid || m.awayId === user?.uid || m.source === 'history'));
        const historyMap = new Map<string, any>();
        [...leagueHistory, ...personalHistory, ...extraHistory].forEach((m: any) => { if (m?.id) historyMap.set(m.id, m); });
        const myHistory = [...historyMap.values()].sort((a, b) => new Date(b.playedAt || b.resolvedAt || b.startTime || 0).getTime() - new Date(a.playedAt || a.resolvedAt || a.startTime || 0).getTime());
        return (
          <div className="animate-in fade-in">
            <Button variant="ghost" size="sm" onClick={() => setView('menu')} className="mb-4 h-8 text-[10px] font-bold uppercase text-primary"><ChevronLeft className="w-4 h-4 mr-1" /> {t.backToMenu}</Button>
            {myHistory.length ? myHistory.map((m, i) => renderMatchCard(m, i)) : <div className="py-20 text-center opacity-30 uppercase font-black text-[10px]">НЕТ ЗАВЕРШЕННЫХ МАТЧЕЙ</div>}
          </div>
        );
      case 'league_history':
        return (
          <div className="animate-in fade-in pb-20">
            <Button variant="ghost" size="sm" onClick={() => setView('menu')} className="mb-4 h-8 text-[10px] font-bold uppercase text-primary"><ChevronLeft className="w-4 h-4 mr-1" /> {t.backToMenu}</Button>
            {renderGrouped(allMatches.filter(m => m.isFinished).reverse())}
          </div>
        );
      default:
        return (
          <div className="space-y-2 animate-in fade-in">
            {t.menu.map((item) => (
              <Card key={item.id} className="glass-card border-white/5 hover:bg-white/5 transition-all cursor-pointer" onClick={() => setView(item.id as MatchView)}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={cn("p-2.5 rounded-xl bg-secondary/50", item.color)}><item.icon className="w-5 h-5" /></div>
                    <div><h3 className="text-sm font-bold uppercase">{item.label}</h3><p className="text-[10px] text-muted-foreground">{item.desc}</p></div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </CardContent>
              </Card>
            ))}
          </div>
        );
    }
  };

  if (isUserLoading || !isLoaded) return <LoadingScreen />;

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-32">
      <header className="mb-6 flex items-center gap-4">
        <Button variant="ghost" size="icon" className="rounded-full" onClick={() => view === 'menu' ? router.push('/') : setView('menu')}><ChevronLeft className="w-6 h-6" /></Button>
        <div><h1 className="text-2xl font-headline font-bold uppercase tracking-tighter leading-none">{t.title}</h1><p className="text-muted-foreground text-[10px] uppercase tracking-widest mt-1">League {selectedLeagueId} • Season {seasonNumber}</p></div>
      </header>
      {renderContent()}
    </div>
  );
}
