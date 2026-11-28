'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, Clock3, Medal, Swords, Trophy } from 'lucide-react';
import { useGameState } from '../lib/store';
import { useUser } from '@/firebase';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

function toMillis(value: any): number {
  if (value == null) return Number.NaN;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value === 'string') return new Date(value).getTime();
  const seconds = value?.seconds ?? value?._seconds;
  return typeof seconds === 'number' ? seconds * 1000 : Number.NaN;
}

function isFinished(match: any): boolean {
  const status = String(match?.status || '').trim().toLowerCase();
  return match?.isFinished === true || ['finished', 'completed', 'resolved', 'cancelled', 'canceled'].includes(status);
}

function isLive(match: any): boolean {
  const status = String(match?.status || '').trim().toLowerCase();
  return match?.isLive === true || ['live', 'in_progress', 'processing'].includes(status);
}

export default function EventsPage() {
  const { user, isUserLoading } = useUser();
  const {
    isLoaded, language, selectedLeagueId, leagueLevel, groupId, rank,
    seasonNumber, activeSeasonNumber, seasonDay,
  } = useGameState();
  const ru = language !== 'en';
  const [fixtures, setFixtures] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [matchesError, setMatchesError] = useState<string | null>(null);
  const effectiveSeason = Math.max(1, Number(activeSeasonNumber || seasonNumber || 1));

  // Match Center uses this authenticated public projection too, so the Events
  // page always reads the same canonical schedule as the match calendar.
  useEffect(() => {
    if (!isLoaded || isUserLoading || !user || !selectedLeagueId) {
      setFixtures([]);
      setIsLoading(false);
      setMatchesError(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setIsLoading(true);
    setMatchesError(null);

    (async () => {
      try {
        const token = await user.getIdToken();
        const response = await fetch('/api/league/matches', {
          method: 'POST',
          headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leagueId: selectedLeagueId,
            level: Number(leagueLevel),
            group: Number(groupId),
            season: effectiveSeason,
          }),
          cache: 'no-store',
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok || result?.success !== true) {
          throw new Error(result?.error || 'LEAGUE_MATCHES_UNAVAILABLE');
        }
        if (!cancelled) setFixtures(Array.isArray(result.matches) ? result.matches : []);
      } catch (error: any) {
        if (!cancelled && error?.name !== 'AbortError') {
          setFixtures([]);
          setMatchesError(String(error?.message || 'LEAGUE_MATCHES_UNAVAILABLE'));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isLoaded, isUserLoading, user, selectedLeagueId, leagueLevel, groupId, effectiveSeason]);

  const events = useMemo(() => {
    const managerRank = Number(rank);
    return fixtures
      .filter((match: any) => {
        if (!match || isFinished(match)) return false;
        const directIdentity = Boolean(user?.uid && (match.homeId === user.uid || match.awayId === user.uid));
        const sameLeagueSlot = match.leagueId === selectedLeagueId &&
          Number(match.level) === Number(leagueLevel) &&
          Number(match.groupId) === Number(groupId) &&
          Number(match.season) === effectiveSeason &&
          Number.isSafeInteger(managerRank) && managerRank > 0 &&
          (Number(match.homeRank) === managerRank || Number(match.awayRank) === managerRank);
        return directIdentity || sameLeagueSlot;
      })
      .map((match: any) => ({
        ...match,
        _time: toMillis(match.startTime ?? match.scheduledStartAt ?? match.scheduledAt ?? match.date),
      }))
      .filter((match: any) => Number.isFinite(match._time))
      .sort((a: any, b: any) => a._time - b._time)
      .slice(0, 20);
  }, [fixtures, user?.uid, selectedLeagueId, leagueLevel, groupId, effectiveSeason, rank]);

  if (!isLoaded || isUserLoading) return <LoadingScreen />;

  const next = events[0] || null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 pb-24 space-y-5">
      <header className="flex items-center gap-3">
        <Link href="/"><Button variant="ghost" size="icon" aria-label={ru ? 'Назад' : 'Back'}><ChevronLeft /></Button></Link>
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2"><CalendarDays className="text-primary" />{ru ? 'СОБЫТИЯ' : 'EVENTS'}</h1>
          <p className="text-xs text-muted-foreground">{ru ? 'Календарь матчей вашего клуба и соревнований' : 'Your club fixtures and competition calendar'}</p>
        </div>
      </header>

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-primary font-bold">{ru ? 'ТЕКУЩИЙ СЕЗОН' : 'CURRENT SEASON'}</p>
            <p className="text-xl font-black">{ru ? 'Сезон' : 'Season'} {effectiveSeason}</p>
            <p className="text-xs text-muted-foreground">{ru ? 'Игровой день' : 'Game day'} {Number.isFinite(Number(seasonDay)) ? seasonDay : 1}</p>
          </div>
          <Badge variant="outline">{ru ? 'Календарь' : 'Calendar'}</Badge>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold uppercase tracking-wide flex items-center gap-2"><Clock3 className="w-4 h-4 text-primary" />{ru ? 'БЛИЖАЙШЕЕ СОБЫТИЕ' : 'NEXT EVENT'}</h2>
          <Link href="/matches" className="text-xs text-primary">{ru ? 'Все матчи' : 'All matches'} →</Link>
        </div>
        {next ? (
          <Card><CardContent className="p-4">
            <div className="flex justify-between gap-3 items-start">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">{ru ? 'ТУР' : 'ROUND'} {next.tour ?? '—'}</p>
                <p className="font-bold mt-1">{next.homeName || next.homeClubName || (ru ? 'Хозяева' : 'Home')} <span className="text-primary">vs</span> {next.awayName || next.awayClubName || (ru ? 'Гости' : 'Away')}</p>
                <p className="text-xs text-muted-foreground mt-2">{new Date(next._time).toLocaleString(ru ? 'ru-RU' : 'en-GB')}</p>
              </div>
              <Badge variant={isLive(next) ? 'default' : 'secondary'}>{isLive(next) ? 'LIVE' : (ru ? 'ОЖИДАЕТСЯ' : 'UPCOMING')}</Badge>
            </div>
          </CardContent></Card>
        ) : (
          <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
            {isLoading ? (ru ? 'Загружаем расписание клуба…' : 'Loading your club schedule…') : matchesError ? (ru ? 'Не удалось загрузить расписание. Откройте матч-центр для повторной проверки.' : 'The schedule could not be loaded. Open Match Center to retry.') : (ru ? 'Расписание следующих матчей пока не опубликовано.' : 'The next match schedule has not been published yet.')}
          </CardContent></Card>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-bold uppercase tracking-wide flex items-center gap-2"><Swords className="w-4 h-4 text-primary" />{ru ? 'ПРЕДСТОЯЩИЕ МАТЧИ' : 'UPCOMING MATCHES'}</h2>
        {events.length ? events.map((match: any) => (
          <Card key={String(match.id || match.matchId || match._time)}><CardContent className="p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold truncate">{match.homeName || match.homeClubName || '—'} <span className="text-primary">vs</span> {match.awayName || match.awayClubName || '—'}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{ru ? 'Тур' : 'Round'} {match.tour ?? '—'} · {new Date(match._time).toLocaleString(ru ? 'ru-RU' : 'en-GB')}</p>
            </div>
            <Badge variant="outline">{isLive(match) ? 'LIVE' : (ru ? 'СКОРО' : 'SOON')}</Badge>
          </CardContent></Card>
        )) : !isLoading ? <p className="text-xs text-muted-foreground py-4 text-center">{ru ? 'Нет опубликованных предстоящих матчей.' : 'No upcoming fixtures have been published.'}</p> : null}
      </section>

      <div className="grid grid-cols-2 gap-3">
        <Link href="/tournaments"><Card className="h-full hover:border-primary/40 transition-colors"><CardContent className="p-4 flex items-center gap-3"><Trophy className="text-primary" /><span className="text-xs font-bold">{ru ? 'ТУРНИРЫ' : 'TOURNAMENTS'}</span></CardContent></Card></Link>
        <Link href="/rankings"><Card className="h-full hover:border-primary/40 transition-colors"><CardContent className="p-4 flex items-center gap-3"><Medal className="text-primary" /><span className="text-xs font-bold">{ru ? 'ТАБЛИЦЫ' : 'STANDINGS'}</span></CardContent></Card></Link>
      </div>
    </main>
  );
}
