
'use client';

import { useGameState, getLevelThreshold, Gift } from '../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { 
  User, ShieldCheck, LogOut, RefreshCw,
  ChevronRight, ChevronLeft, Loader2,
  Trophy, Star, Wallet, Gem, Flag, Zap, 
  Award, ScrollText, CircleDollarSign, 
  UserCog, HeartPulse, GraduationCap, 
  TrendingUp, BarChart3, Building2, MapPin,
  Shield, Activity, Settings2, Info, AlertTriangle, Trash2, Medal,
  Gift as GiftIcon, Package, CheckCircle2, Clock, Crown, Coins
} from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import { useAuth, useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import { doc } from 'firebase/firestore';
import { COUNTRIES } from '@/app/lib/countries-data';
import { Badge } from '@/components/ui/badge';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { releasePlayerSlot } from '@/app/actions/season-init';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type ProfileTab = 'menu' | 'team' | 'gifts';

export default function ProfilePage() {
  const { 
    ownedPlayers, language, isLoaded: isStoreLoaded, 
    credits, crystals, leagueLevel, clubName, country, numericId,
    experiencePoints, activeLicenseTier, hq, managerLevel,
    managerSkills, arena, bootcamp, academy, medical,
    isPremium, premiumUntil, resetProfile, trophies, receivedGifts = [], claimGift
  } = useGameState();
  const { user, isUserLoading } = useUser();
  const auth = useAuth();
  const db = useFirestore();
  const router = useRouter();
  const { toast } = useToast();
  
  const [activeTab, setActiveTab] = useState<ProfileTab>('menu');
  const [isResetting, setIsResetting] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [isClaiming, setIsClaiming] = useState<string | null>(null);

  const userRef = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return doc(db, 'players_v14', user.uid);
  }, [db, user?.uid]);
  
  const { data: profile, isLoading: isProfileLoading } = useDoc(userRef);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.replace('/auth/login');
    }
  }, [user, isUserLoading, router]);

  const popularityPoints = useMemo(() => {
    const leaguePoints = (10 - (leagueLevel || 9)) * 1000;
    const totalInfraLevels = (
      (arena.pressCenterLevel || 0) + (arena.cafeLevel || 0) + (arena.shopLevel || 0) + 
      (arena.screensLevel || 0) + (arena.parkingLevel || 0) + (arena.lightingLevel || 0) +
      (hq.hrLevel || 0) + (hq.financeLevel || 0) + (hq.scoutsLevel || 0) + 
      (hq.pressOfficeLevel || 0) + (hq.adminLevel || 0) +
      (bootcamp.bootcampLevel || 0) + (bootcamp.tacticsHallLevel || 0) + 
      (bootcamp.poolLevel || 0) + (bootcamp.researchLevel || 0) +
      (academy.youthBootcampLevel || 0) + (academy.streamingLevel || 0) + 
      (academy.scoutsLevel || 0) + (academy.discoLevel || 0) +
      (medical.physiotherapyLevel || 0) + (medical.massageLevel || 0) + 
      (medical.psychiatristLevel || 0) + (medical.labLevel || 0) + (medical.psychologistLevel || 0)
    );
    const infraPoints = totalInfraLevels * 150;
    const proPlayerPoints = ownedPlayers.filter(p => p.isPro).length * 5000;
    const fanPoints = Math.floor((arena.capacity || 5000) * 0.5);
    const premiumPoints = isPremium ? 25000 : 0;
    let licensePoints = 0;
    if (activeLicenseTier === 3) licensePoints = 5000;
    else if (activeLicenseTier === 2) licensePoints = 15000;
    else if (activeLicenseTier === 1) licensePoints = 35000;
    return 5000 + leaguePoints + infraPoints + proPlayerPoints + fanPoints + premiumPoints + licensePoints;
  }, [arena, hq, bootcamp, academy, medical, activeLicenseTier, leagueLevel, isPremium, ownedPlayers]);

  const currentXp = experiencePoints || 0;
  const xpThreshold = getLevelThreshold(managerLevel || 1);
  const xpProgress = Math.min(100, (currentXp / xpThreshold) * 100);

  if (!isStoreLoaded || isUserLoading) {
    return <LoadingScreen />;
  }

  const translations = {
    en: {
      title: "LEGENDARY MANAGER",
      backToMenu: "Back to Hub",
      lvl: "LVL",
      xp: "XP Progress",
      popularity: "Global Status",
      resetBtn: "RESET PROFILE",
      logoutBtn: "LOGOUT",
      resetTitle: "ABSOLUTE RESET",
      resetDesc: "This action will PERMANENTLY delete your team, progress, and assets. You will have to initialize your club again. THIS CANNOT BE UNDONE.",
      teamStats: "Operational Balance",
      premiumActive: "ELITE STATUS ACTIVE",
      premiumExp: "Expires",
      trophies: "TROPHIES",
      noTrophies: "No trophies won yet. Win tournaments to see them here.",
      skills: { title: "STRATEGIC DEVELOPMENT", points: "Points Available", sponsors: "Sponsor Relations", agents: "Transfer Agents", training: "Training Methods", medical: "Medical Center" },
      tabs: { team: "MY TEAM", gifts: "GIFTS", menu: "DASHBOARD" },
      gifts: { title: "DIPLOMATIC STORAGE", received: "Incoming Shipments", activate: "ACTIVATE", noGifts: "Storage empty", noGiftsDesc: "Connect with S-Tier allies to receive support packages.", success: "Bonus Applied!", fail: "No targets available", failDesc: "Ensure you have active construction, staff, or youth players." }
    },
    ru: {
      title: "ЛЕГЕНДАРНЫЙ МЕНЕДЖЕР",
      backToMenu: "Вернуться в хаб",
      lvl: "УР",
      xp: "Опыт менеджера",
      popularity: "Статус в мире",
      resetBtn: "СБРОСИТЬ ПРОФИЛЬ",
      logoutBtn: "ВЫЙТИ ИЗ ПРОФИЛЯ",
      resetTitle: "ПОЛНЫЙ СБРОС",
      resetDesc: "Это действие НАВСЕГДА удалит вашу команду, весь прогресс и активы. Вам придется заново инициализировать клуб. ЭТО ДЕЙСТВИЕ НЕЛЬЗЯ ОТМЕНИТЬ.",
      teamStats: "Операционный баланс",
      premiumActive: "ЭЛИТНЫЙ СТАТУС АКТИВЕН",
      premiumExp: "Истекает",
      trophies: "ТРОФЕИ",
      noTrophies: "Трофеев пока нет. Выигрывайте турниры, чтобы они появились здесь.",
      skills: { title: "РАЗВИТИЕ КЛУБА", points: "Очки навыков", sponsors: "Спонсоры", agents: "Агенты", training: "Тренировки", medical: "Медицина" },
      tabs: { team: "МОЯ КОМАНДА", gifts: "ПОДАРКИ", menu: "ГЛАВНАЯ" },
      gifts: { title: "СКЛАД ПОДАРКОВ", received: "Входящие грузы", activate: "АКТИВИРОВАТЬ", noGifts: "Склад пуст", noGiftsDesc: "Дружите с игроками ранга S-Tier, чтобы получать поддержку.", success: "Бонус применен!", fail: "Нет цели для бонуса", failDesc: "Убедитесь, что у вас есть активная постройка, персонал или юниоры." }
    }
  };

  const t = translations[language as 'en' | 'ru'] || translations.ru;

  const handleReset = async () => {
    if (!user) return;
    setIsResetting(true);
    try {
      // 1. Возвращаем слот боту и удаляем профиль на сервере
      await releasePlayerSlot(await user.getIdToken());
      
      // 2. Очищаем локальное хранилище
      await resetProfile();
      
      toast({ title: language === 'ru' ? "Профиль сброшен" : "Profile Reset Complete" });
      router.push('/setup');
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Reset Failed" });
    } finally {
      setIsResetting(false);
      setShowResetDialog(false);
    }
  };

  const handleLogout = async () => {
    if (!auth) return;
    try {
      await signOut(auth);
      // При выходе просто очищаем локальное состояние (не удаляя данные в БД)
      if (typeof window !== 'undefined') {
        localStorage.removeItem('lote_game_state_v242');
      }
      window.location.href = '/auth/login';
    } catch (e) {
      console.error("Logout error", e);
    }
  };

  const handleClaimGiftAction = async (gift: Gift) => {
    setIsClaiming(gift.id);
    const success = await claimGift(gift);
    if (success) {
      toast({ title: t.gifts.success });
    } else {
      toast({ variant: "destructive", title: t.gifts.fail, description: t.gifts.failDesc });
    }
    setIsClaiming(null);
  };

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-6">
      <header className="flex flex-col items-center mb-10 relative">
        <Button variant="ghost" size="icon" className="absolute left-0 top-0 rounded-full" onClick={() => router.push('/')}><ChevronLeft className="w-6 h-6" /></Button>
        <div className="relative group mb-4">
          <div className={cn("absolute -inset-4 rounded-full blur-2xl transition-all", isPremium ? "bg-accent/30 group-hover:bg-accent/40" : "bg-primary/20 group-hover:bg-primary/30")}></div>
          <div className={cn("w-24 h-24 rounded-full flex items-center justify-center shadow-2xl relative z-10 border-2", isPremium ? "bg-gradient-to-br from-accent to-blue-600 border-accent/40" : "bg-gradient-to-br from-primary to-accent border-white/10")}>
            <User className="w-12 h-12 text-white" />
          </div>
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-background border border-white/10 px-3 py-0.5 rounded-full z-20 shadow-xl">
            <span className="text-[10px] font-black text-primary uppercase tracking-widest whitespace-nowrap">{t.lvl} {managerLevel || 1}</span>
          </div>
        </div>
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-headline font-black uppercase tracking-tight text-white leading-none">
            {clubName || profile?.clubName || 'COMMANDER'}
          </h1>
          <div className="flex flex-col items-center gap-1">
            <p className="text-[9px] text-accent font-black uppercase tracking-[0.2em]">ID: {numericId || '---'}</p>
            <p className="text-[10px] text-muted-foreground uppercase font-black tracking-[0.2em] opacity-60 flex items-center justify-center gap-2">
              <MapPin className="w-3 h-3 text-primary" /> {country || profile?.country || 'International'}
            </p>
          </div>
        </div>
        <div className="w-full max-w-[240px] mt-6 space-y-2">
           <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest px-1"><span className="text-muted-foreground">{t.xp}</span><span className="text-primary">{currentXp.toLocaleString()} / {xpThreshold.toLocaleString()}</span></div>
           <div className="relative h-2 w-full bg-secondary/50 rounded-full overflow-hidden border border-white/5"><div className="absolute top-0 left-0 h-full hero-gradient transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(var(--primary),0.5)]" style={{ width: `${xpProgress}%` }} /></div>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-2 mb-8 bg-secondary/20 p-1 rounded-xl border border-white/5">
        {(['menu', 'team', 'gifts'] as const).map((tab) => (
          <Button 
            key={tab} 
            variant="ghost" 
            size="sm" 
            onClick={() => setActiveTab(tab)} 
            className={cn("relative h-10 text-[10px] font-black uppercase tracking-widest transition-all", activeTab === tab ? "bg-white/10 text-primary shadow-inner" : "text-muted-foreground hover:text-white")}
          >
            {t.tabs[tab]}
            {tab === 'gifts' && (receivedGifts?.length || 0) > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center text-[8px] font-black animate-pulse">
                {receivedGifts.length}
              </span>
            )}
          </Button>
        ))}
      </div>

      {activeTab === 'menu' && (
        <div className="space-y-4 animate-in fade-in duration-500 pb-20">
          <Card className="glass-card border-primary/20 bg-primary/5 p-6">
             <div className="flex items-center gap-2 mb-4">
               <Trophy className="w-5 h-5 text-yellow-500" />
               <h3 className="text-sm font-black uppercase text-white tracking-widest">{t.trophies}</h3>
             </div>
             {trophies && trophies.length > 0 ? (
               <div className="grid grid-cols-1 gap-2">
                 {trophies.map((trophy: any, idx: number) => (
                   <div key={idx} className="bg-secondary/30 p-3 rounded-xl border border-white/5 flex items-center justify-between">
                     <div className="flex items-center gap-3">
                       <div className="p-2 rounded-lg bg-yellow-500/10"><Medal className="w-4 h-4 text-yellow-500" /></div>
                       <div>
                         <p className="text-[10px] font-bold text-white uppercase">{trophy.name}</p>
                         <p className="text-[8px] text-muted-foreground uppercase">{new Date(trophy.date).toLocaleDateString()}</p>
                       </div>
                     </div>
                     {trophy.reward && <Badge variant="outline" className="text-[8px] text-green-400 border-green-500/30">+{trophy.reward.toLocaleString()} €</Badge>}
                   </div>
                 ))}
               </div>
             ) : (
               <div className="py-8 text-center opacity-30 flex flex-col items-center gap-3 border border-dashed border-white/10 rounded-xl">
                 <Trophy className="w-8 h-8" />
                 <p className="text-[9px] uppercase font-bold max-w-[180px] leading-relaxed">{t.noTrophies}</p>
               </div>
             )}
          </Card>
          <div className="grid grid-cols-1 gap-2">
            <Button variant="outline" className="h-12 border-white/5 bg-secondary/20 hover:bg-white/5 justify-between px-4 group" onClick={() => setActiveTab('team')}><div className="flex items-center gap-3"><Shield className="w-4 h-4 text-primary group-hover:scale-110 transition-transform" /><span className="text-[10px] font-black uppercase">Club Infrastructure Overview</span></div><ChevronRight className="w-4 h-4 text-muted-foreground" /></Button>
          </div>
          <div className="pt-6 space-y-2">
            <Button variant="destructive" className="w-full h-14 hero-gradient border-none font-black text-xs tracking-[0.2em] uppercase shadow-2xl active:scale-95 transition-all" onClick={() => setShowResetDialog(true)} disabled={isResetting}>
              {isResetting ? <Loader2 className="animate-spin" /> : <><RefreshCw className="w-4 h-4 mr-2" /> {t.resetBtn}</>}
            </Button>
            <Button variant="outline" className="w-full h-12 border-white/10 bg-secondary/20 hover:bg-white/5 font-black text-xs tracking-[0.2em] uppercase active:scale-95 transition-all" onClick={handleLogout}>
              <LogOut className="w-4 h-4 mr-2 text-red-400" /> {t.logoutBtn}
            </Button>
          </div>
        </div>
      )}

      {activeTab === 'team' && (
        <div className="space-y-4 animate-in fade-in duration-500 pb-20">
           <Card className="glass-card border-white/5 bg-secondary/10 p-6">
              <div className="flex items-center gap-3 mb-6">
                <Shield className="w-6 h-6 text-primary" />
                <h3 className="text-sm font-black uppercase text-white tracking-widest">Club Intelligence</h3>
              </div>
              <div className="space-y-4">
                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                   <span className="text-[10px] font-bold text-muted-foreground uppercase">Popularity Rank</span>
                   <span className="text-sm font-headline font-bold text-accent">{popularityPoints.toLocaleString()} PR</span>
                </div>
                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                   <span className="text-[10px] font-bold text-muted-foreground uppercase">League Level</span>
                   <span className="text-sm font-headline font-bold text-white">Division {leagueLevel}</span>
                </div>
                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                   <span className="text-[10px] font-bold text-muted-foreground uppercase">License Tier</span>
                   <Badge variant="outline" className="text-[8px] border-primary/30 text-primary uppercase font-black">
                     {activeLicenseTier === 1 ? 'S-TIER' : activeLicenseTier === 2 ? 'A-TIER' : activeLicenseTier === 3 ? 'B-TIER' : 'STANDARD'}
                   </Badge>
                </div>
                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                   <span className="text-[10px] font-bold text-muted-foreground uppercase">Manager Level</span>
                   <span className="text-sm font-headline font-bold text-primary">{managerLevel}</span>
                </div>
              </div>
           </Card>
        </div>
      )}

      {activeTab === 'gifts' && (
        <div className="space-y-4 animate-in fade-in duration-500 pb-20">
           <Card className="glass-card border-accent/20 bg-accent/5 p-6">
              <div className="flex items-center gap-3 mb-6">
                <GiftIcon className="w-6 h-6 text-accent" />
                <h3 className="text-sm font-black uppercase text-white tracking-widest">{t.gifts.title}</h3>
              </div>
              <div className="bg-background/40 p-4 rounded-xl border border-white/5 space-y-4">
                 <p className="text-[10px] text-muted-foreground italic leading-relaxed">
                   {t.gifts.noGiftsDesc}
                 </p>
              </div>
           </Card>

           <div className="space-y-3">
             <h3 className="text-[10px] font-black uppercase tracking-widest text-primary px-1 flex items-center gap-2"><Package className="w-4 h-4" /> {t.gifts.received}</h3>
             {receivedGifts && receivedGifts.length > 0 ? (
               <div className="grid grid-cols-1 gap-2">
                 {receivedGifts.map((gift) => (
                   <Card key={gift.id} className="glass-card border-white/5 overflow-hidden">
                     <CardContent className="p-4 flex items-center justify-between">
                       <div className="flex items-center gap-4">
                         <div className="p-2.5 rounded-xl bg-accent/20 border border-accent/30">
                           <GiftIcon className="w-6 h-6 text-accent" />
                         </div>
                         <div>
                           <h4 className="text-xs font-bold uppercase text-white">{gift.label}</h4>
                           <p className="text-[8px] text-muted-foreground uppercase font-black mt-1">From: {gift.senderName || 'Unknown Ally'}</p>
                         </div>
                       </div>
                       <Button 
                         size="sm" 
                         className="hero-gradient font-black text-[9px] uppercase px-4 h-9"
                         onClick={() => handleClaimGiftAction(gift)}
                         disabled={isClaiming === gift.id}
                       >
                         {isClaiming === gift.id ? <Loader2 className="w-3 h-3 animate-spin" /> : t.gifts.activate}
                       </Button>
                     </CardContent>
                   </Card>
                 ))}
               </div>
             ) : (
               <div className="py-12 text-center opacity-30 border border-dashed border-white/10 rounded-2xl flex flex-col items-center gap-4">
                 <GiftIcon className="w-10 h-10" />
                 <p className="text-[10px] font-black uppercase tracking-widest">{t.gifts.noGifts}</p>
               </div>
             )}
           </div>
        </div>
      )}

      <Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <DialogContent className="max-w-xs bg-card border-white/10 p-6">
          <DialogHeader>
            <div className="mx-auto w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-4 border border-red-500/20"><AlertTriangle className="w-8 h-8 text-red-500 animate-pulse" /></div>
            <DialogTitle className="text-center font-headline font-bold uppercase text-red-500">{t.resetTitle}</DialogTitle>
            <DialogDescription className="text-center text-xs text-muted-foreground mt-2">{t.resetDesc}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 mt-6">
            <Button variant="destructive" className="h-12 font-black uppercase text-[10px]" onClick={handleReset} disabled={isResetting}>
              {isResetting ? <Loader2 className="animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />} {language === 'ru' ? 'ПОДТВЕРДИТЬ СБРОС' : 'CONFIRM RESET'}
            </Button>
            <Button variant="outline" className="h-12 font-bold uppercase text-[10px] border-white/10" onClick={() => setShowResetDialog(false)} disabled={isResetting}>{language === 'ru' ? 'ОТМЕНА' : 'CANCEL'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
