'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { CalendarDays, ChevronLeft, Clock3, Medal, Swords, Trophy } from 'lucide-react';
import { useGameState } from '../lib/store';
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

export default function EventsPage() {
  const { isLoaded, language, allSeasonMatches, nextMatch, seasonNumber, seasonDay } = useGameState();
  const ru = language !== 'en';
  const now = Date.now();

  const events = useMemo(() => {
    const source = Array.isArray(allSeasonMatches) ? allSeasonMatches : [];
    return source
      .filter((match: any) => match && match.isFinished !== true && match.status !== 'FINISHED')
      .map((match: any) => ({ ...match, _time: toMillis(match.startTime ?? match.scheduledAt ?? match.date) }))
      .filter((match: any) => Number.isFinite(match._time))
      .sort((a: any, b: any) => a._time - b._time)
      .slice(0, 20);
  }, [allSeasonMatches]);

  if (!isLoaded) return <LoadingScreen />;

  const next = events[0] || (nextMatch ? { ...nextMatch, _time: toMillis((nextMatch as any).startTime) } : null);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 pb-24 space-y-5">
      <header className="flex items-center gap-3">
        <Link href="/"><Button variant="ghost" size="icon" aria-label={ru ? 'Назад' : 'Back'}><ChevronLeft /></Button></Link>
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2"><CalendarDays className="text-primary" />{ru ? 'СОБЫТИЯ' : 'EVENTS'}</h1>
          <p className="text-xs text-muted-foreground">{ru ? 'Календарь матчей и соревнований клуба' : 'Club match and competition calendar'}</p>
        </div>
      </header>

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-primary font-bold">{ru ? 'ТЕКУЩИЙ СЕЗОН' : 'CURRENT SEASON'}</p>
            <p className="text-xl font-black">{ru ? 'Сезон' : 'Season'} {seasonNumber || 1}</p>
            <p className="text-xs text-muted-foreground">{ru ? 'Игровой день' : 'Game day'} {seasonDay || 1}</p>
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
                <p className="text-xs text-muted-foreground mt-2">{Number.isFinite(next._time) ? new Date(next._time).toLocaleString(ru ? 'ru-RU' : 'en-GB') : (ru ? 'Время уточняется' : 'Time to be confirmed')}</p>
              </div>
              <Badge variant={next._time <= now ? 'default' : 'secondary'}>{next._time <= now ? (ru ? 'СЕЙЧАС' : 'LIVE') : (ru ? 'ОЖИДАЕТСЯ' : 'UPCOMING')}</Badge>
            </div>
          </CardContent></Card>
        ) : (
          <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">{ru ? 'Расписание следующих матчей пока не опубликовано.' : 'The next match schedule has not been published yet.'}</CardContent></Card>
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
            <Badge variant="outline">{match._time <= now ? (ru ? 'LIVE' : 'LIVE') : (ru ? 'СКОРО' : 'SOON')}</Badge>
          </CardContent></Card>
        )) : <p className="text-xs text-muted-foreground py-4 text-center">{ru ? 'Нет опубликованных предстоящих матчей.' : 'No upcoming fixtures have been published.'}</p>}
      </section>

      <div className="grid grid-cols-2 gap-3">
        <Link href="/tournaments"><Card className="h-full hover:border-primary/40 transition-colors"><CardContent className="p-4 flex items-center gap-3"><Trophy className="text-primary" /><span className="text-xs font-bold">{ru ? 'ТУРНИРЫ' : 'TOURNAMENTS'}</span></CardContent></Card></Link>
        <Link href="/rankings"><Card className="h-full hover:border-primary/40 transition-colors"><CardContent className="p-4 flex items-center gap-3"><Medal className="text-primary" /><span className="text-xs font-bold">{ru ? 'ТАБЛИЦЫ' : 'STANDINGS'}</span></CardContent></Card></Link>
      </div>
    </main>
  );
}
