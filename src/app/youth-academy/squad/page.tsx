'use client';

import { useState, useEffect } from 'react';
import { useGameState } from '../../lib/store';
import { listYouthPlayerOnMarketAction } from '@/app/actions/pro-market';
import { runWithFreshIdToken } from '@/lib/client-auth-action';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { 
  ChevronLeft, Star, ShoppingCart, Loader2, 
  ArrowUpCircle, Info, Award, Target, Eye, Map, 
  Zap, Sparkles, Brain, TrendingUp, Crosshair, Sword,
  ShieldCheck, Clock, Users, Activity, User, ShieldAlert, X, Gem, Timer, Activity as ActivityIcon
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Player } from '../../lib/moba-data';
import Link from 'next/link';
import { calculateLiveAge } from '@/app/lib/time-utils';
import { useToast } from '@/hooks/use-toast';
import { useUser, useAuth, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { renderStars, STAT_KEYS } from '@/components/game/transfer-stats';

const normTalent = (val: any) => {
  const n = Number(val);
  if (isNaN(n)) return 0;
  return n < 10 ? Math.round(n * 10) : Math.round(n);
};

export default function YouthSquadPage() {
  const { youthAcademyPlayers, language, isLoaded, promoteYouthPlayer, displayName } = useGameState();
  const { user, isUserLoading } = useUser();
  const auth = useAuth();
  const db = useFirestore();
  const { toast } = useToast();
  
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Use the canonical players_v14 profile for the active manager
  const userRef = useMemoFirebase(() => (user?.uid && db ? doc(db, 'players_v14', user.uid) : null), [db, user?.uid]);
  const { data: profile } = useDoc(userRef);

  const rolesRu: Record<string, string> = {
    'Carry': 'Керри',
    'Midlaner': 'Мидер',
    'Tank': 'Танк',
    'Jungler': 'Лес',
    'Support': 'Саппорт'
  };

  const t = {
    title: language === 'ru' ? "СОСТАВ АКАДЕМИИ" : "ACADEMY SQUAD",
    promote: language === 'ru' ? "В ОСНОВУ" : "PROMOTE",
    notReady: language === 'ru' ? "МОЛОД (НУЖНО 18)" : "TOO YOUNG (NEED 18)",
    years: language === 'ru' ? "лет" : "yrs",
    skills: language === 'ru' ? "НАВЫКИ" : "SKILLS",
    talents: language === 'ru' ? "ТАЛАНТЫ" : "TALENTS",
    salary: language === 'ru' ? "Зарплата" : "Salary",
    close: language === 'ru' ? "ВЕРНУТЬСЯ" : "BACK",
    owner: language === 'ru' ? "ВЛАДЕЛЕЦ" : "OWNER",
    sale: language === 'ru' ? "ПРОДАЖА" : "SALE",
    priceTitle: language === 'ru' ? "ЦЕНА ЮНИОРА" : "UNIT PRICE",
    talent: language === 'ru' ? "Талант" : "Talent",
    intel: language === 'ru' ? "ОБЩИЕ ДАННЫЕ" : "GENERAL INTEL",
    proStatsLabels: {
      lastHitting: language === 'ru' ? "Добив крипов" : "Last Hitting",
      mapAwareness: language === 'ru' ? "Контроль карты" : "Map Awareness",
      positioning: language === 'ru' ? "Позиционка" : "Positioning",
      reflexes: language === 'ru' ? "Рефлексы" : "Reflexes",
      manaManagement: language === 'ru' ? "Менеджмент маны" : "Mana Management",
      objectiveControl: language === 'ru' ? "Объекты" : "Objective Control",
      communication: language === 'ru' ? "Конмуникация" : "Communication",
      tiltResistance: language === 'ru' ? "Стрессоустойчивость" : "Tilt Resistance",
      versatility: language === 'ru' ? "Универсальность" : "Versatility",
      ganking: language === 'ru' ? "Ганкинг" : "Ganking",
    }
  };

  const icons: Record<string, any> = {
    lastHitting: Target, mapAwareness: Eye, positioning: Map, reflexes: Zap,
    manaManagement: Sparkles, objectiveControl: Sword, communication: Users,
    tiltResistance: Brain, versatility: TrendingUp, ganking: Crosshair,
  };

  const handlePromote = (playerId: string) => {
    promoteYouthPlayer(playerId);
    toast({ title: language === 'ru' ? "Игрок переведен!" : "Player Promoted!" });
    setSelectedPlayer(null);
  };

  const handleTransfer = async () => {
    if (!selectedPlayer || !user || !profile || isTransferring) return;
    setIsTransferring(true);
    try {
      if (!db) throw new Error('DATABASE_NOT_READY');
      const result = await runWithFreshIdToken(auth, user, (idToken) =>
        listYouthPlayerOnMarketAction(idToken, selectedPlayer.id)
      );
      if (!result.success) throw new Error(result.error || 'YOUTH_MARKET_LIST_FAILED');
      toast({ title: language === 'ru' ? "Выставлен на рынок" : "Listed on Market" });
      setSelectedPlayer(null);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Action Failed", description: e.message });
    } finally { setIsTransferring(false); }
  };

  if (!isLoaded || isUserLoading) return <LoadingScreen />;

  if (selectedPlayer) {
    const liveAge = calculateLiveAge(selectedPlayer.baseAge, selectedPlayer.hiredAt);
    const talentsValues = Object.values(selectedPlayer.proTalents || {}).map(v => normTalent(v));
    const maxTalentValue = Math.max(...talentsValues);

    return (
      <div className="fixed inset-0 z-[100] bg-background overflow-y-auto animate-in fade-in slide-in-from-right-4 duration-300">
        <div className="max-w-md mx-auto min-h-screen flex flex-col pb-10">
          <div className="p-4 pt-12 pb-8 bg-gradient-to-br from-primary/20 via-background to-accent/10 border-b border-white/5 flex flex-col items-center text-center gap-4 relative shrink-0">
            <Button variant="ghost" size="icon" className="absolute left-4 top-10 rounded-full bg-black/20" onClick={() => setSelectedPlayer(null)}><X className="w-5 h-5" /></Button>
            <div className="relative mx-auto w-24 h-24 mb-4">
              <div className={cn("w-full h-full rounded-2xl overflow-hidden border border-primary/50 shadow-2xl bg-secondary/50")}>
                <img src={selectedPlayer.image} alt={selectedPlayer.name} className="w-full h-full object-cover" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-lg bg-background border border-white/10 flex items-center justify-center shadow-xl"><span className="text-base">{selectedPlayer.country?.flag}</span></div>
            </div>
            <div className="space-y-1">
              <h2 className="text-2xl font-headline font-bold uppercase text-white tracking-tight leading-none">{selectedPlayer.name}</h2>
              <div className="flex items-center justify-center gap-2 mt-2">
                <Badge className="bg-primary text-primary-foreground text-[10px] font-black uppercase px-2 h-5">
                  {rolesRu[selectedPlayer.role] || selectedPlayer.role}
                </Badge>
              </div>
            </div>
          </div>

          <div className="p-4 space-y-8">
              <section className="grid grid-cols-2 gap-3">
                <div className="bg-secondary/20 p-3 rounded-xl border border-white/5 space-y-1">
                  <p className="text-[8px] font-black text-muted-foreground uppercase tracking-widest">{t.owner}</p>
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-3 h-3 text-primary" />
                    <p className="text-[10px] font-bold uppercase truncate">{profile?.clubName || displayName || "Manager"}</p>
                  </div>
                </div>
                <div className="bg-secondary/20 p-3 rounded-xl border border-white/5 space-y-1">
                  <p className="text-[8px] font-black text-muted-foreground uppercase tracking-widest">{t.sale}</p>
                  <div className="flex items-center gap-2">
                    <Timer className="w-3 h-3 text-accent animate-pulse" />
                    <p className="text-[10px] font-mono font-bold text-accent">{selectedPlayer.onTransferUntil ? new Date(selectedPlayer.onTransferUntil).toLocaleTimeString() : 'OFF MARKET'}</p>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-[9px] font-black text-primary uppercase tracking-[0.2em] mb-4 flex items-center gap-2 opacity-80 px-1">
                  <Info className="w-3.5 h-3.5" /> {t.intel}
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center justify-between p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[64px]">
                     <span className="text-[9px] font-bold text-muted-foreground uppercase">{language === 'ru' ? 'Возраст' : 'Age'}</span>
                     <span className="text-[10px] font-bold">{liveAge.display} {t.years}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[64px]">
                     <span className="text-[9px] font-bold text-muted-foreground uppercase whitespace-nowrap">{t.talent}</span>
                     <div className="flex items-center">
                       {renderStars(maxTalentValue)}
                     </div>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[64px]">
                     <span className="text-[9px] font-bold text-muted-foreground uppercase">{t.salary}</span>
                     <span className="text-[10px] font-bold text-primary">€{(selectedPlayer.salary || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[64px]">
                     <span className="text-[9px] font-bold text-muted-foreground uppercase">{language === 'ru' ? 'Роль' : 'Role'}</span>
                     <span className="text-[10px] font-bold uppercase">{rolesRu[selectedPlayer.role] || selectedPlayer.role}</span>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="text-[9px] font-black text-primary uppercase tracking-[0.2em] mb-4 flex items-center gap-2 opacity-80 px-1">
                  <ActivityIcon className="w-3.5 h-3.5" /> {t.skills}
                </h3>
                <div className="space-y-3">
                  {STAT_KEYS.map((key) => {
                    const Icon = icons[key] || Info;
                    const displayValue = Math.round(Number((selectedPlayer.proStats as any)[key]));
                    const talentLimit = normTalent((selectedPlayer.proTalents as any)[key] || 10);

                    return (
                      <div key={`skill-${key}`} className="space-y-2 p-3 rounded-xl border border-white/5 bg-secondary/10">
                        <div className="flex justify-between items-center px-0.5">
                          <div className="flex items-center gap-2">
                            <Icon className="w-4 h-4 text-muted-foreground/60" />
                            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{(t.proStatsLabels as any)[key]}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-mono font-bold text-white">{displayValue}</span>
                            <span className="text-[8px] text-muted-foreground/50">/</span>
                            <span className="text-[9px] font-mono font-bold text-primary/70">{talentLimit}</span>
                          </div>
                        </div>
                        <Progress value={(displayValue / talentLimit) * 100} max={100} className="h-1 rounded-full bg-secondary/40" />
                      </div>
                    );
                  })}
                </div>
              </section>

              <section>
                <h3 className="text-[9px] font-black text-accent uppercase tracking-[0.2em] mb-4 flex items-center gap-2 opacity-80 px-1">
                  <Zap className="w-3.5 h-3.5" /> {t.talents}
                </h3>
                <div className="space-y-2">
                  {STAT_KEYS.map((key) => {
                    const talentLimit = normTalent((selectedPlayer.proTalents as any)[key]);
                    const Icon = icons[key] || Info;
                    return (
                      <div key={`talent-${key}`} className="p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[48px] flex flex-col justify-center">
                        <div className="flex justify-between items-center px-0.5">
                          <div className="flex items-center gap-2">
                            <Icon className="w-4 h-4 text-accent/50" />
                            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{(t.proStatsLabels as any)[key]}</span>
                          </div>
                          <div className="flex items-center gap-3">
                             {renderStars(talentLimit)}
                             <span className="text-xs font-mono font-bold text-accent">{talentLimit}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="pt-4 border-t border-white/5">
                <h3 className="text-[9px] font-black text-yellow-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2 opacity-80 px-1">
                  <Gem className="w-3.5 h-3.5" /> {t.priceTitle}
                </h3>
                <div className="bg-secondary/30 p-4 rounded-xl border border-white/5">
                   <p className="text-[8px] font-black text-muted-foreground uppercase">{language === 'ru' ? 'ОЦЕНОЧНАЯ СТОИМОСТЬ' : 'ESTIMATED VALUE'}</p>
                   <p className="text-xl font-headline font-bold text-white italic">€ { (selectedPlayer.overallRating * 5000 + 25000).toLocaleString() }</p>
                </div>
              </section>

              <div className="pt-4 pb-12 flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" className="h-14 border-primary/20 bg-primary/10 text-primary font-bold uppercase text-[10px]" onClick={handleTransfer} disabled={isTransferring || (Boolean(selectedPlayer.onTransferUntil && new Date(selectedPlayer.onTransferUntil).getTime() > now))}>{isTransferring ? <Loader2 className="animate-spin mr-2" /> : <ShoppingCart className="w-4 h-4 mr-2" />} {language === 'ru' ? 'РЫНОК' : 'MARKET'}</Button>
                  <Button className="h-14 hero-gradient font-black uppercase text-[10px] shadow-xl" onClick={() => handlePromote(selectedPlayer.id)} disabled={liveAge.numeric < 18}>
                    <ArrowUpCircle className="w-4 h-4 mr-2" /> {liveAge.numeric < 18 ? t.notReady : (language === 'ru' ? 'В ОСНОВУ' : 'PROMOTE')}
                  </Button>
                </div>
                <Button variant="ghost" className="w-full h-12 text-[9px] font-black uppercase tracking-widest text-muted-foreground" onClick={() => setSelectedPlayer(null)}>{t.close}</Button>
              </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-6">
      <header className="mb-6 flex items-center gap-4">
        <Link href="/youth-academy"><Button variant="ghost" size="icon" className="rounded-full"><ChevronLeft className="w-6 h-6" /></Button></Link>
        <div><h1 className="text-2xl font-headline font-bold uppercase tracking-tighter text-primary">{t.title}</h1><p className="text-muted-foreground text-[10px] uppercase tracking-widest">{language === 'ru' ? 'Будущие активы клуба' : 'Future tactical assets'}</p></div>
      </header>
      <div className="space-y-1.5">
        {youthAcademyPlayers.length > 0 ? youthAcademyPlayers.map((player) => {
          const liveAge = calculateLiveAge(player.baseAge, player.hiredAt, player.birthDate);
          const onAuction = player.onTransferUntil && new Date(player.onTransferUntil).getTime() > now;
          const talentsValues = Object.values(player.proTalents || {}).map(v => normTalent(v));
          const maxTalent = Math.max(...talentsValues);
          return (
            <Card key={player.id} className={cn("glass-card border-white/5 hover:bg-white/5 cursor-pointer transition-all", onAuction && "border-yellow-500/30 bg-yellow-500/5")} onClick={() => setSelectedPlayer(player)}>
              <CardContent className="p-2 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-secondary/50 border border-white/10 shrink-0"><img src={player.image} alt={player.name} className="w-full h-full object-cover" /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[11px] font-bold truncate uppercase">{player.name}</h3>
                    <Badge variant="outline" className="text-[6px] h-3 px-1 border-white/10 uppercase opacity-60">
                      {rolesRu[player.role] || player.role}
                    </Badge>
                    {onAuction && <Badge className="bg-yellow-500 text-black text-[6px] h-3 px-1 font-black animate-pulse uppercase">Auction</Badge>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {renderStars(maxTalent)}
                    <p className="text-[7px] text-muted-foreground font-black uppercase tracking-widest">{language === 'ru' ? 'Возраст' : 'Age'}: {calculateLiveAge(player.baseAge, player.hiredAt, player.birthDate).display} {t.years}</p>
                  </div>
                </div>
                <div className="text-right border-l border-white/5 pl-2 min-w-[35px]">
                  <p className="text-[6px] font-black text-primary uppercase tracking-tighter leading-none mb-0.5">ОБЩ</p>
                  <span className="text-lg font-headline font-bold text-accent italic">{player.overallRating}</span>
                </div>
              </CardContent>
            </Card>
          );
        }) : (
          <div className="py-20 text-center opacity-30 flex flex-col items-center gap-4 border border-dashed border-white/10 rounded-2xl"><Users className="w-12 h-12" /><p className="text-xs font-black uppercase tracking-widest">{language === 'ru' ? 'Места в школе пусты' : 'Academy slots empty'}</p></div>
        )}
      </div>
    </div>
  );
}
