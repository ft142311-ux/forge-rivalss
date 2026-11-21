'use client';

/** Pyramid Cup terminal — all 120 league teams, single elimination. */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { useGameState } from '@/app/lib/store';
import { ChevronLeft, Trophy, Swords, Loader2, Medal, Lock, Crown, Users, CalendarClock, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import Link from 'next/link';
import { doc } from 'firebase/firestore';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { cn } from '@/lib/utils';

const ROUND_COUNT = 7;
const EXPECTED_MATCHES: Record<number, number> = { 1: 56, 2: 32, 3: 16, 4: 8, 5: 4, 6: 2, 7: 1 };
const EXPECTED_SLOTS: Record<number, number> = { 1: 64, 2: 32, 3: 16, 4: 8, 5: 4, 6: 2, 7: 1 };
const CUP_ROUND_DAYS = [2, 3, 4, 5, 6, 7, 8];

function formatCupKickoff(seasonStartValue: unknown, round: number, language: string) {
  const seasonStart = new Date(String(seasonStartValue || ''));
  if (!Number.isFinite(seasonStart.getTime())) return '07:00 MSK';
  const kickoff = new Date(seasonStart.getTime() + (CUP_ROUND_DAYS[round - 1] - 1) * 86400000);
  kickoff.setUTCHours(4, 0, 0, 0);
  return kickoff.toLocaleString(language === 'ru' ? 'ru-RU' : 'en-GB', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Moscow',
  }) + ' MSK';
}

export default function PyramidCupPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const db = useFirestore();
  const { language, isLoaded, activeSeasonNumber, isDataReady } = useGameState();
  const [activeRound, setActiveRound] = useState(1);
  const [showParticipants, setShowParticipants] = useState(false);

  const seasonConfigRef = useMemoFirebase(
    () => db ? doc(db, 'system_v1', 'season_config') : null,
    [db],
  );
  const { data: seasonConfig, isLoading: isSeasonConfigLoading } = useDoc(seasonConfigRef);
  const preparedPhase = ['GENERATING_NEXT', 'PREPARING_NEXT_SEASON', 'PREPARATION', 'PUBLISHED']
    .includes(String(seasonConfig?.phase || '').toUpperCase());
  const preparedSeasonNumber = Number(seasonConfig?.preparedSeasonNumber || 0);
  const cupSeasonNumber = seasonConfig?.preparedWorldReady === true &&
    preparedPhase && preparedSeasonNumber > Number(activeSeasonNumber || 0)
      ? preparedSeasonNumber
      : Number(activeSeasonNumber || 1);
  const cupDocId = `cup_s${cupSeasonNumber}_lALPHA`;
  const cupRef = useMemoFirebase(() => db ? doc(db, 'cup_pyramid_v1', cupDocId) : null, [db, cupDocId]);
  const { data: cupData, isLoading: isCupLoading } = useDoc(cupRef);

  useEffect(() => {
    const currentRound = Number(cupData?.currentRound);
    if (Number.isInteger(currentRound) && currentRound >= 1 && currentRound <= ROUND_COUNT) {
      setActiveRound(currentRound);
    }
  }, [cupData?.id, cupData?.currentRound]);

  useEffect(() => {
    if (!isUserLoading && !user) router.push('/auth/login');
  }, [user, isUserLoading, router]);

  if (isUserLoading || !isLoaded || !user || !isDataReady) return <LoadingScreen />;

  const ru = language === 'ru';
  const title = ru ? 'КУБОК ПИРАМИДЫ' : 'PYRAMID CUP';
  const subtitle = ru ? 'Все 120 участников · олимпийская система' : 'All 120 teams · single elimination';

  if (!db) return (
    <div className="max-w-md mx-auto px-4 pt-8 text-center">
      <header className="mb-8 flex items-center gap-4 text-left">
        <Link href="/"><Button variant="ghost" size="icon" className="rounded-full border border-white/5 bg-secondary/50"><ChevronLeft className="w-6 h-6" /></Button></Link>
        <h1 className="text-2xl font-headline font-bold uppercase">{title}</h1>
      </header>
      <div className="py-20 opacity-30 flex flex-col items-center gap-6"><Lock className="w-16 h-16" /><p className="text-xs font-black uppercase tracking-widest">{ru ? 'ОФЛАЙН' : 'OFFLINE'}</p></div>
    </div>
  );

  const rounds = (cupData?.rounds || {}) as Record<string, any[]>;
  const matches = Array.isArray(rounds[`r${activeRound}`]) ? rounds[`r${activeRound}`] : [];
  const participants = Array.isArray(cupData?.participants) ? [...cupData.participants].sort((a: any, b: any) => Number(a.seed) - Number(b.seed)) : [];
  const roundMatchCount = matches.filter((match: any) => match?.home && match?.away).length;
  const roundFinishedCount = matches.filter((match: any) => match?.home && match?.away && match.status === 'finished').length;
  const roundByeCount = matches.filter((match: any) => match?.status === 'bye').length;
  const roundName = activeRound === 1
    ? (ru ? 'ПРЕДВАРИТЕЛЬНЫЙ РАУНД' : 'PRELIMINARY ROUND')
    : activeRound === 7
    ? (ru ? 'ФИНАЛ BO3' : 'BO3 FINAL')
    : activeRound === 6
      ? (ru ? 'ПОЛУФИНАЛ' : 'SEMIFINAL')
      : activeRound === 5
        ? (ru ? '1/4 ФИНАЛА' : 'QUARTERFINAL')
        : `${ru ? 'РАУНД' : 'ROUND'} ${activeRound}`;

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-32">
      <header className="mb-6 flex items-center gap-4">
        <Link href="/"><Button variant="ghost" size="icon" className="rounded-full border border-white/5 bg-secondary/50"><ChevronLeft className="w-6 h-6" /></Button></Link>
        <div className="min-w-0">
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter text-white flex items-center gap-2 leading-none"><Trophy className="w-6 h-6 text-yellow-500" />{title}</h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest mt-1 truncate">{subtitle} · S{cupSeasonNumber}</p>
        </div>
      </header>

      {isCupLoading || isSeasonConfigLoading ? <div className="py-20 text-center opacity-50"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></div> : !cupData ? (
        <div className="py-20 text-center animate-in fade-in duration-700 flex flex-col items-center"><Medal className="w-12 h-12 text-orange-500 mb-4 opacity-50" /><h2 className="text-lg font-headline font-bold uppercase text-white mb-2">{ru ? 'СЕТКА ФОРМИРУЕТСЯ' : 'BRACKET PENDING'}</h2><p className="text-[10px] text-muted-foreground uppercase px-10 italic">{ru ? 'Кубок формируется при подготовке сезона и будет доступен до стартового свистка.' : 'The cup is generated during season preparation and will be available before kickoff.'}</p></div>
      ) : (
        <>
          {cupData.status === 'completed' && cupData.winnerId && (
            <Card className="glass-card border-yellow-500/30 mb-5 bg-yellow-500/5">
              <CardContent className="p-4 text-center">
                <Crown className="w-8 h-8 mx-auto mb-2 text-yellow-400" />
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-yellow-400">{ru ? 'ЧЕМПИОН КУБКА ПИРАМИДЫ' : 'PYRAMID CUP CHAMPION'}</p>
                <p className="mt-1 text-lg font-headline font-black uppercase text-white">{cupData.winnerName || cupData.winnerId}</p>
                {cupData.finalistId && (
                  <p className="mt-2 text-[9px] font-bold uppercase text-muted-foreground">
                    {ru ? 'ФИНАЛИСТ' : 'RUNNER-UP'} · {cupData.finalistName || cupData.finalistId}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
          <div className="grid grid-cols-7 gap-1.5 mb-5">
            {Array.from({ length: ROUND_COUNT }, (_, i) => i + 1).map(round => (
              <Button key={round} variant={activeRound === round ? 'default' : 'outline'} size="sm" onClick={() => setActiveRound(round)} className={cn('h-9 min-w-0 px-0 rounded-lg font-black text-[9px] uppercase', activeRound === round ? 'hero-gradient border-none' : 'bg-secondary/20 border-white/5')}>
                {round}
              </Button>
            ))}
          </div>

          <Card className="glass-card border-white/5 mb-4"><CardContent className="p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0"><p className="text-[11px] font-black uppercase tracking-widest text-white">{roundName}</p><p className="text-[8px] text-muted-foreground uppercase">{roundFinishedCount}/{roundMatchCount || EXPECTED_MATCHES[activeRound]} {ru ? 'матчей завершено' : 'matches completed'}{roundByeCount ? ` · ${roundByeCount} BYE` : ''}</p></div>
              <Badge status={cupData.status} ru={ru} />
            </div>
            <div className="mt-3 flex items-center gap-2 text-[9px] font-bold uppercase text-primary"><CalendarClock className="w-3.5 h-3.5 shrink-0" />{formatCupKickoff(cupData.seasonStart, activeRound, language)}</div>
          </CardContent></Card>

          <Button variant="outline" className="w-full mb-4 border-white/10 bg-secondary/20 text-[9px] font-black uppercase" onClick={() => setShowParticipants(value => !value)}>
            <Users className="w-4 h-4 mr-2" />{showParticipants ? (ru ? 'СКРЫТЬ УЧАСТНИКОВ' : 'HIDE PARTICIPANTS') : (ru ? `ВСЕ УЧАСТНИКИ · ${participants.length}/120` : `ALL PARTICIPANTS · ${participants.length}/120`)}
          </Button>
          {showParticipants && <Card className="glass-card border-white/5 mb-4"><CardContent className="p-2">
            <div className="grid grid-cols-[32px_1fr_42px_42px_42px] gap-1 px-2 pb-2 text-[7px] font-black uppercase text-muted-foreground"><span>#</span><span>{ru ? 'КОМАНДА' : 'CLUB'}</span><span>D</span><span>G</span><span>R</span></div>
            <div className="max-h-[420px] overflow-y-auto space-y-1">{participants.map((team: any) => <div key={team.id} className={cn('grid grid-cols-[32px_1fr_42px_42px_42px] gap-1 items-center rounded-md px-2 py-1.5 text-[9px]', team.id === user.uid && 'bg-primary/10 text-primary')}><span className="font-mono text-muted-foreground">{team.seed}</span><span className="truncate font-bold">{team.name}</span><span>D{team.level}</span><span>G{team.group}</span><span>R{team.rank}</span></div>)}</div>
          </CardContent></Card>}

          <div className="space-y-2">
            {Array.from({ length: EXPECTED_SLOTS[activeRound] }, (_, idx) => matches[idx] || ({ id: `placeholder-${activeRound}-${idx}`, status: 'pending', home: null, away: null })).map((m: any, idx: number) => {
              const isBye = m.status === 'bye' || Boolean(m.home && !m.away);
              const isMyMatch = m.home?.id === user.uid || m.away?.id === user.uid;
              const winner = m.winnerId;
              return (
                <Card key={m.id || idx} className={cn('glass-card border-white/5 overflow-hidden', isMyMatch && 'border-primary/50 bg-primary/10 shadow-[0_0_15px_rgba(var(--primary),0.1)]')}>
                  <CardContent className="p-3">
                    {isBye ? (
                      <div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-[10px] font-bold uppercase truncate">{m.home?.name || 'TBD'}</p><p className="text-[8px] text-muted-foreground uppercase">{ru ? 'ПРОХОД ДАЛЬШЕ · BYE' : 'ADVANCES · BYE'}</p></div><Crown className="w-4 h-4 text-yellow-500 shrink-0" /></div>
                    ) : (
                      <div className="grid grid-cols-[1fr_46px_1fr] items-center gap-1"><div className="text-right truncate"><p className={cn('text-[10px] font-bold uppercase truncate', m.home?.id === user.uid ? 'text-primary' : winner === m.home?.id ? 'text-white' : 'text-muted-foreground')}>{m.home?.name || 'TBD'}</p></div><div className="flex justify-center"><span className="text-sm font-headline font-black">{m.scoreA != null ? `${m.scoreA}:${m.scoreB}` : (m.home && m.away ? <Swords className="w-3.5 h-3.5 text-accent/40" /> : '—')}</span></div><div className="text-left truncate"><p className={cn('text-[10px] font-bold uppercase truncate', m.away?.id === user.uid ? 'text-primary' : winner === m.away?.id ? 'text-white' : 'text-muted-foreground')}>{m.away?.name || 'TBD'}</p></div></div>
                    )}
                    {m.technicalDecision && <p className="mt-2 text-center text-[7px] font-black uppercase text-amber-400">{ru ? 'ТЕХНИЧЕСКИЙ РЕЗУЛЬТАТ' : 'TECHNICAL RESULT'}</p>}
                    {m.status === 'finished' && m.matchId && <Link href={`/match?id=${encodeURIComponent(m.matchId)}`} className="mt-3 block"><Button variant="outline" size="sm" className="h-8 w-full border-white/10 bg-black/20 text-[8px] font-black uppercase"><FileText className="w-3.5 h-3.5 mr-2" />{ru ? 'ОТЧЁТ БОЯ' : 'MATCH REPORT'}</Button></Link>}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function Badge({ status, ru }: { status?: string; ru: boolean }) {
  const label = status === 'completed' ? (ru ? 'ЗАВЕРШЁН' : 'COMPLETED') : (ru ? 'АКТИВЕН' : 'ACTIVE');
  return <span className="rounded-md border border-white/10 bg-secondary/30 px-2 py-1 text-[7px] font-black uppercase tracking-widest text-muted-foreground">{label}</span>;
}
