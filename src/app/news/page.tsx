'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useGameState } from '../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, Newspaper, Swords, Trophy, Radio } from 'lucide-react';

function dateValue(value: any): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === 'function') return value.toMillis();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function NewsPage() {
  const { language, matchHistory = [], trophies = [], clubName } = useGameState();
  const ru = language === 'ru';

  const feed = useMemo(() => {
    const matches = (matchHistory || []).map((match: any) => ({
      id: String(match.id || match.matchId || match.playedAt),
      kind: 'match' as const,
      title: ru ? 'Матч завершён' : 'Match completed',
      description: ru ? `Матч против ${match.awayName || match.opponentName || 'соперника'} завершён.` : `Match against ${match.awayName || match.opponentName || 'opponent'} has finished.`,
      score: match.seriesScore || match.score || (Number.isFinite(Number(match.scoreA)) && Number.isFinite(Number(match.scoreB)) ? `${match.scoreA}-${match.scoreB}` : ''),
      date: match.playedAt || match.resolvedAt,
      href: match.id ? `/match?id=${encodeURIComponent(String(match.id))}` : '/reports'
    }));
    const awards = (trophies || []).map((trophy: any) => ({
      id: String(trophy.id || trophy.name || trophy.date),
      kind: 'award' as const,
      title: ru ? 'Новое достижение клуба' : 'New club achievement',
      description: trophy.name || (ru ? 'Клуб получил награду.' : 'The club received an award.'),
      score: '',
      date: trophy.date,
      href: '/awards'
    }));
    return [...matches, ...awards]
      .sort((a, b) => dateValue(b.date) - dateValue(a.date))
      .slice(0, 50);
  }, [matchHistory, trophies, ru]);

  return (
    <main className="max-w-2xl mx-auto px-4 pt-8 pb-28 space-y-5">
      <header className="flex items-center gap-4">
        <Link href="/"><Button variant="ghost" size="icon" className="rounded-full"><ChevronLeft className="w-6 h-6" /></Button></Link>
        <div>
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tight flex items-center gap-2"><Newspaper className="w-6 h-6 text-primary" />{ru ? 'НОВОСТИ КЛУБА' : 'CLUB NEWS'}</h1>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{ru ? 'Лента официальных результатов и достижений' : 'Official results and achievements feed'}</p>
        </div>
      </header>

      <Card className="border-cyan-300/20 bg-gradient-to-br from-[#0c1b2b] via-[#0a1422] to-[#10102a]">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 p-3"><Radio className="w-6 h-6 text-cyan-200" /></div>
          <div><p className="text-sm font-black uppercase text-white">{clubName || (ru ? 'Ваш клуб' : 'Your club')}</p><p className="text-xs text-slate-400">{ru ? 'События формируются из подтверждённой истории клуба.' : 'Updates are generated from the club’s recorded history.'}</p></div>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="text-xs font-black uppercase tracking-widest">{ru ? 'ПОСЛЕДНИЕ СОБЫТИЯ' : 'LATEST UPDATES'}</h2><Badge variant="secondary">{feed.length}</Badge></div>
        {feed.length ? feed.map(item => (
          <Link href={item.href} key={item.kind + item.id}>
            <Card className="mb-2 hover:border-primary/40 transition-colors"><CardContent className="p-4 flex items-start gap-3">
              <div className="rounded-xl bg-secondary/60 p-2">{item.kind === 'award' ? <Trophy className="w-5 h-5 text-amber-400" /> : <Swords className="w-5 h-5 text-primary" />}</div>
              <div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><p className="font-bold text-sm">{item.title}</p>{item.score && <Badge variant="outline">{item.score}</Badge>}</div><p className="text-xs text-muted-foreground mt-1">{item.description}</p><p className="text-[10px] text-muted-foreground/70 mt-2">{item.date ? new Date(dateValue(item.date)).toLocaleString(ru ? 'ru-RU' : 'en-GB') : (ru ? 'Дата не указана' : 'Date unavailable')}</p></div>
            </CardContent></Card>
          </Link>
        )) : (
          <Card><CardContent className="p-8 text-center space-y-2"><Newspaper className="w-10 h-10 mx-auto text-muted-foreground/40" /><p className="font-bold">{ru ? 'Пока нет новостей клуба' : 'No club news yet'}</p><p className="text-xs text-muted-foreground">{ru ? 'Здесь появятся результаты матчей и награды после первых официальных событий.' : 'Match results and awards will appear here after the first official events.'}</p></CardContent></Card>
        )}
      </section>
    </main>
  );
}
