'use client';

import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { useGameState } from '../lib/store';
import { 
  Trophy, ChevronLeft, ChevronRight, 
  Shield, Globe, Layers, RefreshCw,
  ShieldAlert, ArrowUp, X, Crown, Vote, Loader2, Archive, CalendarDays
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  MAX_LEVELS,
  TEAMS_PER_GROUP,
  getGroupsCountInLevel,
  LEAGUES
} from '../lib/leagues-data';
import { Badge } from '@/components/ui/badge';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, query, where } from 'firebase/firestore';
import { castGoldenPlayerVoteAction } from '@/app/actions/foundation-advanced';
import { useToast } from '@/hooks/use-toast';
import { getVisibleSeasonArchives } from '@/app/actions/season-archive';

type RankingTab = 'menu' | 'my_league' | 'my_pyramid' | 'all_pyramids' | 'cup' | 'season_top' | 'season_archive' | 'season_archive_detail';

export default function RankingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { user } = useUser();
  const db = useFirestore();
  const { isLoaded, language, seasonNumber, ownedPlayers } = useGameState();
  
  const [activeTab, setActiveTab] = useState<RankingTab>('menu');
  const [cupRound, setCupRound] = useState(1);
  const [navLeague, setNavLeague] = useState<string | null>(null);
  const [navLevel, setNavLevel] = useState<number | null>(null);
  const [navGroup, setNavGroup] = useState<number | null>(null);
  const [busyVote, setBusyVote] = useState<string | null>(null);
  const [tableLoadAttempt, setTableLoadAttempt] = useState(0);
  const [tableLoadTimedOut, setTableLoadTimedOut] = useState(false);
  const [selectedArchiveSeason, setSelectedArchiveSeason] = useState<number | null>(null);
  const [archiveGroup, setArchiveGroup] = useState('D1-G1');

  const seasonTopFromUrl = searchParams.get('view') === 'season_top';

  useEffect(() => {
    if (seasonTopFromUrl) setActiveTab('menu');
  }, [seasonTopFromUrl]);

  const userProfileRef = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return doc(db, 'players_v14', user.uid);
  }, [db, user?.uid]);

  const { data: profile, isLoading: isProfileLoading } = useDoc(userProfileRef);

  // seasonNumber in the local game store is a legacy cached field and can remain
  // stuck at Season 1. The authoritative season is system_v1/season_config.
  const seasonConfigRef = useMemoFirebase(() => db ? doc(db, 'system_v1', 'season_config') : null, [db]);
  const { data: seasonConfig } = useDoc(seasonConfigRef);
  const archivesRef = useMemoFirebase(() => db ? collection(db, 'league_season_archives_v1') : null, [db]);
  const { data: archiveDocuments, isLoading: isArchiveListLoading, error: archiveListError } = useCollection(archivesRef);
  const visibleArchives = useMemo(() => getVisibleSeasonArchives(archiveDocuments || []), [archiveDocuments]);
  const selectedArchive = visibleArchives.find((archive: any) => Number(archive.sourceSeason) === selectedArchiveSeason) || null;
  const archiveMatchesRef = useMemoFirebase(() => {
    if (!db || !selectedArchiveSeason || !selectedArchive) return null;
    return collection(db, 'league_season_archives_v1', 'S' + selectedArchiveSeason, 'matches');
  }, [db, selectedArchiveSeason, selectedArchive]);
  const { data: archiveMatchDocuments, isLoading: isArchiveMatchesLoading, error: archiveMatchesError } = useCollection(archiveMatchesRef);
  const archiveGroupRows = (selectedArchive?.standings?.[archiveGroup] || selectedArchive?.startingParticipants?.[archiveGroup] || []) as any[];
  const archiveGroupMatches = (archiveMatchDocuments || [])
    .filter((match: any) => 'D' + Number(match.level) + '-G' + Number(match.group) === archiveGroup)
    .sort((a: any, b: any) => Number(a.tour || 0) - Number(b.tour || 0) || String(a.matchId || a.id).localeCompare(String(b.matchId || b.id)));
  const tableSeasonNumber = Math.max(1, Number((seasonConfig as any)?.activeSeasonNumber || seasonNumber || 1));

  const contextLeagueId = String(navLeague || profile?.selectedLeagueId || "ALPHA");
  const contextLevel = Number(navLevel || profile?.leagueLevel || MAX_LEVELS);
  const contextGroup = Number(navGroup || profile?.groupId || 1);

  const tableId = `table_v140_S${tableSeasonNumber}_L${contextLeagueId}_V${contextLevel}_G${contextGroup}`;
  const tableRef = useMemoFirebase(() => {
    if (!db || !isLoaded) return null;
    return doc(db, 'league_tables_v2', tableId);
  }, [db, tableId, isLoaded, tableLoadAttempt]);

  const { data: tableData, isLoading: isTableLoading, error: tableError } = useDoc(tableRef);

  const pyramidCupRef = useMemoFirebase(() => db ? doc(db, 'cup_pyramid_v1', `cup_s${tableSeasonNumber}_lALPHA`) : null, [db, tableSeasonNumber]);
  const { data: pyramidCup, isLoading: isPyramidCupLoading } = useDoc(pyramidCupRef);

  // Never leave the group screen on an endless spinner if Firestore cannot
  // complete the initial snapshot (offline emulator, network, or permissions).
  useEffect(() => {
    setTableLoadTimedOut(false);
    if (!tableRef || !isTableLoading) return;

    const timeoutId = window.setTimeout(() => {
      setTableLoadTimedOut(true);
    }, 12000);

    return () => window.clearTimeout(timeoutId);
  }, [tableRef, isTableLoading, tableLoadAttempt]);

  const retryTableLoad = () => {
    setTableLoadTimedOut(false);
    setTableLoadAttempt(attempt => attempt + 1);
  };

  const groupPlayersQuery = useMemoFirebase(() => {
    if (!db) return null;
    return query(collection(db, 'players_v14'), 
      where('selectedLeagueId', '==', contextLeagueId),
      where('leagueLevel', '==', contextLevel),
      where('groupId', '==', contextGroup)
    );
  }, [db, contextLeagueId, contextLevel, contextGroup]);

  const { data: groupPlayers } = useCollection(groupPlayersQuery);

  const awardsQuery = useMemoFirebase(() => db && user ? query(collection(db, 'player_awards_v1'), where('seasonId', '==', 'current')) : null, [db, user]);
  const { data: awardVotes } = useCollection(awardsQuery);

  const logoMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (groupPlayers) {
      groupPlayers.forEach(p => {
        if (p.clubLogo) map[p.id] = p.clubLogo;
      });
    }
    return { logos: map };
  }, [groupPlayers]);

  const standings = useMemo(() => {
    if (!tableData?.stats) return [];

    // The UI must never render legacy rank-9 rows or duplicate rank entries,
    // even before the next server-side calendar repair completes.
    const byRank = new Map<number, any>();
    for (const [key, value] of Object.entries(tableData.stats as Record<string, any>)) {
      const row: any = value || {};
      const rank = Number(row.rank);
      if (!Number.isInteger(rank) || rank < 1 || rank > TEAMS_PER_GROUP) continue;
      const id = String(row.id || key);
      const existing = byRank.get(rank);
      if (!existing || (String(existing.id || '').startsWith('BOT_') && !id.startsWith('BOT_'))) {
        byRank.set(rank, { ...row, id, rank });
      }
    }

    return [...byRank.values()].sort((a: any, b: any) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return (b.diff || 0) - (a.diff || 0);
    });
  }, [tableData]);

  const t = {
    en: {
      title: "RANKINGS HUB", subtitle: "Global Competitive Terminals",
      pts: "PTS", winLoss: "W-D-L", m: "M", back: "Back", team: "TEAM",
      loading: "Syncing League Data...",
      loadFailed: "Could not load this group's standings. Check your connection and retry.",
      retry: "Retry loading",
      noTable: "SECTOR NOT INITIALIZED",
      noTableDesc: "This division sector is currently empty. No managers have deployed here yet.",
      promotion: "PROMOTION",
      relegation: "RELEGATION",
      menu: [
        { id: 'my_league', label: 'League Standings', desc: `Division ${profile?.leagueLevel || '...'}.${profile?.groupId || '...'}`, icon: Shield, color: 'text-primary' },
        { id: 'my_pyramid', label: 'League Pyramid', desc: `Explore ${profile?.selectedLeagueId || 'ALPHA'}`, icon: Layers, color: 'text-accent' },
        { id: 'cup', label: 'Pyramid Cup', desc: 'Tournament bracket', icon: Trophy, color: 'text-yellow-500' },
        { id: 'all_pyramids', label: 'Global Map', desc: 'Browse all active leagues', icon: Globe, color: 'text-blue-400' },
        { id: 'season_archive', label: language === 'ru' ? 'Архив сезонов' : 'Season Archive', desc: (language === 'ru' ? 'Завершённых сезонов: ' : '') + visibleArchives.length, icon: Archive, color: 'text-amber-400' },
      ]
    },
    ru: {
      title: "ТАБЛИЦЫ РЕЙТИНГА", subtitle: "Терминалы глобальных соревнований",
      pts: "О", winLoss: "В-Н-П", m: "И", back: "Назад", team: "КОМАНДА",
      loading: "Синхронизация данных...",
      loadFailed: "Не удалось загрузить таблицу группы. Проверь подключение и попробуй снова.",
      retry: "Повторить загрузку",
      noTable: "СЕКТОР НЕ ИНИЦИАЛИЗИРОВАН",
      noTableDesc: "Данный сектор дивизиона пока пуст. В нем нет ни одного активного менеджера.",
      promotion: "ПОВЫШЕНИЕ",
      relegation: "ВЫЛЕТ",
      menu: [
        { id: 'my_league', label: 'Таблица Лиги', desc: `Дивизион ${profile?.leagueLevel || '...'}.${profile?.groupId || '...'}`, icon: Shield, color: 'text-primary' },
        { id: 'my_pyramid', label: 'Пирамида Лиги', desc: `Изучить лигу ${profile?.selectedLeagueId || 'ALPHA'}`, icon: Layers, color: 'text-accent' },
        { id: 'cup', label: 'Кубок Пирамиды', desc: 'Сетка турнира', icon: Trophy, color: 'text-yellow-500' },
        { id: 'all_pyramids', label: 'Карта мира', desc: 'Все активные лиги мира', icon: Globe, color: 'text-blue-400' },
        { id: 'season_archive', label: language === 'ru' ? 'Архив сезонов' : 'Season Archive', desc: (language === 'ru' ? 'Завершённых сезонов: ' : '') + visibleArchives.length, icon: Archive, color: 'text-amber-400' },
      ]
    }
  }[language === 'ru' ? 'ru' : 'en'];

  const handleBack = () => {
    if (activeTab === 'season_archive_detail') { setActiveTab('season_archive'); return; }
    if (activeTab === 'season_archive') { setActiveTab('menu'); return; }
    if (activeTab === 'season_top') { setActiveTab('menu'); return; }
    if (activeTab === 'my_league' || activeTab === 'cup') { setActiveTab('menu'); return; }
    if (activeTab === 'my_pyramid' || activeTab === 'all_pyramids') {
      if (navGroup) { setNavGroup(null); return; }
      if (navLevel) { setNavLevel(null); return; }
      if (navLeague) { setNavLeague(null); return; }
      setActiveTab('menu');
      return;
    }
    router.push('/');
  };

  const alreadyVoted = (awardVotes || []).some((v: any) => v.voterId === user?.uid && v.seasonId === 'current');
  const voteForPlayer = async (player: any) => {
    if (!user || alreadyVoted || busyVote) return;
    setBusyVote(player.id);
    try {
      const token = await user.getIdToken(true);
      const result = await castGoldenPlayerVoteAction(token, 'current', player.id, player.name, profile?.displayName || 'Manager');
      if ('error' in result) throw new Error(String(result.error || 'VOTE_FAILED')); if (!result.success) throw new Error('VOTE_FAILED');
      toast({ title: language === 'ru' ? 'Голос принят' : 'Vote recorded' });
    } catch (e: any) {
      toast({ title: e?.message || 'Error', variant: 'destructive' });
    } finally {
      setBusyVote(null);
    }
  };

  if (!isLoaded || (isProfileLoading && activeTab === 'my_league')) return <LoadingScreen />;

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-24">
      <header className="mb-8 flex items-center gap-4">
        <Button variant="ghost" size="icon" className="rounded-full border border-white/5 bg-secondary/50" onClick={handleBack}>
          <ChevronLeft className="w-6 h-6" />
        </Button>
        <div>
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter text-white leading-none">
            {activeTab === 'menu' ? t.title : activeTab === 'season_archive' ? (language === 'ru' ? 'АРХИВ СЕЗОНОВ' : 'SEASON ARCHIVE') : activeTab === 'season_archive_detail' ? (language === 'ru' ? 'СЕЗОН ' : 'SEASON ') + (selectedArchiveSeason || '') : activeTab === 'cup' ? (language === 'ru' ? 'КУБОК ПИРАМИДЫ' : 'PYRAMID CUP') : contextLeagueId}
          </h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-black opacity-50 mt-1.5">{activeTab === 'menu' ? t.subtitle : activeTab === 'season_archive' ? (language === 'ru' ? 'ЗАВЕРШЁННЫЕ СЕЗОНЫ' : 'COMPLETED SEASONS') : activeTab === 'season_archive_detail' ? (language === 'ru' ? 'ИТОГОВЫЕ РЕЗУЛЬТАТЫ' : 'FINAL RESULTS') : activeTab === 'cup' ? (language === 'ru' ? 'СЕТКА ТУРНИРА' : 'TOURNAMENT BRACKET') : 'DIVISION ' + contextLevel + ' · GROUP ' + contextGroup}</p>
        </div>
      </header>

      {activeTab === 'menu' && (
        <div className="space-y-2">
          {t.menu.map(item => (
            <Card key={item.id} className="glass-card border-white/5 hover:bg-white/5 transition-all cursor-pointer group" onClick={() => {
              if ('href' in item && typeof item.href === 'string') { router.push(item.href); return; }
              setActiveTab(item.id as RankingTab);
              setNavLeague(null); setNavLevel(null); setNavGroup(null);
            }}>
              <CardContent className="p-4 flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <div className={cn("p-2.5 rounded-xl bg-secondary/50", item.color)}><item.icon className="w-5 h-5" /></div>
                  <div><h3 className="text-sm font-bold uppercase group-hover:text-white transition-colors">{item.label}</h3><p className="text-[10px] text-muted-foreground">{item.desc}</p></div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-all" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {activeTab === 'season_archive' && (
        <section className="space-y-3 animate-in fade-in duration-300" aria-label={language === 'ru' ? 'Архив сезонов' : 'Season archive'}>
          {isArchiveListLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : archiveListError ? (
            <Card className="glass-card border-amber-400/20"><CardContent className="p-5 text-center text-xs text-amber-200">{language === 'ru' ? 'Не удалось загрузить архив сезонов.' : 'Could not load season archives.'}</CardContent></Card>
          ) : visibleArchives.length === 0 ? (
            <Card className="glass-card border-white/5"><CardContent className="p-6 text-center"><Archive className="mx-auto mb-3 h-8 w-8 text-amber-400" /><p className="text-xs font-bold uppercase">{language === 'ru' ? 'Завершённых сезонов пока нет' : 'No completed seasons yet'}</p><p className="mt-2 text-[10px] text-muted-foreground">{language === 'ru' ? 'Архив появится после полной проверки итогов сезона.' : 'An archive appears after season results are fully verified.'}</p></CardContent></Card>
          ) : visibleArchives.map((archive: any) => (
            <Card key={archive.sourceSeason} className="glass-card border-white/5 hover:bg-white/5 transition-all cursor-pointer group" onClick={() => {
              setSelectedArchiveSeason(Number(archive.sourceSeason));
              setArchiveGroup('D1-G1');
              setActiveTab('season_archive_detail');
            }}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="rounded-xl bg-amber-400/10 p-2.5 text-amber-400"><CalendarDays className="h-5 w-5" /></div>
                  <div className="min-w-0"><h2 className="text-sm font-bold uppercase">Season {archive.sourceSeason}</h2><p className="text-[10px] text-muted-foreground">{archive.status === 'recovered' && <span className="font-bold text-amber-200">RECOVERED · INCOMPLETE · </span>}{archive.completionMode === 'late_engine_reconstruction' && <span className="font-bold text-amber-200">SIMULATED RECOVERY · </span>}{archive.finishedMatches} matches · 15 groups</p></div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {activeTab === 'season_archive_detail' && selectedArchive && (
        <section className="space-y-4 animate-in fade-in duration-300" aria-label={language === 'ru' ? 'Итоги сезона' : 'Season results'}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className={selectedArchive.status === 'recovered' || selectedArchive.completionMode === 'late_engine_reconstruction' ? 'bg-amber-500/10 text-amber-200' : 'bg-green-500/10 text-green-300'}>{selectedArchive.status === 'recovered' ? 'RECOVERED · INCOMPLETE' : selectedArchive.completionMode === 'late_engine_reconstruction' ? 'COMPLETED · ENGINE-RECONSTRUCTED' : 'COMPLETED'}</Badge>
            <span className="text-[9px] font-black uppercase tracking-wider text-muted-foreground">{selectedArchive.finishedMatches}/{selectedArchive.expectedMatches} {language === 'ru' ? 'матчей сохранено' : 'matches archived'}</span>
          </div>
          {selectedArchive.status === 'recovered' && <p className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-[10px] text-amber-100">Season 2 final standings are unavailable. The listed participants are the season starting roster, not final placements.</p>}
          {selectedArchive.completionMode === 'late_engine_reconstruction' && <p className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-[10px] text-amber-100">These missing fixtures were reconstructed with the shared match engine from saved team profiles. No historical roster snapshot existed; the results are explicitly identified as a late engine reconstruction.</p>}
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 15 }, (_, index) => {
              const level = index < 1 ? 1 : index < 3 ? 2 : index < 7 ? 3 : 4;
              const groupIndex = index === 0 ? 0 : index < 3 ? index - 1 : index < 7 ? index - 3 : index - 7;
              const key = 'D' + level + '-G' + (groupIndex + 1);
              return <Button key={key} size="sm" variant={archiveGroup === key ? 'default' : 'outline'} className={cn('h-9 border-white/10 px-1 text-[9px] font-black', archiveGroup === key ? 'hero-gradient border-none' : 'bg-secondary/20')} onClick={() => setArchiveGroup(key)}>{'D' + level + ' · G' + (groupIndex + 1)}</Button>;
            })}
          </div>
          <Card className="glass-card border-white/5 overflow-hidden">
            <CardContent className="p-3">
              <h2 className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-widest"><Trophy className="h-4 w-4 text-amber-400" />{archiveGroup}</h2>
              <div className="overflow-x-auto">
                <div className="min-w-[350px]">
                  {selectedArchive.status === 'recovered' ? <div className="grid grid-cols-[22px_1fr] gap-1 border-b border-white/10 px-2 py-2 text-[8px] font-black uppercase text-muted-foreground"><span>Rank</span><span>Starting participant</span></div> : <div className="grid grid-cols-[22px_1fr_28px_48px_32px_32px] gap-1 border-b border-white/10 px-2 py-2 text-[8px] font-black uppercase text-muted-foreground"><span>#</span><span>Team</span><span className="text-center">M</span><span className="text-center">W-D-L</span><span className="text-right">PTS</span><span className="text-right">+/-</span></div>}
                  {archiveGroupRows.map((row: any) => selectedArchive.status === 'recovered' ? <div key={row.id} className="grid grid-cols-[22px_1fr] gap-1 border-b border-white/5 px-2 py-2 text-[9px]"><span className="font-black text-muted-foreground">{row.rank}</span><span className="truncate font-bold">{row.name || row.id}</span></div> : <div key={row.id} className="grid grid-cols-[22px_1fr_28px_48px_32px_32px] gap-1 border-b border-white/5 px-2 py-2 text-[9px]"><span className="font-black">{row.rank}</span><span className="truncate font-bold">{row.name || row.id}</span><span className="text-center">{row.matchesPlayed}</span><span className="text-center">{row.wins}-{row.draws}-{row.losses}</span><span className="text-right">{row.points}</span><span className="text-right">{row.diff}</span></div>)}
                </div>
              </div>
            </CardContent>
          </Card>
          <div className="space-y-2">
            <h3 className="px-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground">{language === 'ru' ? 'Сохранённые матчи группы' : 'Archived group matches'}</h3>
            {isArchiveMatchesLoading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div> : archiveMatchesError ? <p className="rounded-xl border border-amber-400/20 p-4 text-center text-[10px] text-amber-200">{language === 'ru' ? 'Не удалось загрузить матчи архива.' : 'Could not load archived matches.'}</p> : archiveGroupMatches.length === 0 ? <p className="rounded-xl border border-white/5 p-4 text-center text-[10px] text-muted-foreground">{language === 'ru' ? 'В этой группе нет архивных матчей.' : 'No archived matches in this group.'}</p> : archiveGroupMatches.map((match: any) => <Card key={match.matchId || match.id} className="glass-card border-white/5"><CardContent className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 p-3 text-[9px]"><span className="truncate text-right font-bold">{match.homeName || match.homeId}</span><span className="rounded-md bg-secondary/40 px-2 py-1 font-mono font-black text-primary">{match.score?.home}:{match.score?.away}</span><span className="truncate font-bold">{match.awayName || match.awayId}</span><span className="col-span-3 text-center text-[8px] uppercase text-muted-foreground">{language === 'ru' ? 'Тур' : 'Round'} {match.tour || '—'}</span></CardContent></Card>)}
          </div>
        </section>
      )}

      {activeTab === 'season_archive_detail' && !selectedArchive && (
        <Card className="glass-card border-white/5"><CardContent className="p-5 text-center text-xs text-muted-foreground">{language === 'ru' ? 'Архив недоступен. Вернитесь к списку сезонов.' : 'Archive unavailable. Return to the season list.'}</CardContent></Card>
      )}

      {(activeTab === 'my_league' || navGroup) && (
        <div className="space-y-4 animate-in fade-in duration-500">
          <>
           <div className="flex items-center justify-end px-1">
             <div className="flex items-center gap-3 text-[7px] font-black uppercase tracking-widest">
                <div className="flex items-center gap-1 text-green-400">
                  <div className="w-2.5 h-2.5 rounded-full border border-green-400 flex items-center justify-center"><ArrowUp className="w-1.5 h-1.5" /></div>
                  {t.promotion}
                </div>
                <div className="flex items-center gap-1 text-red-400">
                  <div className="w-2.5 h-2.5 rounded-full border border-red-400 flex items-center justify-center"><X className="w-1.5 h-1.5" /></div>
                  {t.relegation}
                </div>
             </div>
           </div>

           {isTableLoading && !tableLoadTimedOut && !tableError ? (
             <div className="py-20 flex flex-col items-center justify-center space-y-4 opacity-70">
                <RefreshCw className="w-10 h-10 text-primary animate-spin" />
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">{t.loading}</p>
                <p className="text-[10px] text-muted-foreground">12 секунд максимум</p>
             </div>
           ) : (tableError || tableLoadTimedOut) ? (
             <div className="py-12 px-6 text-center border border-amber-400/20 bg-amber-400/5 rounded-3xl flex flex-col items-center gap-4">
               <ShieldAlert className="w-10 h-10 text-amber-400" />
               <p className="text-xs font-bold text-white">{t.loadFailed}</p>
               {tableError && (
                 <p className="text-[10px] text-muted-foreground break-words">{tableError.message}</p>
               )}
               <Button variant="outline" className="border-amber-400/30" onClick={retryTableLoad}>
                 <RefreshCw className="w-4 h-4 mr-2" />{t.retry}
               </Button>
             </div>
           ) : standings.length > 0 ? (
             <div className="space-y-1">
               <div className="grid grid-cols-[28px_1fr_25px_70px_35px] gap-1 px-3 py-2 text-[8px] font-black text-muted-foreground uppercase tracking-widest border-b border-white/5">
                 <span>#</span><span>{t.team}</span><span className="text-center">{t.m}</span><span className="text-center">{t.winLoss}</span><span className="text-right">{t.pts}</span>
               </div>
               {standings.map((entry: any, i: number) => {
                 const pos = i + 1;
                 const isMe = entry.id === user?.uid;
                 const clubLogo = logoMap.logos[entry.id] || entry.clubLogo;
                 
                 const isChampionZone = pos === 1;
                 const isRelegationZone = pos >= 7;

                 return (
                  <div key={entry.id} className={cn(
                    "grid grid-cols-[28px_1fr_25px_70px_35px] gap-1 items-center px-3 h-12 rounded-xl border transition-all", 
                    isMe ? "bg-primary/10 border-primary/30 shadow-inner" : 
                    isChampionZone ? "bg-green-500/5 border-green-500/20" :
                    isRelegationZone ? "bg-red-500/5 border-red-500/20" :
                    "bg-secondary/20 border-white/5"
                  )}>
                    <div className={cn(
                      "text-[10px] font-black italic",
                      isChampionZone ? "text-green-400" :
                      isRelegationZone ? "text-red-400" :
                      "text-muted-foreground"
                    )}>{pos}</div>
                    
                    <div className="truncate flex items-center gap-2 min-w-0">
                       <div className="w-6 h-6 shrink-0 flex items-center justify-center overflow-hidden bg-background/40 rounded-lg p-0.5 border border-white/5">
                         {clubLogo ? (
                           <img src={clubLogo} alt="" className="w-full h-full object-contain" />
                         ) : (
                           <img src="https://i.ibb.co/tpcQnnj1/1000078926-no-bg-preview-carve-photos.png" alt="Bot" className="w-full h-full object-contain opacity-40" />
                         )}
                       </div>
                      <span className={cn(
                        "text-[10px] font-bold uppercase truncate", 
                        isMe ? "text-primary font-black" : "text-white/90"
                      )}>
                        {entry.name}
                      </span>
                    </div>
                    
                    <div className="text-center font-mono text-[9px] text-muted-foreground">{entry.matchesPlayed || 0}</div>
                    <div className="text-center font-mono text-[9px] text-muted-foreground/60">{(entry.wins || 0)}-{(entry.draws || 0)}-{(entry.losses || 0)}</div>
                    <div className="text-right">
                      <span className="text-lg font-headline font-bold text-primary italic leading-none">{entry.points || 0}</span>
                    </div>
                  </div>
                 );
               })}
             </div>
           ) : (
             <div className="py-20 text-center opacity-30 border border-dashed border-white/10 rounded-3xl p-10 flex flex-col items-center gap-4">
                <ShieldAlert className="w-12 h-12 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="text-sm font-bold uppercase text-white">{t.noTable}</p>
                  <p className="text-[9px] uppercase font-black tracking-widest max-w-[200px] leading-relaxed">
                    {t.noTableDesc}
                  </p>
                </div>
             </div>
           )}
          </>
        </div>
      )}

      {activeTab === 'cup' && (
        <PyramidCupInline data={pyramidCup} loading={isPyramidCupLoading} round={cupRound} setRound={setCupRound} ru={language === 'ru'} />
      )}

      {activeTab === 'all_pyramids' && !navLeague && (
        <div className="grid grid-cols-1 gap-2">
          {LEAGUES.map(l => (
            <Card key={l.id} className="glass-card border-white/5 hover:bg-white/5 transition-all cursor-pointer group" onClick={() => setNavLeague(l.id)}>
              <CardContent className="p-4 text-center">
                <p className="text-sm font-headline font-bold text-white italic tracking-widest group-hover:text-primary transition-colors">{l.id}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {(activeTab === 'my_pyramid' || (activeTab === 'all_pyramids' && navLeague)) && !navLevel && (
        <div className="space-y-2">
          {Array.from({ length: MAX_LEVELS }, (_, i) => i + 1).map(lvl => (
            <Card key={lvl} className="glass-card border-white/5 hover:bg-white/5 transition-all cursor-pointer group" onClick={() => setNavLevel(lvl)}>
              <CardContent className="p-4 flex justify-between items-center">
                <span className="text-sm font-bold uppercase group-hover:text-white transition-colors">Дивизион {lvl}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[8px] bg-white/5 font-black uppercase">{getGroupsCountInLevel(lvl)} ГРУПП</Badge>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-all" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {navLevel && !navGroup && (
        <div className="grid grid-cols-4 gap-2 h-[50vh] overflow-y-auto pr-2 scrollbar-hide">
          {Array.from({ length: getGroupsCountInLevel(navLevel) }, (_, i) => i + 1).map(g => (
            <Button key={g} variant="outline" className="h-10 border-white/5 text-[10px] font-bold hover:bg-primary/10 hover:text-primary" onClick={() => setNavGroup(g)}>
              {g}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}


function PyramidCupInline({ data, loading, round, setRound, ru }: { data: any; loading: boolean; round: number; setRound: (round: number) => void; ru: boolean }) {
  const expectedMatches: Record<number, number> = { 1: 56, 2: 32, 3: 16, 4: 8, 5: 4, 6: 2, 7: 1 };
  const expectedSlots: Record<number, number> = { 1: 64, 2: 32, 3: 16, 4: 8, 5: 4, 6: 2, 7: 1 };
  const rounds = (data?.rounds || {}) as Record<string, any[]>;
  const matches: any[] = Array.isArray(rounds[`r${round}`]) ? rounds[`r${round}`] : [];
  const labels: Record<number, string> = ru
    ? { 1: 'Предварительный раунд', 2: 'Раунд 1/64', 3: 'Раунд 1/32', 4: 'Раунд 1/16', 5: 'Четвертьфинал', 6: 'Полуфинал', 7: 'ФИНАЛ BO3' }
    : { 1: 'Preliminary round', 2: 'Round of 64', 3: 'Round of 32', 4: 'Round of 16', 5: 'Quarterfinal', 6: 'Semifinal', 7: 'BO3 FINAL' };
  if (loading) return <div className="py-16 text-center text-xs text-muted-foreground">{ru ? 'Загрузка сетки…' : 'Loading bracket…'}</div>;
  if (!data) return <Card className="glass-card border-white/5"><CardContent className="p-6 text-center"><Trophy className="mx-auto mb-3 h-8 w-8 text-yellow-500" /><p className="text-xs font-bold uppercase">{ru ? 'Кубок ещё не создан' : 'Cup not generated yet'}</p><p className="mt-2 text-[10px] text-muted-foreground">{ru ? 'Сетка появится автоматически после запуска сезона.' : 'The bracket will appear automatically after the season starts.'}</p></CardContent></Card>;
  return <div className="space-y-3">
    <div className="grid grid-cols-7 gap-1">{Array.from({ length: 7 }, (_, i) => i + 1).map(r => <Button key={r} size="sm" variant={round === r ? 'default' : 'outline'} className={cn('h-9 min-w-0 px-0 text-[10px] font-black', round === r ? 'hero-gradient border-none' : 'border-white/5 bg-secondary/20')} onClick={() => setRound(r)}>{r}</Button>)}</div>
    <div className="flex items-center justify-between px-1"><div><p className="text-[11px] font-black uppercase tracking-widest">{labels[round]}</p><p className="text-[8px] text-muted-foreground">{round === 1 ? (ru ? '56 матчей · 8 команд проходят дальше' : '56 matches · 8 teams advance') : (ru ? `${expectedMatches[round]} матчей` : `${expectedMatches[round]} matches`)}</p></div><span className="rounded-md border border-white/10 bg-secondary/30 px-2 py-1 text-[7px] font-black uppercase text-muted-foreground">{data.status === 'completed' ? (ru ? 'ЗАВЕРШЁН' : 'COMPLETED') : (ru ? 'АКТИВЕН' : 'ACTIVE')}</span></div>
    <div className="space-y-2">{Array.from({ length: expectedSlots[round] }, (_, i) => matches[i] || ({ id: `placeholder-${round}-${i}`, status: 'pending', home: null, away: null })).map((m: any, i: number) => {
      const hasTeams = Boolean(m.home && m.away);
      const bye = m.status === 'bye' || (m.home && !m.away);
      return <Card key={m.id || i} className="glass-card border-white/5 overflow-hidden"><CardContent className="p-3">{bye ? <div className="flex items-center justify-between"><span className="truncate text-[10px] font-bold uppercase">{m.home?.name || 'TBD'}</span><span className="text-[8px] font-black text-yellow-500">BYE</span></div> : <div className="grid grid-cols-[1fr_48px_1fr] items-center gap-2"><p className="truncate text-right text-[10px] font-bold uppercase">{m.home?.name || 'TBD'}</p><span className="text-center text-xs font-black">{m.scoreA != null && m.scoreB != null ? `${m.scoreA}:${m.scoreB}` : (hasTeams ? 'VS' : '—')}</span><p className="truncate text-left text-[10px] font-bold uppercase">{m.away?.name || 'TBD'}</p></div>}{m.technicalDecision && <p className="mt-1 text-center text-[7px] uppercase text-amber-400">{ru ? 'Технический результат' : 'Technical result'}</p>}</CardContent></Card>;
    })}</div>
    <p className="text-center text-[8px] uppercase tracking-widest text-muted-foreground">{ru ? 'Сильнейшая команда играет AWAY · BO1 до финала' : 'Stronger team plays AWAY · BO1 until the final'}</p>
  </div>;
}
