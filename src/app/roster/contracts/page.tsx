
'use client';

import { useState, useEffect } from 'react';

import { useGameState } from '../../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  ChevronLeft, Scroll, User, Star, Trash2, 
  Coins, Gem, HeartPulse, ShieldAlert, Award,
  Info, TrendingUp, Eye, Target, Brain, Map, Users,
  Zap, Sword, Crosshair, Activity, ShoppingCart, Loader2, Clock, UserCog, Sparkles, X, ShieldCheck, Timer, Activity as ActivityIcon
} from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import Link from 'next/link';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { Player } from '../../lib/moba-data';
import { useToast } from '@/hooks/use-toast';
import { listPlayerOnMarketAction } from '@/app/actions/gameplay';
import { purchasePlayerCareAction } from '@/app/actions/player-care';
import { signOut } from 'firebase/auth';
import { useUser, useAuth, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import { getMoscowDateString, getMoscowTime, calculateLiveAge } from '@/app/lib/time-utils';
import { STAT_KEYS } from '@/app/lib/store';

const renderStars = (value: number) => {
  const count = Math.max(0, Math.min(5, Math.round(Number(value) / 20)));
  return <span aria-label={`${count} of 5`} className="text-amber-400 tracking-tight">{'★'.repeat(count)}{'☆'.repeat(5 - count)}</span>;
};

const normTalent = (val: any) => {
  const n = Number(val);
  if (isNaN(n)) return 0;
  return n < 10 ? Math.round(n * 10) : Math.round(n);
};

const getStatusColor = (val: number) => {
  if (val >= 100) return "text-white";
  if (val >= 75) return "text-green-400";
  if (val >= 35) return "text-yellow-400";
  return "text-red-500";
};

export default function ContractsPage() {
  const { ownedPlayers, language, isLoaded, credits, crystals, removePlayer, displayName } = useGameState();
  const { user } = useUser();
  const auth = useAuth();
  const db = useFirestore();
  const [profilePlayer, setProfilePlayer] = useState<Player | null>(null);
  const [now, setNow] = useState(Date.now());
  const [isTransferring, setIsTransferring] = useState(false);
  const [isCareProcessing, setIsCareProcessing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Use players_v14 for active profile
  const userRef = useMemoFirebase(() => (db && user?.uid ? doc(db, 'players_v14', user.uid) : null), [db, user?.uid]);
  const { data: profile } = useDoc(userRef);

  if (!isLoaded) return <LoadingScreen />;

  const t = {
    title: language === 'ru' ? "КОНТРАКТЫ" : "CONTRACTS",
    subtitle: language === 'ru' ? "Администрирование состава" : "Squad administration",
    recoverEuro: language === 'ru' ? "ВОССТАНОВИТЬ ЭНЕРГИЮ (+25%)" : "RESTORE ENERGY (+25%)",
    boostForm: language === 'ru' ? "ПОДНЯТЬ ФОРМУ" : "BOOST FORM",
    insufficient: language === 'ru' ? "Недостаточно средств" : "Insufficient funds",
    years: language === 'ru' ? "лет" : "yrs",
    skills: language === 'ru' ? "НАВЫКИ" : "SKILLS",
    talents: language === 'ru' ? "ТАЛАНТЫ" : "TALENTS",
    close: language === 'ru' ? "ВЕРНУТЬСЯ" : "BACK",
    owner: language === 'ru' ? "ВЛАДЕЛЕЦ" : "OWNER",
    sale: language === 'ru' ? "ПРОДАЖА" : "SALE",
    priceTitle: language === 'ru' ? "ЦЕНА ИГРОКА" : "UNIT PRICE",
    talent: language === 'ru' ? "Талант" : "Talent",
    salary: language === 'ru' ? "Зарплата" : "Salary",
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

  const rolesRu: Record<string, string> = {
    'Carry': 'Керри', 'Midlaner': 'Мидер', 'Tank': 'Танк', 'Jungler': 'Лес', 'Support': 'Саппорт'
  };

  const handleAction = async (action: string) => {
    if (!profilePlayer || !user || isCareProcessing) return;
    const mode = action === 'recoverEuro' ? 'energy' : action === 'boostForm' ? 'form' : null;
    if (!mode) return;
    const cost = mode === 'energy' ? 5_000 : 10_000;
    if (credits < cost) {
      toast({ title: t.insufficient, variant: 'destructive' });
      return;
    }

    setIsCareProcessing(true);
    try {
      const operationId = crypto.randomUUID();
      const result = await purchasePlayerCareAction(
        await user.getIdToken(),
        profilePlayer.id,
        mode,
        operationId,
      );
      if (!result.success) throw new Error(result.error || 'PLAYER_CARE_FAILED');
      const value = Number(result.value);
      setProfilePlayer((previous) => previous
        ? { ...previous, [mode === 'energy' ? 'fatigue' : 'form']: value }
        : null);
      toast({
        title: language === 'ru'
          ? (mode === 'energy' ? 'Энергия восстановлена' : 'Форма улучшена')
          : (mode === 'energy' ? 'Energy restored' : 'Form improved'),
      });
    } catch (error: any) {
      const code = String(error?.message || 'PLAYER_CARE_FAILED');
      toast({
        title: language === 'ru' ? 'Не удалось выполнить операцию' : 'Operation failed',
        description: code === 'INSUFFICIENT_FUNDS' ? t.insufficient : code,
        variant: 'destructive',
      });
    } finally {
      setIsCareProcessing(false);
    }
  };

  const handleTransferListing = async () => {
    if (!profilePlayer || !user || isTransferring) return;
    setIsTransferring(true);

    const isAuthTokenError = (value: any) => {
      const message = String(value?.message || value || '').toLowerCase();
      return message.includes('auth_token_revoked') ||
        message.includes('id token has been revoked') ||
        message.includes('token has been revoked') ||
        message.includes('auth/id-token-revoked') ||
        message.includes('auth/id-token-expired') ||
        message.includes('auth_token_invalid');
    };
    const executeWithFreshToken = async () => listPlayerOnMarketAction(await user.getIdToken(true), profilePlayer.id);

    try {
      let result: Awaited<ReturnType<typeof listPlayerOnMarketAction>>;
      try {
        result = await executeWithFreshToken();
      } catch (error: any) {
        if (!isAuthTokenError(error)) throw error;
        // A stale/revoked ID token should be refreshed and retried before forcing a login.
        try {
          result = await executeWithFreshToken();
        } catch (retryError: any) {
          if (isAuthTokenError(retryError)) {
            if (auth) await signOut(auth);
            window.location.href = '/auth/login';
            return;
          }
          throw retryError;
        }
      }

      if (!result.success && 'error' in result && isAuthTokenError(result.error)) {
        try {
          result = await executeWithFreshToken();
        } catch (retryError: any) {
          if (isAuthTokenError(retryError)) {
            if (auth) await signOut(auth);
            window.location.href = '/auth/login';
            return;
          }
          throw retryError;
        }
      }
      if (!result.success) throw new Error(('error' in result ? String(result.error) : '') || 'LISTING_FAILED');

      toast({
        title: language === 'ru' ? "Игрок выставлен на аукцион!" : "Player listed on auction!",
        description: language === 'ru'
          ? `Старт: €${Number(('startingPrice' in result ? result.startingPrice : undefined) || profilePlayer.marketValue || 0).toLocaleString('ru-RU')} · максимум: €${Number(('maxBid' in result ? result.maxBid : undefined) || profilePlayer.marketValue || 0).toLocaleString('ru-RU')}`
          : `Start: €${Number(('startingPrice' in result ? result.startingPrice : undefined) || profilePlayer.marketValue || 0).toLocaleString('en-US')} · max: €${Number(('maxBid' in result ? result.maxBid : undefined) || profilePlayer.marketValue || 0).toLocaleString('en-US')}`,
      });
      setProfilePlayer(null);
    } catch (e: any) {
      console.error(e);
      toast({ variant: "destructive", title: "Action Failed", description: e?.message || 'LISTING_FAILED' });
    } finally {
      setIsTransferring(false);
    }
  };

  if (profilePlayer) {
    const liveAge = calculateLiveAge(profilePlayer.baseAge, profilePlayer.hiredAt, profilePlayer.birthDate);
    const talentsValues = Object.values(profilePlayer.proTalents || {}).map(v => normTalent(v));
    const maxTalentValue = Math.max(...talentsValues);
    const isOnMarket = profilePlayer.onTransferUntil && new Date(profilePlayer.onTransferUntil).getTime() > now;

    return (
      <div className="fixed inset-0 z-[100] bg-background overflow-y-auto animate-in fade-in slide-in-from-right-4 duration-300">
        <div className="max-w-md mx-auto min-h-screen flex flex-col pb-10">
          <div className="p-4 pt-12 pb-8 bg-gradient-to-br from-primary/20 via-background to-accent/10 border-b border-white/5 flex flex-col items-center text-center gap-4 relative shrink-0">
            <Button variant="ghost" size="icon" className="absolute left-4 top-10 rounded-full bg-black/20" onClick={() => setProfilePlayer(null)}><X className="w-5 h-5" /></Button>
            <div className="relative mx-auto w-24 h-24 mb-4">
              <div className={cn("w-full h-full rounded-2xl overflow-hidden border-2 shadow-2xl bg-secondary/50", profilePlayer.isPro ? "border-yellow-500" : "border-primary/50")}>
                <img src={profilePlayer.image} alt={profilePlayer.name} className="w-full h-full object-cover" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-lg bg-background border border-white/10 flex items-center justify-center shadow-xl"><span className="text-base">{profilePlayer.country?.flag}</span></div>
            </div>
            <div className="space-y-1">
              <h2 className="text-2xl font-headline font-bold uppercase text-white tracking-tight leading-none">{profilePlayer.name}</h2>
              <div className="flex items-center justify-center gap-2 mt-2">
                <Badge className="bg-primary text-primary-foreground text-[10px] font-black uppercase px-2 h-5">{rolesRu[profilePlayer.role] || profilePlayer.role}</Badge>
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
                    <p className="text-[10px] font-mono font-bold text-accent">
                      {isOnMarket ? new Date(profilePlayer.onTransferUntil!).toLocaleTimeString() : 'OFF MARKET'}
                    </p>
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
                     <span className="text-[10px] font-bold text-primary">€{(profilePlayer.salary || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[64px]">
                     <span className="text-[9px] font-bold text-muted-foreground uppercase">{language === 'ru' ? 'Роль' : 'Role'}</span>
                     <span className="text-[10px] font-bold uppercase">{rolesRu[profilePlayer.role] || profilePlayer.role}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[64px]"><span className="text-[9px] font-bold text-muted-foreground uppercase">FRM</span><span className={cn("text-lg font-headline font-bold italic", getStatusColor(profilePlayer.form))}>{profilePlayer.form}</span></div>
                  <div className="flex items-center justify-between p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[64px]"><span className="text-[9px] font-bold text-muted-foreground uppercase">UST</span><span className={cn("text-lg font-headline font-bold italic", getStatusColor(profilePlayer.fatigue))}>{profilePlayer.fatigue}</span></div>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-[9px] font-black text-accent uppercase tracking-[0.2em] mb-4 flex items-center gap-2 opacity-80 px-1"><Scroll className="w-3.5 h-3.5" /> {language === 'ru' ? 'КОНТРАКТНЫЕ ДЕЙСТВИЯ' : 'CONTRACT ACTIONS'}</h3>
                <div className="grid grid-cols-1 gap-2">
                  <Button variant="outline" className="justify-start h-12 border-white/5 bg-secondary/20" disabled={isCareProcessing} onClick={() => handleAction('recoverEuro')}><Coins className="w-4 h-4 mr-3 text-yellow-500" /><div className="text-left"><p className="text-[9px] font-bold uppercase">{t.recoverEuro}</p><p className="text-[8px] text-muted-foreground">+25% Energy | 5,000 €</p></div></Button>
                  <Button variant="outline" className="justify-start h-12 border-white/5 bg-secondary/20" disabled={isCareProcessing} onClick={() => handleAction('boostForm')}><ActivityIcon className="w-4 h-4 mr-3 text-primary" /><div className="text-left"><p className="text-[9px] font-bold uppercase">{t.boostForm}</p><p className="text-[8px] text-muted-foreground">+15% Form | 10,000 €</p></div></Button>
                </div>
              </section>

              <section>
                <h3 className="text-[9px] font-black text-primary uppercase tracking-[0.2em] mb-4 flex items-center gap-2 opacity-80 px-1">
                  <ActivityIcon className="w-3.5 h-3.5" /> {t.skills}
                </h3>
                <div className="space-y-3">
                  {STAT_KEYS.map((key) => { 
                    const Icon = icons[key] || Info;
                    const displayValue = Math.round(Number((profilePlayer.proStats as any)[key]));
                    const talentLimit = normTalent((profilePlayer.proTalents as any)[key] || 10);

                    return (
                      <div key={`skill-${key}`} className="space-y-2 p-3 rounded-xl border border-white/5 bg-secondary/10">
                        <div className="flex justify-between items-center px-0.5">
                          <div className="flex items-center gap-2">
                            <Icon className="w-4 h-4 text-muted-foreground/60" />
                            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{(t.proStatsLabels as any)[key] || key.toUpperCase()}</span>
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
                  <Zap className="w-3.5 h-3.5" /> {language === 'ru' ? 'ТЕЛЕМЕТРИЯ ТАЛАНТА' : 'TALENT TELEMETRY'}
                </h3>
                <div className="space-y-2">
                  {STAT_KEYS.map((key) => {
                    const talentLimit = normTalent((profilePlayer.proTalents as any)[key]);
                    const Icon = icons[key] || Info;
                    return (
                      <div key={`talent-${key}`} className="p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[48px] flex flex-col justify-center">
                        <div className="flex justify-between items-center px-0.5">
                          <div className="flex items-center gap-2">
                            <Icon className="w-4 h-4 text-accent/50" />
                            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{(t.proStatsLabels as any)[key] || key.toUpperCase()}</span>
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
                   <p className="text-[8px] font-black text-muted-foreground uppercase">ESTIMATED MARKET VALUE</p>
                   <p className="text-xl font-headline font-bold text-white italic">€ {(profilePlayer.overallRating * 15000 + 100000).toLocaleString()}</p>
                </div>
              </section>
              
              <div className="pt-4 flex flex-col gap-2">
                <Button 
                  className="w-full h-14 hero-gradient font-black text-xs uppercase tracking-widest shadow-xl"
                  onClick={handleTransferListing}
                  disabled={Boolean(isTransferring || isOnMarket)}
                >
                  {isTransferring ? <Loader2 className="animate-spin mr-2" /> : <ShoppingCart className="w-4 h-4 mr-2" />}
                  {isOnMarket ? (language === 'ru' ? 'УЖЕ НА РЫНКЕ' : 'ALREADY LISTED') : (language === 'ru' ? 'ВЫСТАВИТЬ НА ТРАНСФЕР' : 'LIST ON TRANSFER MARKET')}
                </Button>
                <Button variant="ghost" className="w-full h-12 text-[9px] font-black uppercase tracking-widest text-muted-foreground" onClick={() => setProfilePlayer(null)}>{t.close}</Button>
              </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-6">
      <header className="mb-6 flex items-center gap-4">
        <Link href="/roster"><Button variant="ghost" size="icon" className="rounded-full"><ChevronLeft className="w-6 h-6" /></Button></Link>
        <div><h1 className="text-2xl font-headline font-bold uppercase tracking-tighter flex items-center gap-2 text-primary"><Scroll className="w-6 h-6 text-primary" /> {t.title}</h1><p className="text-muted-foreground text-[10px] uppercase tracking-widest">{t.subtitle}</p></div>
      </header>
      <div className="space-y-1.5">
        {ownedPlayers.map((player) => {
          const onAuction = player.onTransferUntil && new Date(player.onTransferUntil).getTime() > now;
          const talentsValues = Object.values(player.proTalents || {}).map(v => normTalent(v));
          const maxTalent = Math.max(...talentsValues);
          return (
            <Card key={player.id} className={cn("glass-card border-white/5 hover:bg-white/5 cursor-pointer transition-all", onAuction && "border-yellow-500/30 bg-yellow-500/5")} onClick={() => setProfilePlayer(player)}>
              <CardContent className="p-2 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-secondary/50 border border-white/10 shrink-0"><img src={player.image} alt={player.name} className="w-full h-full object-cover" /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[11px] font-bold truncate uppercase">{player.name}</h3>
                    <Badge variant="outline" className="text-[6px] h-3 px-1 border-white/10 uppercase opacity-60">{rolesRu[player.role] || player.role}</Badge>
                    {onAuction && <Badge className="bg-yellow-500 text-black text-[6px] h-3 px-1 font-black animate-pulse uppercase">Auction</Badge>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {renderStars(maxTalent)}
                    <p className="text-[7px] text-muted-foreground font-black uppercase tracking-widest">Age: {calculateLiveAge(player.baseAge, player.hiredAt, player.birthDate).display} {t.years}</p>
                  </div>
                </div>
                <div className="flex flex-col items-center justify-center min-w-[35px] border-l border-white/5 pl-2">
                  <p className="text-[6px] font-black text-primary uppercase tracking-tighter leading-none mb-0.5">ОБЩ</p>
                  <span className="text-lg font-headline font-bold text-accent italic leading-none">{player.overallRating}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
