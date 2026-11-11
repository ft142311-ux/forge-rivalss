'use client';

import { useGameState } from '../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  ChevronLeft, Settings, Users, ShieldCheck, 
  Loader2, Zap, Globe, 
  Construction, Trash2, Database,
  ChevronRight, AlertTriangle, Swords
} from 'lucide-react';
import Link from 'next/link';
import { useFirestore, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { collection, query, doc } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { TOTAL_GROUPS } from '../lib/leagues-data';
import { initializeLeagueWorldAction, totalNuclearResetAction, resolveDailyMatchesAction } from '../actions/admin-actions';
import { useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export default function SystemPage() {
  const { language, seasonNumber, selectedLeagueId } = useGameState();
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [showNuclearDialog, setShowNuclearDialog] = useState(false);
  const [purgeStats, setPurgeStats] = useState({ total: 0 });
  
  const playersQuery = useMemoFirebase(() => db ? query(collection(db, 'players_v14')) : null, [db]);
  const { data: players } = useCollection(playersQuery);

  const initStatusRef = useMemoFirebase(() => 
    (db && selectedLeagueId) ? doc(db, 'system_v1', `init_v140_S${seasonNumber}_L${selectedLeagueId}`) : null, 
    [db, selectedLeagueId, seasonNumber]
  );
  const { data: initStatus } = useDoc(initStatusRef);

  const stats = useMemo(() => {
    if (!players) return { total: 0, online: 0 };
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    const onlineCount = players.filter(p => (p.lastLoginDate ? new Date(p.lastLoginDate).getTime() : 0) > fiveMinutesAgo).length;
    return { total: players.length, online: onlineCount };
  }, [players]);

  const worldProgress = initStatus?.currentIndex || 0;
  const isWorldReady = worldProgress >= TOTAL_GROUPS;

  const t = {
    ru: { 
      title: "СИСТЕМА", subtitle: "Параметры и сетевая статистика (v140)",
      status: "Статус сети", online: "Игроков онлайн", registered: "Зарегистрировано",
      worldStatus: "Состояние мира", building: "Подготовка пирамиды v140...", ready: "Мир v140 готов к старту",
      forceBuild: "СОЗДАТЬ 8 ГРУПП",
      adminTitle: "ТЕРМИНАЛ АДМИНИСТРАТОРА",
      nuclear: "ЯДЕРНЫЙ СБРОС v140", nuclearDesc: "Удалить 2500 документов",
      resolve: "РАССЧИТАТЬ ТУР", resolveDesc: "Запустить расчет матчей (До 500 игр)",
      confirmNuclear: "ПОЛНОЕ УДАЛЕНИЕ", confirmNuclearDesc: "Все данные v140 будут стерты порциями. Нажмите несколько раз для полной очистки.",
      btnConfirm: "УНИЧТОЖИТЬ ПАЧКУ", btnCancel: "ОТМЕНА"
    },
    en: { 
      title: "SYSTEM", subtitle: "Parameters and network metrics (v140)",
      status: "Network Status", online: "Online Managers", registered: "Total Registered",
      worldStatus: "World Integrity", building: "Preparing Pyramid v140...", ready: "World v140 Ready for Launch",
      forceBuild: "BUILD 8 GROUPS",
      adminTitle: "ADMIN TERMINAL",
      nuclear: "NUCLEAR RESET v140", nuclearDesc: "Purge 2500 documents",
      resolve: "RESOLVE TOUR", resolveDesc: "Trigger match calculation (Up to 500 games)",
      confirmNuclear: "FULL DELETION", confirmNuclearDesc: "All v140 data will be wiped in batches. Click multiple times to clear all.",
      btnConfirm: "WIPE BATCH", btnCancel: "CANCEL"
    }
  }[language === 'ru' ? 'ru' : 'en'];

  const handleAction = async (action: string) => {
    if (isProcessing) return;
    if (!user) return;
    setIsProcessing(true);
    
    try {
      if (action === 'nuclear') {
        const res = await totalNuclearResetAction(await user.getIdToken());
        if (!res?.success) throw new Error("Purge Failed");
        setPurgeStats(prev => ({ total: prev.total + (res.deletedCount || 0) }));
        if (res.isComplete) {
          toast({ title: "System Purged", description: "All versions cleared." });
        } else {
          toast({ title: `Deleted ${res.deletedCount} docs`, description: "Continue purging until zero." });
        }
      }
      else if (action === 'forceBuild') {
        const res = await initializeLeagueWorldAction(await user.getIdToken(), selectedLeagueId || "ALPHA", seasonNumber);
        if ('status' in res && res.status === 'COMPLETE') {
          toast({ title: "Universe Complete", description: "511 groups initialized." });
        } else {
          toast({ title: `Batch Success`, description: `Progress: ${'currentIndex' in res ? res.currentIndex : 0} / 511` });
        }
      }
      else if (action === 'resolve') {
        const res = await resolveDailyMatchesAction(await user.getIdToken());
        toast({ title: "Resolve Complete", description: res?.progress });
      }
    } catch (e: any) {
      console.warn("[ADMIN ACTION ERROR]:", e.message);
      toast({ variant: "destructive", title: "Action Failed", description: e.message || "Unknown error" });
    } finally {
      setIsProcessing(false);
      setShowNuclearDialog(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-32">
      <header className="mb-8 flex items-center gap-4">
        <Link href="/"><Button variant="ghost" size="icon" className="rounded-full bg-secondary/50 border border-white/5"><ChevronLeft className="w-6 h-6" /></Button></Link>
        <div>
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter text-white flex items-center gap-2"><Settings className="w-6 h-6 text-primary" /> {t.title}</h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-black opacity-50">{t.subtitle}</p>
        </div>
      </header>

      <div className="space-y-8">
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-[10px] font-black uppercase tracking-widest text-accent">{t.worldStatus}</h2>
          </div>
          <Card className="glass-card border-white/5 bg-secondary/10 overflow-hidden">
            <CardContent className="p-4">
               <div className="flex items-center justify-between mb-3">
                 <div className="flex items-center gap-3">
                   <div className={cn("p-2 rounded-lg bg-secondary/50", isWorldReady ? "text-green-400" : "text-primary")}>
                     {isWorldReady ? <ShieldCheck className="w-5 h-5" /> : <Construction className="w-5 h-5" />}
                   </div>
                   <p className="text-xs font-bold uppercase text-white">{isWorldReady ? t.ready : t.building}</p>
                 </div>
                 <p className="text-sm font-headline font-bold text-primary">{worldProgress} / {TOTAL_GROUPS}</p>
               </div>
               <div className="h-1.5 w-full bg-background rounded-full overflow-hidden border border-white/5">
                  <div className="h-full bg-primary transition-all duration-500 shadow-[0_0_10px_rgba(var(--primary),0.5)]" style={{ width: `${(worldProgress / TOTAL_GROUPS) * 100}%` }} />
               </div>
               
               <Button 
                className="w-full h-14 font-black text-xs uppercase mt-4 shadow-xl hero-gradient tracking-widest"
                onClick={() => handleAction('forceBuild')} 
                disabled={isProcessing || isWorldReady}
               >
                  {isProcessing ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Zap className="w-5 h-5 mr-2" />} 
                  {t.forceBuild}
               </Button>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <h2 className="text-[10px] font-black uppercase tracking-widest text-red-500 px-1 flex items-center gap-2"><Database className="w-4 h-4" /> {t.adminTitle}</h2>
          <div className="grid grid-cols-1 gap-2">
            {/* RESOLVE BUTTON */}
            <Card className="glass-card border-primary/20 bg-primary/5 overflow-hidden group hover:border-primary/40 transition-all cursor-pointer" onClick={() => handleAction('resolve')}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-2.5 rounded-xl bg-primary/20 text-primary">
                    {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Swords className="w-5 h-5" />}
                  </div>
                  <div>
                    <h3 className="text-xs font-black uppercase text-white">{t.resolve}</h3>
                    <p className="text-[8px] text-muted-foreground uppercase">{t.resolveDesc}</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-primary/40" />
              </CardContent>
            </Card>

            {/* NUCLEAR RESET */}
            <Card className="glass-card border-red-500/20 bg-red-500/5 overflow-hidden group hover:border-red-500/40 transition-all cursor-pointer" onClick={() => setShowNuclearDialog(true)}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-2.5 rounded-xl bg-red-500/20 text-red-500">
                    {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
                  </div>
                  <div>
                    <h3 className="text-xs font-black uppercase text-white">{t.nuclear}</h3>
                    <p className="text-[8px] text-muted-foreground uppercase">{t.nuclearDesc} (Total: {purgeStats.total})</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-red-500/40" />
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-[10px] font-black uppercase tracking-widest text-accent px-1">{t.status}</h2>
          <div className="grid grid-cols-2 gap-3">
            <Card className="glass-card border-white/5 bg-secondary/10 p-4 text-center">
              <Users className="w-5 h-5 text-primary mx-auto mb-2" />
              <p className="text-[8px] font-black text-muted-foreground uppercase">{t.online}</p>
              <p className="text-xl font-headline font-bold text-white italic">{stats.online}</p>
            </Card>
            <Card className="glass-card border-white/5 bg-secondary/10 p-4 text-center">
              <ShieldCheck className="w-5 h-5 text-green-400 mx-auto mb-2" />
              <p className="text-[8px] font-black text-muted-foreground uppercase">{t.registered}</p>
              <p className="text-xl font-headline font-bold text-white italic">{stats.total}</p>
            </Card>
          </div>
        </section>
      </div>

      <Dialog open={showNuclearDialog} onOpenChange={setShowNuclearDialog}>
        <DialogContent className="max-w-xs bg-card border-white/10 p-6">
          <DialogHeader>
            <div className="mx-auto w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-4 border border-red-500/20"><AlertTriangle className="w-8 h-8 text-red-500 animate-pulse" /></div>
            <DialogTitle className="text-center font-headline font-bold uppercase text-red-500">{t.confirmNuclear}</DialogTitle>
            <DialogDescription className="text-center text-xs text-muted-foreground mt-2">{t.confirmNuclearDesc}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 mt-6">
            <Button variant="destructive" className="h-12 font-black uppercase text-[10px]" onClick={() => handleAction('nuclear')} disabled={isProcessing}>
              {isProcessing ? <Loader2 className="animate-spin" /> : t.btnConfirm}
            </Button>
            <Button variant="outline" className="h-12 font-bold uppercase text-[10px] border-white/10" onClick={() => setShowNuclearDialog(false)}>
              {t.btnCancel}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
