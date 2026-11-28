'use client';

import Link from 'next/link';
import { Award, ChevronLeft, Medal, Trophy } from 'lucide-react';
import { useGameState } from '../lib/store';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function AwardsPage() {
  const { isLoaded, language, trophies, seasonNumber } = useGameState();
  const ru = language !== 'en';

  if (!isLoaded) return <LoadingScreen />;

  const records = Array.isArray(trophies) ? [...trophies].sort((a: any, b: any) => {
    const aDate = new Date(a.date || 0).getTime();
    const bDate = new Date(b.date || 0).getTime();
    return bDate - aDate;
  }) : [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 pb-24 space-y-5">
      <header className="flex items-center gap-3">
        <Link href="/"><Button variant="ghost" size="icon" aria-label={ru ? 'Назад' : 'Back'}><ChevronLeft /></Button></Link>
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2"><Trophy className="text-amber-400" />{ru ? 'НАГРАДЫ' : 'AWARDS'}</h1>
          <p className="text-xs text-muted-foreground">{ru ? 'История достижений вашего клуба' : 'Your club achievement record'}</p>
        </div>
      </header>

      <Card className="border-amber-400/20 bg-amber-400/5">
        <CardContent className="p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-amber-400 font-bold">{ru ? 'КЛУБНЫЙ ЗАЛ СЛАВЫ' : 'CLUB HALL OF FAME'}</p>
            <p className="text-2xl font-black">{records.length}</p>
            <p className="text-xs text-muted-foreground">{ru ? 'зафиксированных наград' : 'recorded trophies'}</p>
          </div>
          <Award className="w-10 h-10 text-amber-400/70" />
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold uppercase tracking-wide flex items-center gap-2"><Medal className="w-4 h-4 text-amber-400" />{ru ? 'АРХИВ НАГРАД' : 'TROPHY ARCHIVE'}</h2>
          <Badge variant="outline">{ru ? 'Сезон' : 'Season'} {seasonNumber || 1}</Badge>
        </div>
        {records.length ? records.map((item: any, index: number) => (
          <Card key={String(item.id || index)}><CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-xl bg-amber-400/10 p-3"><Trophy className="w-5 h-5 text-amber-400" /></div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-sm truncate">{item.name || (ru ? 'Награда клуба' : 'Club award')}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{item.type || (ru ? 'Достижение' : 'Achievement')} · {item.date || '—'}</p>
            </div>
            {Number(item.reward) > 0 && <Badge variant="secondary">+{Number(item.reward).toLocaleString()} CR</Badge>}
          </CardContent></Card>
        )) : (
          <Card><CardContent className="p-8 text-center space-y-2">
            <Trophy className="w-10 h-10 mx-auto text-muted-foreground/40" />
            <p className="font-bold">{ru ? 'Пока нет наград' : 'No awards yet'}</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">{ru ? 'Трофеи и достижения будут появляться здесь после официального завершения турниров и сезона.' : 'Trophies and achievements will appear here after tournaments and seasons are officially completed.'}</p>
          </CardContent></Card>
        )}
      </section>

      <Link href="/rankings?view=season_top"><Button className="w-full" variant="outline"><Medal className="w-4 h-4 mr-2" />{ru ? 'РЕЙТИНГ ЛУЧШИХ ИГРОКОВ СЕЗОНА' : 'SEASON PLAYER RANKINGS'}</Button></Link>
    </main>
  );
}
