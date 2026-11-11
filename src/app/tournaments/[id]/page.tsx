'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useGameState } from '@/app/lib/store';
import { useUser } from '@/firebase';
import { getTournamentDetailsAction, registerForTournamentAction, unregisterFromTournamentAction } from '@/app/actions/tournament-system';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, Loader2, Trophy, Users, Clock, Swords } from 'lucide-react';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

function time(ms: number) { return new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }); }
const stageLabel: Record<string,string> = { groups:'Групповой этап', round_of_16:'1/8 финала', quarterfinal:'1/4 финала', semifinal:'1/2 финала', final:'Финал', completed:'Завершен' };

export default function TournamentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || '');
  const { user, isUserLoading } = useUser();
  const { language, isLoaded } = useGameState();
  const { toast } = useToast();
  const [state, setState] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user || !id) return;
    try { const token=await user.getIdToken(true); const result=await getTournamentDetailsAction(token,id); if(result.success) setState(result); } finally { setLoading(false); }
  }, [user,id]);
  useEffect(()=>{ void load(); const timer=setInterval(()=>void load(),5000); return ()=>clearInterval(timer); },[load]);

  const tournament=state?.tournament;
  const registered=!!tournament&&Array.isArray(tournament.registeredIds)&&tournament.registeredIds.includes(user?.uid);
  const registrationOpen=tournament?.status==='registration'&&Date.now()<Number(tournament.registrationCloseAt);
  const groups=useMemo(()=>[...(state?.groups||[])].sort((a:any,b:any)=>a.groupId.localeCompare(b.groupId)),[state]);
  const matches=useMemo(()=>[...(state?.matches||[])].sort((a:any,b:any)=>Number(a.scheduledAt)-Number(b.scheduledAt)),[state]);

  if(isUserLoading||!isLoaded||!user||loading)return <LoadingScreen/>;
  if(!tournament)return <div className="p-8 text-center">Турнир не найден</div>;

  async function toggleRegistration(){if(busy || !user)return;setBusy(true);try{const token=await user.getIdToken(true);const result=registered?await unregisterFromTournamentAction(token,id):await registerForTournamentAction(token,id);if(!result.success)throw new Error(result.error);await load();toast({title:registered?'Регистрация отменена':'Вы зарегистрированы'});}catch(e:any){toast({title:'Не удалось выполнить действие',description:e?.message,variant:'destructive'});}finally{setBusy(false);}}

  return <div className="max-w-md mx-auto px-4 pt-8 pb-28">
    <header className="mb-6 flex items-center gap-4"><Link href="/tournaments/open"><Button variant="ghost" size="icon" className="rounded-full"><ChevronLeft className="w-6 h-6" /></Button></Link><div className="min-w-0"><h1 className="text-xl font-headline font-bold uppercase truncate">{tournament.name}</h1><p className="text-muted-foreground text-[9px] uppercase tracking-widest">{stageLabel[tournament.stage]||tournament.stage}</p></div></header>
    <Card className="glass-card border-white/5 mb-4"><CardContent className="p-5"><div className="flex items-center justify-between mb-4"><div className="flex items-center gap-3"><Trophy className="w-7 h-7 text-primary"/><div><p className="text-[9px] text-muted-foreground uppercase">Приз</p><p className="font-bold">{tournament.prize}</p></div></div><Badge>{tournament.maxParticipants} УЧАСТНИКОВ</Badge></div><div className="grid grid-cols-3 gap-2 text-center text-[9px] font-bold uppercase"><div className="bg-secondary/30 rounded-lg p-2"><Clock className="w-3 h-3 mx-auto mb-1"/>{time(Number(tournament.startAt))}</div><div className="bg-secondary/30 rounded-lg p-2"><Users className="w-3 h-3 mx-auto mb-1"/>{tournament.participantCount}/{tournament.maxParticipants}</div><div className="bg-secondary/30 rounded-lg p-2"><Swords className="w-3 h-3 mx-auto mb-1"/>Bo2</div></div>{registrationOpen&&<Button className="w-full mt-4 hero-gradient font-black uppercase" onClick={toggleRegistration} disabled={busy}>{busy?<Loader2 className="w-4 h-4 animate-spin"/>:registered?'ОТМЕНИТЬ РЕГИСТРАЦИЮ':'УЧАСТВОВАТЬ'}</Button>}</CardContent></Card>

    {tournament.stage==='groups'&&groups.map((group:any)=><Card key={group.groupId} className="glass-card border-white/5 mb-3"><CardContent className="p-3"><h2 className="text-sm font-black uppercase mb-2">Группа {group.groupId}</h2><div className="grid grid-cols-[1fr_28px_28px_28px_38px] gap-1 text-[8px] font-bold uppercase text-muted-foreground border-b border-white/5 pb-1"><span>Команда</span><span>В</span><span>Н</span><span>П</span><span>О</span></div>{[...(group.teams||[])].sort((a:any,b:any)=>b.points-a.points||b.diff-a.diff||b.wins-a.wins).map((row:any,idx:number)=><div key={row.id} className={cn('grid grid-cols-[1fr_28px_28px_28px_38px] gap-1 py-2 text-[10px]',idx<2&&'bg-primary/5')}><span className="truncate font-semibold">{idx+1}. {row.name}</span><span>{row.wins}</span><span>{row.draws}</span><span>{row.losses}</span><span className="font-black">{row.points}</span></div>)}</CardContent></Card>)}

    <Card className="glass-card border-white/5 mt-3"><CardContent className="p-4"><h2 className="text-sm font-black uppercase mb-3">Все матчи турнира</h2>{(['groups','round_of_16','quarterfinal','semifinal','final'] as string[]).map((stage:string)=>{const stageMatches=matches.filter((m:any)=>m.stage===stage);if(!stageMatches.length)return null;return <div key={stage} className="mb-4 last:mb-0"><h3 className="text-[10px] font-black uppercase text-primary mb-2">{stageLabel[stage]||stage}</h3><div className="space-y-2">{stageMatches.map((m:any)=><div key={m.id} className="rounded-xl border border-white/5 bg-secondary/20 p-3 flex items-center justify-between gap-3"><div className="min-w-0 text-[10px] font-bold"><div className="truncate">{m.homeName||m.homeId}</div><div className="text-muted-foreground my-1">—</div><div className="truncate">{m.awayName||m.awayId}</div><div className="text-[8px] text-muted-foreground mt-2">{m.status==='finished'?'Завершён':m.status==='error'?'Ожидает повтора':'Запланирован'} • {time(Number(m.scheduledAt))}</div></div><div className="shrink-0 text-right font-mono font-black">{m.status==='finished'?<><div>{m.homeScore ?? m.result?.games?.reduce((sum:number,g:any)=>sum+Number(g.homeScore||0),0) ?? '—'}</div><div className="my-1 opacity-40">:</div><div>{m.awayScore ?? m.result?.games?.reduce((sum:number,g:any)=>sum+Number(g.awayScore||0),0) ?? '—'}</div></>:<span className="text-[9px] text-muted-foreground">—</span>}</div></div>)}</div></div>})}{tournament.winnerName&&<div className="mt-4 p-3 rounded-xl bg-primary/10 border border-primary/20 text-center"><p className="text-[8px] uppercase text-muted-foreground">Победитель</p><p className="font-headline font-bold text-primary uppercase">{tournament.winnerName}</p></div>}</CardContent></Card>
    <div className="mt-5 text-center text-[8px] text-muted-foreground uppercase font-bold tracking-widest">{state?.participants?.length||0} команд в турнирной базе</div>
  </div>;
}
