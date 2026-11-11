'use client';

import { useState, useEffect, useRef, memo, useMemo, useCallback } from 'react';
import { useGameState } from '@/app/lib/store';
import { placeYouthMarketBidAction } from '@/app/actions/pro-market';
import { runWithFreshIdToken } from '@/lib/client-auth-action';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { 
  ChevronLeft, Loader2, Gavel, ShieldCheck, 
  Timer, Star, ShoppingCart, X, Check, Search, Info, Users,
  ChevronLeft as ChevronLeftIcon, ChevronRight as ChevronRightIcon,
  ChevronsLeft, ChevronsRight, Target, Eye, Map, Zap, Sparkles, Sword,
  Brain, TrendingUp, Crosshair, User, ShieldAlert, HeartPulse, Activity, Gem, Lock
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';
import { useUser, useAuth, useFirestore, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { collection, query, doc, where } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { calculateLiveAge, getMoscowTime } from '@/app/lib/time-utils';
import { renderStars, STAT_KEYS } from '@/components/game/transfer-stats';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const ITEMS_PER_PAGE = 10;

const normTalent = (val: any) => {
  const n = Number(val);
  if (isNaN(n)) return 0;
  return n < 10 ? Math.round(n * 10) : Math.round(n);
};

const YouthTransferCard = memo(({ 
  agent, 
  user, 
  profile, 
  onBid, 
  now,
  language 
}: { 
  agent: any, 
  user: any, 
  profile: any, 
  onBid: (agent: any, amount: number) => Promise<void>,
  now: number,
  language: string
}) => {
  const [showBidModal, setShowBidModal] = useState(false);
  const [showDossier, setShowDossier] = useState(false);
  const [bidPercent, setBidPercent] = useState(5);
  const [isProcessing, setIsProcessing] = useState(false);
  const { displayName } = useGameState();

  const isLeading = agent.highestBidderId === user?.uid;
  const isOwner = agent.sellerId === user?.uid;
  const nextBidValue = Math.ceil(agent.currentBid * (1 + bidPercent / 100));
  const liveAge = calculateLiveAge(agent.heroData.baseAge, agent.heroData.hiredAt);
  const talentsValues = Object.values(agent.heroData.proTalents || {}).map(v => normTalent(v));
  const maxTalentValue = Math.max(...talentsValues);

  const rolesRu: Record<string, string> = {
    'Carry': 'Керри', 'Midlaner': 'Мидер', 'Tank': 'Танк', 'Jungler': 'Лес', 'Support': 'Саппорт'
  };

  const proStatsLabels: Record<string, string> = {
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
  };

  const icons: Record<string, any> = {
    lastHitting: Target, mapAwareness: Eye, positioning: Map, reflexes: Zap,
    manaManagement: Sparkles, objectiveControl: Sword, communication: Users,
    tiltResistance: Brain, versatility: TrendingUp, ganking: Crosshair,
  };

  const getCountdown = (expiryIso: string) => {
    const expiry = new Date(expiryIso).getTime();
    const diff = expiry - now;
    if (diff <= 0) return "00:00:00";
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const t = {
    owner: language === 'ru' ? "ВЛАДЕЛЕЦ" : "OWNER",
    sale: language === 'ru' ? "ПРОДАЖА" : "SALE",
    priceTitle: language === 'ru' ? "ЦЕНА ЮНИОРА" : "UNIT PRICE",
    age: language === 'ru' ? "Возраст" : "Age",
    yrs: language === 'ru' ? "лет" : "yrs",
    skills: language === 'ru' ? "НАВЫКИ" : "SKILLS",
    talents: language === 'ru' ? "ТАЛАНТЫ" : "TALENTS",
    talent: language === 'ru' ? "Талант" : "Talent",
    salary: language === 'ru' ? "Зарплата" : "Salary"
  };

  return (
    <>
      <Card 
        onClick={() => setShowDossier(true)}
        className={cn(
        "glass-card border-white/5 overflow-hidden transition-all cursor-pointer active:scale-[0.98]", 
        isLeading && "border-green-500/40 bg-green-500/5",
        isOwner && "border-blue-500/40 bg-blue-500/5"
      )}>
        <CardContent className="p-2.5">
          <div className="flex items-center justify-between mb-1.5">
             <div className="flex items-center gap-1 text-accent">
               <Timer className="w-2.5 h-2.5 animate-pulse" />
               <span className="text-[8px] font-mono font-bold tracking-tighter">{getCountdown(agent.expiresAt)}</span>
             </div>
             {isOwner && <Badge className="bg-blue-600 text-white text-[6px] font-black uppercase px-1.5 h-3 border-none">{language === 'ru' ? 'ВАШ ЮНИОР' : 'YOUR LOT'}</Badge>}
          </div>

          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <div className="w-[72px] h-[72px] rounded-lg overflow-hidden bg-secondary/30 border border-white/10 relative shadow-lg">
                <img src={agent.heroData?.image} alt="" className="w-full h-full object-cover" />
                <div className="absolute -bottom-1 -right-1 bg-background rounded-sm p-0.5 border border-white/10 shadow-xl z-10 flex items-center justify-center">
                  <span className="text-[8px] leading-none">{agent.heroData.country?.flag}</span>
                </div>
              </div>
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex flex-col gap-0.5 mb-1">
                <h3 className="text-[11px] font-bold uppercase truncate text-white tracking-tight leading-none">{agent.heroData?.name}</h3>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[6px] h-3 py-0 border-white/10 uppercase font-black text-accent/80">
                    {rolesRu[agent.heroData.role] || agent.heroData.role}
                  </Badge>
                  <span className="text-[7px] font-black text-muted-foreground uppercase tracking-widest">{t.age}: {liveAge.display}</span>
                </div>
              </div>
              
              <div className="flex items-center min-h-[32px]">
                {renderStars(maxTalentValue)}
              </div>
            </div>
            
            <div className="text-right flex flex-col items-end shrink-0 justify-center pr-1">
              <p className="text-[6px] font-black text-accent uppercase tracking-widest leading-none mb-0.5">ОБЩ</p>
              <p className="text-xl font-headline font-bold text-accent italic leading-none">{agent.heroData?.overallRating}</p>
            </div>
          </div>
          
          <div className="flex items-center justify-between gap-2 pt-2 mt-1.5 border-t border-white/5">
            <div className="flex flex-col flex-1 min-w-0">
              <div className="flex items-center justify-between pr-2">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-headline font-bold text-white tracking-tight leading-none">€{agent.currentBid?.toLocaleString()}</p>
                </div>
                <div className="text-right flex flex-col justify-center">
                   <p className="text-[11px] font-headline font-bold text-primary uppercase truncate max-w-[100px] leading-none">
                     {agent.highestBidderName || (language === 'ru' ? 'НЕТ СТАВОК' : 'NO BIDS')}
                   </p>
                </div>
              </div>
            </div>
            <Button 
              className={cn(
                "h-8 font-black text-[7px] px-3 rounded-lg uppercase tracking-widest transition-all shrink-0", 
                isLeading ? "bg-green-600/20 text-green-400 border border-green-500/30" : 
                (isOwner ? "bg-secondary/50 text-muted-foreground border border-white/5" : "hero-gradient shadow-xl active:scale-95")
              )} 
              onClick={(e) => { e.stopPropagation(); if (!isLeading && !isOwner) setShowBidModal(true); }} 
              disabled={isOwner}
            >
              {isOwner ? (language === 'ru' ? 'ВАШ ЮНИОР' : 'YOUR UNIT') : (language === 'ru' ? 'ПОСТАВИТЬ' : 'PLACE BID')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showDossier} onOpenChange={setShowDossier}>
        <DialogContent className="max-w-md bg-background border-white/10 p-0 overflow-hidden shadow-2xl h-full flex flex-col">
          <div className="p-4 pt-12 pb-8 bg-gradient-to-br from-primary/20 via-background to-accent/10 border-b border-white/5 relative shrink-0 text-center">
            <Button variant="ghost" size="icon" className="absolute left-4 top-10 rounded-full bg-black/20" onClick={() => setShowDossier(false)}><X className="w-5 h-5" /></Button>
            <div className="relative mx-auto w-24 h-24 mb-4">
              <div className={cn("w-full h-full rounded-2xl overflow-hidden border-2 border-primary/50 shadow-2xl bg-secondary/50")}>
                <img src={agent.heroData?.image} alt="" className="w-full h-full object-cover" />
              </div>
              <div className="absolute -bottom-2 -right-2 w-10 h-10 rounded-xl bg-background border border-white/10 flex items-center justify-center shadow-xl">
                <span className="text-xl">{agent.heroData.country?.flag}</span>
              </div>
            </div>
            <DialogTitle className="text-2xl font-headline font-bold uppercase tracking-tight text-white leading-none">{agent.heroData?.name}</DialogTitle>
            <div className="flex items-center justify-center gap-2 mt-2">
              <Badge className="bg-primary text-primary-foreground text-[10px] font-black uppercase px-2 h-5">{rolesRu[agent.heroData.role] || agent.heroData.role}</Badge>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-8 scrollbar-hide">
            <section className="grid grid-cols-2 gap-3">
              <div className="bg-secondary/20 p-3 rounded-xl border border-white/5 space-y-1">
                <p className="text-[8px] font-black text-muted-foreground uppercase tracking-widest">{t.owner}</p>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-3 h-3 text-primary" />
                  <p className="text-[10px] font-bold uppercase truncate">{agent.sellerName || "System"}</p>
                </div>
              </div>
              <div className="bg-secondary/20 p-3 rounded-xl border border-white/5 space-y-1">
                <p className="text-[8px] font-black text-muted-foreground uppercase tracking-widest">{t.sale}</p>
                <div className="flex items-center gap-2">
                  <Timer className="w-3 h-3 text-accent animate-pulse" />
                  <p className="text-[10px] font-mono font-bold text-accent">{getCountdown(agent.expiresAt)}</p>
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-[9px] font-black text-primary uppercase tracking-[0.2em] mb-4 flex items-center gap-2 opacity-80 px-1">
                <Info className="w-3.5 h-3.5" /> {language === 'ru' ? 'ОБЩИЕ ДАННЫЕ' : 'GENERAL INTEL'}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[64px]">
                   <span className="text-[9px] font-bold text-muted-foreground uppercase">{t.age}</span>
                   <span className="text-[10px] font-bold">{liveAge.display} {t.yrs}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[64px]">
                   <span className="text-[9px] font-bold text-muted-foreground uppercase whitespace-nowrap">{t.talent}</span>
                   <div className="flex items-center">
                    {renderStars(maxTalentValue)}
                   </div>
                </div>
                <div className="flex items-center justify-between p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[64px]">
                   <span className="text-[9px] font-bold text-muted-foreground uppercase">Salary</span>
                   <span className="text-[10px] font-bold text-primary">€{(agent.heroData.salary || 0).toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[64px]">
                   <span className="text-[9px] font-bold text-muted-foreground uppercase">{language === 'ru' ? 'Роль' : 'Role'}</span>
                   <span className="text-[10px] font-bold uppercase">{rolesRu[agent.heroData.role] || agent.heroData.role}</span>
                </div>
              </div>
            </section>

            <section>
              <h3 className="text-[9px] font-black text-primary uppercase tracking-[0.2em] mb-4 flex items-center gap-2 opacity-80 px-1">
                <Activity className="w-3.5 h-3.5" /> {language === 'ru' ? 'НАВЫКИ' : 'SKILLS'}
              </h3>
              <div className="space-y-3">
                {STAT_KEYS.map((key) => { 
                  const Icon = icons[key] || Info;
                  const displayValue = Math.round(Number((agent.heroData.proStats as any)[key]));
                  const talentLimit = normTalent((agent.heroData.proTalents as any)[key] || 10);

                  return (
                    <div key={`skill-${key}`} className="space-y-2 p-3 rounded-xl border border-white/5 bg-secondary/10">
                      <div className="flex justify-between items-center px-0.5">
                        <div className="flex items-center gap-2">
                          <Icon className="w-4 h-4 text-muted-foreground/60" />
                          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{proStatsLabels[key]}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-mono font-bold text-white">{displayValue}</span>
                          <span className="text-[10px] text-muted-foreground/50">/</span>
                          <span className="text-xs font-mono font-bold text-primary/70">{talentLimit}</span>
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
                <Zap className="w-3.5 h-3.5" /> {language === 'ru' ? 'ТАЛАНТЫ' : 'TALENTS'}
              </h3>
              <div className="space-y-2">
                {STAT_KEYS.map((key) => {
                  const talentLimit = normTalent((agent.heroData.proTalents as any)[key]);
                  const Icon = icons[key] || Info;
                  return (
                    <div key={`talent-${key}`} className="p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[48px] flex flex-col justify-center">
                      <div className="flex justify-between items-center px-0.5">
                        <div className="flex items-center gap-2">
                          <Icon className="w-4 h-4 text-accent/50" />
                          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{proStatsLabels[key]}</span>
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
              <div className="bg-secondary/30 p-6 rounded-xl border border-white/5 space-y-4">
                   <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[9px] font-black text-muted-foreground uppercase">{language === 'ru' ? 'ТЕКУЩАЯ ЦЕНА' : 'CURRENT PRICE'}</p>
                        <p className="text-2xl font-headline font-bold text-white italic">€ {agent.currentBid?.toLocaleString()}</p>
                      </div>
                      <div className="text-right flex flex-col justify-center">
                         <p className="text-2xl font-headline font-bold text-primary uppercase truncate max-w-[240px]">
                           {agent.highestBidderName || (language === 'ru' ? 'Нет ставок' : 'No bids')}
                         </p>
                      </div>
                   </div>
                </div>
              </section>
          </div>

          <div className="p-4 bg-secondary/20 border-t border-white/5 shrink-0">
             <Button className="w-full h-14 hero-gradient font-black text-xs uppercase tracking-widest shadow-xl active:scale-95 transition-all" onClick={() => { setShowDossier(false); if (!isLeading && !isOwner) setShowBidModal(true); }} disabled={isOwner}>
               {language === 'ru' ? 'ПОСТАВИТЬ' : 'PLACE BID'}
             </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showBidModal} onOpenChange={setShowBidModal}>
        <DialogContent className="max-sm bg-card border-white/10 p-0 overflow-hidden shadow-2xl">
          <div className="p-6 text-center bg-gradient-to-br from-primary/20 via-background to-accent/10 border-b border-white/5">
            <div className="mx-auto w-16 h-16 rounded-2xl overflow-hidden border border-primary/50 shadow-xl bg-secondary/50 mb-4">
              <img src={agent.heroData?.image} alt="" className="w-full h-full object-cover" />
            </div>
            <DialogTitle className="text-2xl font-headline font-bold uppercase tracking-tight text-white leading-none">
              {agent.heroData?.name}
            </DialogTitle>
            <DialogDescription className="text-[10px] text-muted-foreground mt-2 uppercase tracking-[0.2em] font-black">{language === 'ru' ? 'ТЕРМИНАЛ СТАВОК' : 'BIDDING TERMINAL'}</DialogDescription>
          </div>

          <div className="p-6 space-y-8">
            <div className="space-y-4">
              <div className="flex justify-between items-center px-1">
                <span className="text-[10px] font-black uppercase text-muted-foreground flex items-center gap-2">
                  <Gavel className="w-4 h-4 text-primary" /> {language === 'ru' ? 'СУММА СДЕЛКИ' : 'NEW BID AMOUNT'}
                </span>
                <span className="text-xl font-headline font-black text-primary italic">€ {nextBidValue.toLocaleString()}</span>
              </div>
              
              <div className="relative pt-4 pb-2">
                <Slider
                  value={[bidPercent]}
                  onValueChange={(val) => setBidPercent(val[0])}
                  min={3}
                  max={300}
                  step={1}
                />
              </div>
            </div>

            <div className="bg-primary/5 rounded-xl border border-primary/20 p-4 flex gap-4">
               <span className="p-1 rounded bg-primary/20 h-fit"><Info className="w-4 h-4 text-primary" /></span>
               <p className="text-[10px] text-muted-foreground leading-relaxed italic">
                 {language === 'ru' 
                  ? "Средства будут списаны немедленно. Если вашу ставку перебьют, сумма вернется на баланс клуба." 
                  : "Funds will be deducted immediately. If outbid, the amount will be returned to your club balance."}
               </p>
            </div>
          </div>

          <DialogFooter className="p-4 bg-secondary/20 border-t border-white/5 gap-2">
            <Button variant="outline" className="flex-1 h-12 uppercase font-black text-[10px] border-white/10" onClick={() => setShowBidModal(false)}>
              {language === 'ru' ? 'ОТМЕНА' : 'CANCEL'}
            </Button>
            <Button 
              className="flex-[2] h-12 hero-gradient font-black text-[11px] uppercase tracking-widest shadow-xl shadow-primary/20"
              onClick={async () => {
                setIsProcessing(true);
                await onBid(agent, nextBidValue);
                setIsProcessing(false);
                setShowBidModal(false);
              }}
              disabled={isProcessing}
            >
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : (language === 'ru' ? 'ПОДТВЕРДИТЬ' : 'CONFIRM')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});

YouthTransferCard.displayName = 'YouthTransferCard';

export default function YouthTransfersPage() {
  const { language, isLoaded: isStoreLoaded } = useGameState();
  const { user, isUserLoading } = useUser();
  const auth = useAuth();
  const db = useFirestore();
  const router = useRouter();
  const { toast } = useToast();

  const [now, setNow] = useState(Date.now());
  const [page, setPage] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setNow(getMoscowTime().getTime()), 1000);
    return () => clearInterval(timer);
  }, []);

  const marketQuery = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return query(collection(db, 'market_v7'), where('isYouth', '==', true));
  }, [db, user?.uid]);

  const { data: allAgents, isLoading: isMarketLoading } = useCollection(marketQuery);
  const userDocRef = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return doc(db, 'players_v14', user.uid);
  }, [db, user?.uid]);
  
  const { data: profile } = useDoc(userDocRef);

  const t = {
    title: language === 'ru' ? 'ТРАНСФЕРЫ ЮНИОРОВ' : 'YOUTH TRANSFERS',
    offline: language === 'ru' ? "ОФЛАЙН: Рынок юниоров недоступен." : "OFFLINE: Youth market restricted."
  };

  if (isUserLoading || !isStoreLoaded || isMarketLoading) return <LoadingScreen />;

  if (!db) {
    return (
      <div className="max-w-md mx-auto px-4 pt-8 text-center">
        <header className="mb-6 flex items-center gap-4">
          <Button variant="ghost" size="icon" className="rounded-full" onClick={() => router.push('/youth-academy')}><ChevronLeft className="w-6 h-6" /></Button>
          <div><h1 className="text-2xl font-headline font-bold uppercase">{t.title}</h1></div>
        </header>
        <div className="py-20 opacity-30 flex flex-col items-center gap-6">
           <Lock className="w-16 h-16" />
           <p className="text-xs font-black uppercase tracking-widest">{t.offline}</p>
        </div>
      </div>
    );
  }

  const youthAgents = useMemo(() => {
    return (allAgents || [])
      .filter(a => {
        if (a.isSystem && !a.id.includes('v900')) return false;
        return new Date(a.expiresAt).getTime() > now;
      })
      .sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());
  }, [allAgents, now]);

  const paginatedAgents = useMemo(() => {
    const start = page * ITEMS_PER_PAGE;
    return youthAgents.slice(start, start + ITEMS_PER_PAGE);
  }, [youthAgents, page]);

  const totalPages = Math.ceil(youthAgents.length / ITEMS_PER_PAGE);

  const handleGlobalBid = useCallback(async (agent: any, amount: number) => {
    if (!db || !user) return;
    try {
      const result = await runWithFreshIdToken(auth, user, (idToken) =>
        placeYouthMarketBidAction(idToken, String(agent.id), amount)
      );
      if ('error' in result) throw new Error(result.error || 'BID_FAILED');
      toast({
        title: language === 'ru' ? 'Ставка принята!' : 'Bid Placed!',
        description: 'expiresAt' in result && new Date(result.expiresAt).getTime() > new Date(agent.expiresAt).getTime()
          ? (language === 'ru' ? 'Аукцион продлён на 10 минут!' : 'Auction extended by 10 minutes!')
          : undefined,
      });
    } catch (error: any) {
      const message = String(error?.message || 'BID_FAILED');
      const localized = language === 'ru'
        ? message === 'INSUFFICIENT_FUNDS' ? 'Недостаточно средств' : message === 'BID_TOO_LOW' ? 'Ставка должна быть выше текущей' : 'Не удалось разместить ставку'
        : message === 'INSUFFICIENT_FUNDS' ? 'Insufficient funds' : message === 'BID_TOO_LOW' ? 'Bid must exceed the current bid' : 'Could not place bid';
      toast({ title: localized, variant: 'destructive' });
    }
  }, [auth, user, language, toast, db]);

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-32">
      <header className="mb-6 flex items-center gap-4">
        <Button variant="ghost" size="icon" className="rounded-full" onClick={() => router.push('/youth-academy')}><ChevronLeft className="w-6 h-6" /></Button>
        <div>
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter text-primary flex items-center gap-2">
            <ShoppingCart className="w-6 h-6 text-primary" />
            {t.title}
          </h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-bold opacity-60">
            Academy Market Stream
          </p>
        </div>
      </header>

      <div className="space-y-3 animate-in fade-in duration-500">
        {youthAgents.length > 0 ? (
          <>
            {paginatedAgents.map((agent) => (
              <YouthTransferCard 
                key={agent.id} 
                agent={agent} 
                user={user} 
                profile={profile} 
                onBid={handleGlobalBid}
                now={now}
                language={language}
              />
            ))}

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-6">
                <Button variant="ghost" size="icon" disabled={page === 0} onClick={() => setPage(0)} className="h-8 w-8"><ChevronsLeft className="w-4 h-4" /></Button>
                <Button variant="ghost" size="icon" disabled={page === 0} onClick={() => setPage(p => p - 1)} className="h-8 w-8"><ChevronLeftIcon className="h-4 w-4" /></Button>
                <span className="text-[10px] font-black text-muted-foreground uppercase px-4">
                  {language === 'ru' ? 'Стр' : 'Page'} {page + 1} / {totalPages}
                </span>
                <Button variant="ghost" size="icon" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} className="h-8 w-8"><ChevronRightIcon className="h-4 w-4" /></Button>
              </div>
            )}
          </>
        ) : (
          <div className="py-20 text-center opacity-30 border border-dashed border-white/10 rounded-2xl flex flex-col items-center gap-4 p-10">
            <ShoppingCart className="w-12 h-12" />
            <p className="text-[10px] uppercase font-black">{language === 'ru' ? 'Нет молодежных лотов' : 'No youth listings'}</p>
          </div>
        )}
      </div>
    </div>
  );
}
