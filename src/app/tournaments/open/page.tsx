'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useGameState } from '@/app/lib/store';
import { useUser } from '@/firebase';
import { getMoscowDateString } from '@/app/lib/time-utils';
import { ensureDailyTournamentsAction, getTournamentCatalogAction } from '@/app/actions/tournament-system';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Trophy, Users, Clock } from 'lucide-react';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { cn } from '@/lib/utils';

function formatMoscow(ms: number) { return new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }); }

export default function OpenTournamentsPage() {
  const { user, isUserLoading } = useUser();
  const { language, isLoaded } = useGameState();
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const today = getMoscowDateString();

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken(true);
      await ensureDailyTournamentsAction(token);
      const result = await getTournamentCatalogAction(token);
      if (result.success) setTournaments(result.tournaments || []);
    } finally { setLoading(false); }
  }, [user]);

  useEffect(() => { void load(); const timer = setInterval(() => void load(), 10_000); return () => clearInterval(timer); }, [load]);
  const list = useMemo(() => [...tournaments].filter((t: any) => t.status === 'registration' && Date.now() < Number(t.registrationCloseAt || t.startAt)).sort((a: any, b: any) => Number(a.startAt) - Number(b.startAt)), [tournaments]);

  if (isUserLoading || !isLoaded || !user || loading) return <LoadingScreen />;
  return <div className="max-w-md mx-auto px-4 pt-8 pb-28">
    <header className="mb-6 flex items-center gap-4"><Link href="/tournaments"><Button variant="ghost" size="icon" className="rounded-full"><ChevronLeft className="w-6 h-6" /></Button></Link><div><h1 className="text-2xl font-headline font-bold uppercase tracking-tighter">{language === 'ru' ? 'ОТКРЫТЫЕ ТУРНИРЫ' : 'OPEN TOURNAMENTS'}</h1><p className="text-muted-foreground text-[10px] uppercase tracking-widest">{today}</p></div></header>
    <div className="space-y-3">{list.map((t: any) => { const now=Date.now(); const registrationOpen=t.status==='registration' && now<Number(t.registrationCloseAt); const live=t.status!=='registration'&&t.status!=='completed'; const registered=Array.isArray(t.registeredIds)&&t.registeredIds.includes(user.uid); return <Link key={t.id} href={`/tournaments/${t.id}`}><Card className={cn('glass-card border-white/5 overflow-hidden hover:bg-white/5 transition-all',live&&'border-primary/30 bg-primary/5')}><CardContent className="p-4 flex items-center justify-between gap-3"><div className="flex items-center gap-3 min-w-0"><div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0"><Trophy className="w-6 h-6 text-primary" /></div><div className="min-w-0"><h3 className="text-sm font-bold uppercase truncate">{t.name}</h3><div className="flex items-center gap-3 mt-1 text-[9px] text-muted-foreground font-bold uppercase"><span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatMoscow(Number(t.startAt))}</span><span className="flex items-center gap-1"><Users className="w-3 h-3" />{t.participantCount||0}/{t.maxParticipants}</span></div></div></div><div className="flex flex-col items-end gap-1"><Badge className={cn('text-[7px] uppercase',live?'bg-green-600':registrationOpen?'bg-blue-600':'bg-secondary')}>{live?'LIVE':registrationOpen?'РЕГИСТРАЦИЯ':t.status==='completed'?'ЗАВЕРШЕН':'СТАРТ'}</Badge>{registered&&<span className="text-[7px] font-black text-primary">ВЫ УЧАСТВУЕТЕ</span>}<ChevronRight className="w-4 h-4 text-muted-foreground" /></div></CardContent></Card></Link>; })}</div>
    {!list.length&&<div className="py-20 text-center opacity-50"><Trophy className="w-10 h-10 mx-auto mb-3" /><p className="text-xs uppercase font-black">Нет открытых турниров</p><p className="text-[10px] mt-2">Турниры с закрытой регистрацией находятся в истории.</p></div>}
  </div>;
}
