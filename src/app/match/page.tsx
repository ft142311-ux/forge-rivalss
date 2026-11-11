
'use client';

/**
 * @fileOverview ОФИЦИАЛЬНЫЙ ПЛЕЕР МАТЧЕЙ v130 (V2 COLLECTIONS).
 * Загружает отчёты из отдельных коллекций игровых режимов и игроков v14.
 */

import { useState, useEffect, useMemo, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { useGameState } from '../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  ChevronLeft, Swords, Activity, ArrowRight, 
  ShieldCheck, Zap, Target, Trophy, 
  User, ShieldAlert, Info, Users,
  Timer, ChevronRight, Crown,
  Skull, Activity as ActivityIcon, Castle, Radio,
  Package, Sparkles, Flame, HeartPulse, GraduationCap,
  Microscope, X, Shield
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { doc, collection, query, where } from 'firebase/firestore';
import { getMatchReportAction } from '@/app/actions/match-report';
import { getCompletedSeriesScore, normalizeMatchTimeline, parseMatchSeriesScore, resolveMatchSimulation } from '../lib/match-report-utils';

type MatchStep = 'preview' | 'live' | 'stats';

function MatchContent() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const db = useFirestore();
  const { 
    language, isLoaded, markMatchIdAsSeen,
    matchHistory, clubLogo: myClubLogo, selectedLeagueId, leagueLevel, groupId, rank
  } = useGameState();

  const matchIdFromUrl = searchParams.get('id');
  const [step, setStep] = useState<MatchStep>('preview');
  const [matchData, setMatchData] = useState<any | null>(null);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [isFinalizingReview, setIsFinalizingReview] = useState(false);
  
  const [activeGameIdx, setActiveGameIdx] = useState(0);
  const [visibleEvents, setVisibleEvents] = useState<any[]>([]);
  const [liveKillScore, setLiveKillScore] = useState({ home: 0, away: 0 });
  const [liveSeriesScore, setLiveSeriesScore] = useState({ home: 0, away: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);

  const groupPlayersQuery = useMemoFirebase(() => {
    if (!db || !selectedLeagueId) return null;
    return query(collection(db, 'players_v14'), 
      where('selectedLeagueId', '==', selectedLeagueId),
      where('leagueLevel', '==', leagueLevel),
      where('groupId', '==', groupId)
    );
  }, [db, selectedLeagueId, leagueLevel, groupId]);

  const { data: groupPlayers } = useCollection(groupPlayersQuery);

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

  useEffect(() => {
    if (!matchIdFromUrl) {
      setMatchData(null);
      setIsDataLoading(false);
      return;
    }

    // Restore local history before falling back when a mode-specific report
    // cannot be loaded from the server.
    if (!isLoaded) {
      setIsDataLoading(true);
      return;
    }

    let cancelled = false;
    const fetchMatch = async () => {
      setIsDataLoading(true);
      const localMatch = (matchHistory || []).find(
        (match: any) => String(match?.id || '') === matchIdFromUrl
      );

      try {
        // If Firestore is not ready, use the local history fallback instead
        // of leaving the full-page loader active forever.
        if (!db || !user) {
          if (!cancelled) setMatchData(localMatch || null);
          return;
        }

        const idToken = await user.getIdToken();
        const response = await getMatchReportAction(idToken, matchIdFromUrl);
        if (cancelled) return;
        setMatchData(response.success ? response.match : localMatch || null);
      } catch (error) {
        console.error('[MATCH] Firestore lookup failed; trying local history:', error);
        if (!cancelled) setMatchData(localMatch || null);
      } finally {
        if (!cancelled) setIsDataLoading(false);
      }
    };

    void fetchMatch();
    return () => { cancelled = true; };
  }, [matchIdFromUrl, db, matchHistory, isLoaded, user]);

  const currentSimulation = useMemo(() => resolveMatchSimulation(matchData), [matchData]);

  const currentDraft = useMemo(() => {
    const draft = currentSimulation?.draft || matchData?.draft;
    if (!draft || typeof draft !== 'object') return null;
    const picks = draft.picks && typeof draft.picks === 'object' ? draft.picks : {};
    const bans = draft.bans && typeof draft.bans === 'object' ? draft.bans : {};
    return {
      homePicks: Array.isArray(picks.home) ? picks.home : [],
      awayPicks: Array.isArray(picks.away) ? picks.away : [],
      homeBans: Array.isArray(bans.home) ? bans.home : [],
      awayBans: Array.isArray(bans.away) ? bans.away : [],
      notes: Array.isArray(draft.notes) ? draft.notes.filter((note: unknown) => typeof note === 'string').slice(0, 6) : [],
    };
  }, [currentSimulation, matchData]);

  const seriesDisplayScore = useMemo(
    () => parseMatchSeriesScore(currentSimulation?.seriesScore, matchData),
    [currentSimulation, matchData]
  );

  const resolvedMatchData = useMemo(() => {
    if (!matchData) return null;
    
    if (matchData.homeRank && matchData.awayRank) {
      const hRank = Number(matchData.homeRank);
      const aRank = Number(matchData.awayRank);
      
      const botHome = `BOT_ALPHA_L${leagueLevel}_G${groupId}_R${hRank}`;
      const botAway = `BOT_ALPHA_L${leagueLevel}_G${groupId}_R${aRank}`;

      return {
        ...matchData,
        homeName: nameMap.names[hRank] || matchData.homeName || botHome,
        awayName: nameMap.names[aRank] || matchData.awayName || botAway,
        homeLogo: nameMap.logos[hRank] || matchData.homeLogo || null,
        awayLogo: nameMap.logos[aRank] || matchData.awayLogo || null,
      };
    }
    
    return matchData;
  }, [matchData, nameMap, leagueLevel, groupId]);

  useEffect(() => {
    if (step !== 'live' || !currentSimulation || !currentSimulation.games) return;
    if (currentSimulation.isTbdWin) { setStep('stats'); return; }
    const game = currentSimulation.games[activeGameIdx];
    if (!game) { setStep('stats'); return; }
    // Preserve all engine event fields (especially score) for the live scoreboard.
    const events = normalizeMatchTimeline(game);
    if (events.length === 0) { setStep('stats'); return; }
    setVisibleEvents([]);
    setLiveKillScore({ home: 0, away: 0 });
    setLiveSeriesScore(getCompletedSeriesScore(currentSimulation.games, activeGameIdx));
    let currentEvt = 0;
    const timer = setInterval(() => {
      if (currentEvt < events.length) {
        const nextEvent = events[currentEvt];
        setVisibleEvents(prev => [...prev, nextEvent]);
        const scoreValue = nextEvent?.score;
        const scoreText = typeof scoreValue === 'string'
          ? scoreValue
          : scoreValue && typeof scoreValue === 'object'
            ? `${scoreValue.home ?? scoreValue.killsHome ?? scoreValue.a ?? ''}:${scoreValue.away ?? scoreValue.killsAway ?? scoreValue.b ?? ''}`
            : '';
        const scoreRaw = scoreText.match(/(\d+)\s*:\s*(\d+)/);
        if (scoreRaw) setLiveKillScore({ home: Number(scoreRaw[1]), away: Number(scoreRaw[2]) });
        currentEvt++;
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      } else {
        clearInterval(timer);
        if (activeGameIdx < currentSimulation.games.length - 1) {
          const finishedGame = currentSimulation.games[activeGameIdx];
          setLiveSeriesScore(prev => ({ home: prev.home + Number(finishedGame?.homeScore || 0), away: prev.away + Number(finishedGame?.awayScore || 0) }));
          setTimeout(() => { setActiveGameIdx(prev => prev + 1); setVisibleEvents([]); }, 1000); 
        } else { setTimeout(() => setStep('stats'), 1500); }
      }
    }, 750); 
    return () => clearInterval(timer);
  }, [step, activeGameIdx, currentSimulation]);

  const handleNext = async (e?: React.MouseEvent) => {
    if (e && (e.target as HTMLElement).closest('[data-stop-propagation]')) return;
    if (step === 'preview') { if (currentSimulation?.isTbdWin) setStep('stats'); else setStep('live'); }
    else if (step === 'live') setStep('stats');
    else {
      // Не полагаемся только на Firestore: отчет мог быть удалён после его открытия.
      // В таком случае Finish Viewing всё равно должен убрать его из счетчика.
      const viewedId = matchIdFromUrl || String(matchData?.id || '');
      if (viewedId) {
        setIsFinalizingReview(true);
        await markMatchIdAsSeen(viewedId);
      }
      router.replace('/');
    }
  };

  if (isUserLoading || isDataLoading || !isLoaded || !user) return <LoadingScreen />;
  if (!resolvedMatchData || !currentSimulation) return <div className="p-20 text-center"><p className="text-muted-foreground uppercase text-[10px] font-black">Match data not found</p></div>;

  const t = {
    en: {
      reportTitle: "OFFICIAL MATCH DEBRIEF",
      next: "WATCH TRANSCRIPTION", skip: "SKIP TO STATS", accept: "FINALIZE REVIEW", exit: "EXIT",
      home: "HOME", away: "AWAY", vs: "VS",
      comparison: "TEAM CUMULATIVE SKILL ANALYSIS",
      staffInfluence: "STAFF PERFORMANCE CONTRIBUTION",
      compFarm: "Total Resource Farm", compTactics: "Tactical Execution", compTeam: "Strategic Unity", compRef: "Combat Reflexes",
      tbdTitle: "TECHNICAL WIN SECURED",
      tbdDesc: "Opponent (TBD) failed to deploy for tactical engagement.",
      draftTitle: "PRE-MATCH DRAFT", picks: "PICKS", bans: "BANS", mastery: "Mastery", noDraft: "Draft data is not available for this match.",
      victory: "VICTORY:", draw: "MATCH DRAWN", map: "MAP"
    },
    ru: {
      reportTitle: "ОФИЦИАЛЬНЫЙ ОТЧЕТ БОЯ",
      next: "СМОТРЕТЬ ПОВТОР", skip: "К СТАТИСТИКЕ", accept: "ЗАВЕРШИТЬ ПРОСМОТР", exit: "ВЫЙТИ",
      home: "ДОМА", away: "В ГОСТЯХ", vs: "ПРОТИВ",
      comparison: "АНАЛИЗ СУММАРНЫХ НАВЫКОВ КОМАНД",
      staffInfluence: "ВКЛАД ПЕРСОНАЛА КЛУБА",
      compFarm: "Суммарный фарм", compTactics: "Тактическая точность", compTeam: "Стратегическое единство", compRef: "Боевые рефлексы",
      tbdTitle: "ТЕХНИЧЕСКАЯ ПОБЕДА",
      tbdDesc: "Соперник (TBD) не явился на поле боя.",
      draftTitle: "ДРАФТ ПЕРЕД МАТЧЕМ", picks: "ВЫБОР", bans: "БАНЫ", mastery: "Мастерство", noDraft: "Данные драфта для этого матча отсутствуют.",
      victory: "ПОБЕДА:", draw: "НИЧЬЯ В СЕРИИ", map: "КАРТА"
    }
  }[language === 'ru' ? 'ru' : 'en'];

  const renderDraftPanel = () => {
    if (!currentDraft) return null;
    const renderPicks = (picks: any[], side: 'home' | 'away') => (
      <div className="space-y-2">
        {picks.map((pick: any, index: number) => (
          <div key={`${pick?.playerId || pick?.playerName || side}-${pick?.heroId || index}`} className="rounded-xl border border-white/5 bg-background/40 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[9px] font-black uppercase text-white truncate">{String(pick?.playerName || 'Игрок')}</span>
              <Badge variant="outline" className="shrink-0 text-[7px] border-white/10">{String(pick?.role || '')}</Badge>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold text-primary truncate">{String(pick?.heroName || pick?.heroId || '—')}</span>
              <span className="text-[8px] text-muted-foreground shrink-0">{t.mastery}: {Math.max(0, Math.min(100, Number(pick?.mastery) || 0))}</span>
            </div>
          </div>
        ))}
        {picks.length === 0 && <p className="text-[9px] text-muted-foreground">—</p>}
      </div>
    );
    const renderBans = (bans: any[]) => bans.length ? bans.map((ban: any, index: number) => (
      <Badge key={`${String(ban)}-${index}`} variant="outline" className="text-[8px] border-red-400/20 text-red-300">{String(ban)}</Badge>
    )) : <span className="text-[9px] text-muted-foreground">—</span>;
    return (
      <Card className="glass-card border-white/10 bg-secondary/10 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2"><Swords className="w-4 h-4 text-primary"/><h3 className="text-[10px] font-black uppercase tracking-widest">{t.draftTitle}</h3></div>
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><p className="text-[8px] font-black uppercase tracking-widest text-primary">{resolvedMatchData.homeName} · {t.picks}</p>{renderPicks(currentDraft.homePicks, 'home')}</div>
            <div className="space-y-2"><p className="text-[8px] font-black uppercase tracking-widest text-accent text-right">{resolvedMatchData.awayName} · {t.picks}</p>{renderPicks(currentDraft.awayPicks, 'away')}</div>
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-white/5 pt-3">
            <div className="space-y-1.5"><p className="text-[8px] font-black uppercase tracking-widest text-red-300">{resolvedMatchData.homeName} · {t.bans}</p><div className="flex flex-wrap gap-1">{renderBans(currentDraft.homeBans)}</div></div>
            <div className="space-y-1.5"><p className="text-[8px] font-black uppercase tracking-widest text-red-300 text-right">{resolvedMatchData.awayName} · {t.bans}</p><div className="flex flex-wrap gap-1 justify-end">{renderBans(currentDraft.awayBans)}</div></div>
          </div>
          {currentDraft.notes.length > 0 && <div className="space-y-1 border-t border-white/5 pt-3">{currentDraft.notes.map((note: string, index: number) => <p key={`${index}-${note}`} className="text-[9px] leading-relaxed text-muted-foreground">• {note}</p>)}</div>}
        </CardContent>
      </Card>
    );
  };

  const renderStatsTable = (game: any) => {
    if (currentSimulation.isTbdWin) {
      return (
        <div className="py-12 text-center animate-in zoom-in duration-700">
           <ShieldCheck className="w-20 h-20 text-green-500 mx-auto mb-6 drop-shadow-[0_0_15px_rgba(34,197,94,0.4)]" />
           <h2 className="text-2xl font-headline font-bold text-white uppercase mb-2">{t.tbdTitle}</h2>
           <p className="text-xs text-muted-foreground px-10 italic">"{t.tbdDesc}"</p>
        </div>
      );
    }

    const scoreboard = game.scoreboard || [];
    const homeHeroes = scoreboard.filter((p: any) => p.team === resolvedMatchData.homeName);
    const awayHeroes = scoreboard.filter((p: any) => p.team === resolvedMatchData.awayName);

    const renderHeroRow = (p: any, side: 'left' | 'right') => (
      <div key={p.name} className={cn("flex flex-col gap-1.5 p-3 rounded-2xl border border-white/5 bg-secondary/10 shadow-sm", side === 'right' ? "items-end text-right" : "items-start text-left")}>
        <div className={cn("flex items-center gap-3 w-full", side === 'right' && "flex-row-reverse")}>
          <div className="relative shrink-0">
            <div className="w-14 h-14 rounded-2xl overflow-hidden border border-white/10 bg-background flex items-center justify-center shadow-xl">
              {p.image ? <img src={p.image} alt="" className="w-full h-full object-cover" /> : <User className="w-7 h-7 text-muted-foreground" />}
            </div>
            {p.name === game.mvp && <Trophy className="absolute -top-1.5 -right-1.5 w-6 h-6 text-yellow-500 fill-yellow-500" />}
            <div className="absolute -bottom-1 -left-1 bg-black/90 rounded-lg px-2 py-0.5 border border-white/10 shadow-2xl">
              <span className="text-[10px] font-black text-accent">{Number(p.matchRating || 6.0).toFixed(1)}</span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-black uppercase truncate text-white leading-none mb-1">{p.name}</p>
            <div className={cn("flex items-center gap-2", side === 'right' && "justify-end")}>
               <Badge variant="outline" className="text-[7px] h-4 px-1.5 border-white/10 opacity-70 uppercase font-black">{p.role}</Badge>
               <span className="text-[10px] font-mono font-bold text-primary">{p.kills}/{p.deaths}/{p.assists}</span>
            </div>
          </div>
        </div>
      </div>
    );

    return (
      <div className="space-y-8" data-stop-propagation="true" onClick={(e) => e.stopPropagation()}>
        {game.teamComparison && (
          <section className="space-y-4">
            <h3 className="text-[11px] font-black uppercase tracking-widest text-accent text-center flex items-center justify-center gap-2 bg-accent/5 py-2 rounded-xl">
              <ActivityIcon className="w-4 h-4" /> {t.comparison}
            </h3>
            <div className="space-y-6 bg-secondary/20 p-6 rounded-3xl border border-white/5 shadow-inner">
              {[
                { label: t.compFarm, key: 'farm', icon: Zap, color: 'text-yellow-500' },
                { label: t.compTactics, key: 'tactics', icon: Target, color: 'text-blue-500' },
                { label: t.compTeam, key: 'teamwork', icon: Users, color: 'text-green-500' },
                { label: t.compRef, key: 'reflexes', icon: ActivityIcon, color: 'text-red-500' }
              ].map(stat => (
                <div key={stat.key} className="space-y-2.5">
                  <div className="flex justify-between items-center text-[11px] font-black uppercase tracking-tighter">
                    <span className="text-primary text-base font-headline">{game.teamComparison[stat.key][0]}</span>
                    <span className="text-muted-foreground flex items-center gap-2 opacity-80 text-[10px]"><stat.icon className={cn("w-4 h-4", stat.color)} /> {stat.label}</span>
                    <span className="text-accent text-base font-headline">{game.teamComparison[stat.key][1]}</span>
                  </div>
                  <div className="h-2 w-full bg-background/50 rounded-full flex overflow-hidden border border-white/5">
                    <div className="h-full bg-primary" style={{ width: `${(game.teamComparison[stat.key][0] / Math.max(1, (game.teamComparison[stat.key][0] + game.teamComparison[stat.key][1]))) * 100}%` }} />
                    <div className="h-full bg-accent" style={{ width: `${(game.teamComparison[stat.key][1] / Math.max(1, (game.teamComparison[stat.key][0] + game.teamComparison[stat.key][1]))) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2.5"><p className="text-[9px] font-black uppercase tracking-widest text-primary mb-3">{t.home}</p>{homeHeroes.map((p: any) => renderHeroRow(p, 'left'))}</div>
          <div className="space-y-2.5"><p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-3 text-right">{t.away}</p>{awayHeroes.map((p: any) => renderHeroRow(p, 'right'))}</div>
        </div>
      </div>
    );
  };

  const isMeHome = resolvedMatchData.homeId === user?.uid || Number(resolvedMatchData.homeRank) === Number(rank);
  const isMeAway = resolvedMatchData.awayId === user?.uid || Number(resolvedMatchData.awayRank) === Number(rank);
  const isDraw = currentSimulation.winner === "Ничья" || currentSimulation.winner === "Draw";

  return (
    <div className="min-h-screen bg-background text-foreground pb-32 relative overflow-hidden">
      <div className="max-w-md mx-auto relative z-10 px-4 pt-6">
        <header className="text-center space-y-4 mb-8">
          <h1 className="text-sm font-headline font-bold text-white uppercase tracking-tighter">{t.reportTitle}</h1>
          <div className="flex items-center justify-center gap-2 max-w-[240px] mx-auto">
            <div className={cn("h-1 flex-1 rounded-full", step === 'preview' ? "bg-primary shadow-[0_0_10px_rgba(var(--primary),0.5)]" : "bg-primary/20")} />
            <div className={cn("h-1 flex-1 rounded-full", step === 'live' ? "bg-primary" : "bg-primary/20")} />
            <div className={cn("h-1 flex-1 rounded-full", step === 'stats' ? "bg-primary" : "bg-primary/20")} />
          </div>
        </header>

        {step === 'preview' && (
          <>
            <Card className="glass-card border-white/10 bg-gradient-to-br from-primary/10 to-transparent overflow-hidden">
            <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
              <Badge variant="outline" className="text-[8px] font-black uppercase">ПРОБНЫЙ МАТЧ • BO2</Badge>
              <span className="text-[9px] text-muted-foreground uppercase">Итог: {seriesDisplayScore.home}-{seriesDisplayScore.away}</span>
            </div>
            <div className="grid grid-cols-2 divide-x divide-white/5">
              <div className="p-6 flex flex-col items-center gap-4 text-center">
                <div className="w-20 h-20 rounded-2xl bg-secondary/50 border border-primary/30 flex items-center justify-center overflow-hidden p-2">
                  {isMeHome && myClubLogo ? <img src={myClubLogo} alt="" className="w-full h-full object-contain" /> : <div className="text-4xl">🛡️</div>}
                </div>
                <h3 className="text-[11px] font-headline font-bold uppercase truncate text-white leading-tight">{resolvedMatchData.homeName}</h3>
              </div>
              <div className="p-6 flex flex-col items-center gap-4 text-center">
                <div className="w-20 h-20 rounded-2xl bg-secondary/50 border border-white/10 flex items-center justify-center overflow-hidden p-2">
                  {isMeAway && myClubLogo ? <img src={myClubLogo} alt="" className="w-full h-full object-contain" /> : <div className="text-4xl">⚔️</div>}
                </div>
                <h3 className="text-[11px] font-headline font-bold uppercase truncate text-white leading-tight">{resolvedMatchData.awayName}</h3>
              </div>
            </div>
            </Card>
            {renderDraftPanel()}
          </>
        )}

        {step === 'live' && (
          <div onClick={() => setStep('stats')} className="space-y-5 animate-in slide-in-from-right-4 pb-20 cursor-pointer select-none">
            <Card className="glass-card border-primary/20 bg-primary/5 overflow-hidden">
              <CardContent className="p-5">
                <div className="text-center mb-4">
                  <p className="text-[8px] font-black uppercase tracking-[0.25em] text-muted-foreground">СЧЁТ СЕРИИ</p>
                  <div className="text-2xl font-headline font-black text-blue-400 tracking-widest">{liveSeriesScore.home}:{liveSeriesScore.away}</div>
                  <p className="text-[8px] font-black uppercase tracking-[0.25em] text-muted-foreground mt-2">СЧЁТ ИГРЫ {activeGameIdx + 1}</p>
                </div>
                <div className="grid grid-cols-[1fr_90px_1fr] items-center gap-3 mb-5">
                  <p className="text-[10px] font-black uppercase text-center truncate">{resolvedMatchData.homeName}</p>
                  <div className="text-center text-4xl font-headline font-black tracking-widest">{liveKillScore.home}:{liveKillScore.away}</div>
                  <p className="text-[10px] font-black uppercase text-center truncate">{resolvedMatchData.awayName}</p>
                </div>
                <p className="text-center text-[7px] text-muted-foreground uppercase tracking-widest mb-3">Нажмите в любое место, чтобы перейти к статистике</p>
                <div ref={scrollRef} className="max-h-[320px] overflow-y-auto space-y-2 pr-1">
                  {visibleEvents.filter((event: any) => event != null).length ? visibleEvents.filter((event: any) => event != null).map((event: any, idx: number) => {
                    const safeEvent = typeof event === 'object' ? event : { minute: '', text: String(event ?? '') };
                    const minute = safeEvent?.minute ?? safeEvent?.time ?? safeEvent?.timestamp ?? `${idx + 1}:00`;
                    const text = safeEvent?.text ?? safeEvent?.description ?? safeEvent?.message ?? '';
                    return (
                      <div key={idx} className="rounded-xl border border-white/5 bg-secondary/20 p-3 flex gap-3">
                        <span className="text-[9px] font-mono text-primary font-black shrink-0">{minute}</span>
                        <span className="text-[10px] leading-relaxed text-white/80">{text}</span>
                      </div>
                    );
                  }) : <p className="text-center text-[9px] uppercase tracking-widest text-muted-foreground py-8">Загрузка трансляции...</p>}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {step === 'stats' && (
          <div className="space-y-6 animate-in slide-in-from-right-4 pb-20">
            <div className="text-center py-6">
              <div className="flex items-center justify-center gap-2 mb-4 px-2">
                <span className="text-4xl font-headline font-black italic text-white">{seriesDisplayScore.home} : {seriesDisplayScore.away}</span>
              </div>
              <Badge className={cn("mt-2 text-[10px] font-black px-8 py-1 uppercase tracking-widest", currentSimulation.isTbdWin ? "bg-green-500/20 text-green-400" : (isDraw ? "bg-secondary" : "bg-primary/20 text-primary"))}>
                {currentSimulation.isTbdWin ? 'TECHNICAL VICTORY' : (isDraw ? t.draw : `${t.victory} ${currentSimulation.winner}`)}
              </Badge>
            </div>
            {renderDraftPanel()}
            {currentSimulation.games.map((game: any, idx: number) => (
              <div key={idx} className="mt-4">{renderStatsTable(game)}</div>
            ))}
          </div>
        )}

        <div className="mt-6 flex justify-center">
          {step === 'preview' && (
            <Button type="button" onClick={() => handleNext()} className="w-full uppercase font-black tracking-widest text-[10px]">
              {t.next} <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          )}
          {step === 'stats' && (
            <Button type="button" onClick={() => void handleNext()} disabled={isFinalizingReview} className="w-full uppercase font-black tracking-widest text-[10px]">
              {isFinalizingReview ? (language === 'ru' ? 'СОХРАНЯЕМ ПРОСМОТР…' : 'SAVING REVIEW…') : t.accept} <ChevronRight className="ml-2 w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MatchPage() { return <Suspense fallback={<LoadingScreen />}><MatchContent /></Suspense>; }
