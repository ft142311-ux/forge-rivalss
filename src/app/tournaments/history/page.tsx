'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useGameState } from '@/app/lib/store';
import { useUser } from '@/firebase';
import { getTournamentHistoryAction } from '@/app/actions/tournament-system';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronLeft, Trophy, Clock, Users } from 'lucide-react';
import { LoadingScreen } from '@/components/game/LoadingScreen';

export default function TournamentHistoryPage(){
  const {user,isUserLoading}=useUser();const {language,isLoaded}=useGameState();const [history,setHistory]=useState<any[]>([]);const [loading,setLoading]=useState(true);
  const load=useCallback(async()=>{if(!user)return;try{const token=await user.getIdToken(true);const result=await getTournamentHistoryAction(token);if(result.success)setHistory(result.tournaments||[]);}finally{setLoading(false);}},[user]);
  useEffect(()=>{void load();const timer=setInterval(()=>void load(),15000);return()=>clearInterval(timer);},[load]);
  const rows=useMemo(()=>[...history].sort((a:any,b:any)=>Number(b.finishedAt||b.registrationClosedAt||b.registrationCloseAt||b.startAt||0)-Number(a.finishedAt||a.registrationClosedAt||a.registrationCloseAt||a.startAt||0)),[history]);
  if(isUserLoading||!isLoaded||!user||loading)return <LoadingScreen/>;
  return <div className="max-w-md mx-auto px-4 pt-8 pb-28"><header className="mb-6 flex items-center gap-4"><Link href="/tournaments"><Button variant="ghost" size="icon" className="rounded-full"><ChevronLeft className="w-6 h-6"/></Button></Link><div><h1 className="text-2xl font-headline font-bold uppercase tracking-tighter">{language==='ru'?'ИСТОРИЯ ТУРНИРОВ':'TOURNAMENT HISTORY'}</h1><p className="text-muted-foreground text-[10px] uppercase tracking-widest">{rows.length} в истории</p></div></header><div className="space-y-2">{rows.map((t:any)=><Link href={`/tournaments/${t.id}`} key={t.id}><Card className="glass-card border-white/5 hover:bg-white/5"><CardContent className="p-4 flex items-center justify-between"><div className="flex items-center gap-3"><div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center"><Trophy className="w-6 h-6 text-primary"/></div><div><h3 className="text-sm font-bold uppercase">{t.name}</h3><p className="text-[8px] text-muted-foreground uppercase mt-1">{new Date(Number(t.startAt)).toLocaleDateString('ru-RU')} • {new Date(Number(t.startAt)).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'})}</p><p className="text-[8px] text-primary font-black uppercase mt-1">{t.status==='completed'?`Победитель: ${t.winnerName||'—'}`:t.status==='registration'?'Регистрация закрыта • формирование сетки':t.status==='groups'?(Date.now()<Number(t.startAt)?'Сетка сформирована • скоро старт':'Групповой этап'):'Плей-офф'}</p></div></div><div className="text-right text-[8px] font-bold text-muted-foreground"><div className="flex items-center gap-1"><Users className="w-3 h-3"/>{t.maxParticipants}</div><div className="flex items-center gap-1 mt-1"><Clock className="w-3 h-3"/>{t.type}</div></div></CardContent></Card></Link>)}</div>{!rows.length&&<div className="py-20 text-center opacity-40"><Trophy className="w-12 h-12 mx-auto mb-4"/><p className="text-xs font-black uppercase">История пока пуста</p></div>}</div>;
}
