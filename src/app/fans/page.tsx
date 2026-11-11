'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useUser } from '@/firebase';
import { useGameState } from '../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ChevronLeft, Heart, Bus, Ticket, Mic2, Users, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { foundationFanAction } from '@/app/actions/foundation-advanced';
import { LoadingScreen } from '@/components/game/LoadingScreen';

export default function FansPage() {
  const { user, isUserLoading } = useUser();
  const { language, isLoaded } = useGameState();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string|null>(null);
  const [fans, setFans] = useState({ mood:50, communitySize:1000, attendanceLast3:[] as number[], attendance:0 });
  if (isUserLoading || !isLoaded || !user) return <LoadingScreen />;
  const ru = language === 'ru';
  const actions = [
    ['fan_groups', ru?'Фан-группы':'Fan groups', ru?'Организовать группу из 1000 болельщиков':'Organize a 1,000-fan group', Users],
    ['free_entry', ru?'Свободный вход':'Free entry', ru?'Максимальная посещаемость ближайшего дома':'Guarantee maximum home attendance', Ticket],
    ['away_trip', ru?'Выезд болельщиков':'Away trip', ru?'Организовать поддержку на выезде':'Organize away support', Bus],
    ['autograph', ru?'Автограф-сессия':'Autograph session', ru?'Повысить настроение сообщества':'Increase fan mood', Mic2],
  ] as const;
  const run = async (action:string) => { if(busy)return; setBusy(action); try { const r=await foundationFanAction(await user.getIdToken(true), action as any); if ('error' in r) throw new Error(String(r.error || 'FAN_ACTION_FAILED')); if (!r.success || !('fans' in r)) throw new Error('FAN_ACTION_FAILED'); setFans(r.fans as any); toast({title:ru?'Акция выполнена':'Action completed'}); } catch(e:any){toast({title:e?.message||'Error',variant:'destructive'});} finally{setBusy(null);} };
  return <div className="max-w-md mx-auto px-4 pt-8 pb-32"><header className="mb-7 flex items-center gap-4"><Link href="/"><Button variant="ghost" size="icon"><ChevronLeft/></Button></Link><div><h1 className="text-2xl font-black uppercase flex items-center gap-2"><Heart className="text-pink-400"/>{ru?'ФАН-БАЗА':'FAN BASE'}</h1><p className="text-[10px] text-muted-foreground uppercase tracking-widest">{ru?'Настроение, размер сообщества и посещаемость':'Mood, community size and attendance'}</p></div></header>
    <Card className="glass-card mb-4"><CardContent className="p-5 space-y-4"><div className="flex justify-between"><span className="text-[10px] uppercase font-black">{ru?'Настроение':'Mood'}</span><b>{fans.mood}/100</b></div><Progress value={fans.mood}/><div className="flex justify-between"><span className="text-[10px] uppercase font-black">{ru?'Сообщество':'Community'}</span><b>{fans.communitySize.toLocaleString()}</b></div><div className="flex justify-between"><span className="text-[10px] uppercase font-black">{ru?'Последняя посещаемость':'Last attendance'}</span><b>{fans.attendance.toLocaleString()}</b></div></CardContent></Card>
    <div className="space-y-2">{actions.map(([id,title,desc,Icon])=><Card key={id} className="glass-card"><CardContent className="p-4 flex items-center gap-3"><Icon className="w-5 h-5 text-pink-400"/><div className="flex-1"><b className="text-xs uppercase">{title}</b><p className="text-[9px] text-muted-foreground">{desc}</p></div><Button size="sm" onClick={()=>run(id)} disabled={!!busy}>{busy===id?<Loader2 className="w-3 h-3 animate-spin"/>:'OK'}</Button></CardContent></Card>)}</div>
    <div className="mt-5"><h3 className="text-[10px] font-black uppercase mb-2">{ru?'Последние 3 официальных дома':'Last 3 official home games'}</h3><div className="grid grid-cols-3 gap-2">{fans.attendanceLast3.length?fans.attendanceLast3.map((x,i)=><div key={i} className="p-3 rounded-xl bg-secondary/30 text-center text-xs font-bold">{x.toLocaleString()}</div>):<div className="col-span-3 text-center text-[9px] text-muted-foreground p-5">—</div>}</div></div>
  </div>;
}
