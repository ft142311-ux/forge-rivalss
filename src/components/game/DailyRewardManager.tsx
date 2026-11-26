'use client';

import { useState, useEffect, useMemo } from 'react';
import { useGameState } from '@/app/lib/store';
import { getMoscowDateString } from '@/app/lib/time-utils';
import { getDailyRewardForDay, getNextDailyRewardDay } from '@/app/lib/daily-reward';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Gem, Gift, Sparkles, CheckCircle2, Lock, Coins, Crown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePathname } from 'next/navigation';

export function DailyRewardManager() {
  const { isLoaded, language, lastRewardClaimDate, rewardDay, claimReward, selectedLeagueId, isPremium, premiumUntil } = useGameState();
  const [showReward, setShowReward] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const pathname = usePathname();
  const isPremiumActive = isPremium && Boolean(premiumUntil) && new Date(premiumUntil!).getTime() > Date.now();

  useEffect(() => {
    if (isLoaded && pathname === '/' && !!selectedLeagueId) {
      const today = getMoscowDateString();
      // Если дата получения награды не совпадает с текущим днем МСК
      if (lastRewardClaimDate !== today) {
        const timer = setTimeout(() => setShowReward(true), 1500);
        return () => clearTimeout(timer);
      }
    } else {
      setShowReward(false);
    }
  }, [isLoaded, lastRewardClaimDate, pathname, selectedLeagueId]);

  const calendarRewards = useMemo(
    () => Array.from({ length: 30 }, (_, i) => getDailyRewardForDay(i + 1)),
    [],
  );

  const nextRewardDay = getNextDailyRewardDay(rewardDay, Boolean(lastRewardClaimDate));
  const currentDayReward = getDailyRewardForDay(nextRewardDay);

  const handleClaim = async () => {
    if (isClaiming) return;
    setIsClaiming(true);
    try {
      const claimed = await claimReward();
      if (claimed) setShowReward(false);
    } finally {
      setIsClaiming(false);
    }
  };

  const t = {
    title: language === 'ru' ? "КАЛЕНДАРЬ НАГРАД" : "REWARD CALENDAR",
    subtitle: language === 'ru' ? "Заходите ежедневно для бонусов!" : "Login daily to unlock rewards!",
    claim: language === 'ru' ? "ПОЛУЧИТЬ НАГРАДУ" : "CLAIM REWARD",
    day: language === 'ru' ? "Д" : "D",
    alreadyClaimed: language === 'ru' ? "ПОЛУЧЕНО" : "CLAIMED",
    upcoming: language === 'ru' ? "СКОРО" : "UPCOMING",
    today: language === 'ru' ? "СЕГОДНЯ" : "TODAY",
    eliteBonus: language === 'ru' ? "+50 Элитных Алмазов" : "+50 Elite Diamonds",
  };

  if (!selectedLeagueId) return null;

  return (
    <Dialog open={showReward} onOpenChange={setShowReward}>
      <DialogContent className="max-w-md bg-card border-white/10 p-0 overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        <div className="p-4 text-center bg-gradient-to-br from-primary/20 via-background to-accent/10 border-b border-white/5 flex-shrink-0">
          <div className="mx-auto w-12 h-12 rounded-full bg-secondary/50 flex items-center justify-center mb-2 border-2 border-primary shadow-[0_0_15px_rgba(var(--primary),0.2)]">
            <Gift className="w-6 h-6 text-primary animate-bounce" />
          </div>
          <DialogTitle className="text-lg font-headline font-bold uppercase tracking-tight text-primary">
            {t.title}
          </DialogTitle>
          <DialogDescription className="text-[8px] text-muted-foreground mt-1 uppercase tracking-widest font-bold">
            {t.subtitle}
          </DialogDescription>
        </div>

        <div className="flex-1 p-3 overflow-y-auto scrollbar-hide">
          <div className="grid grid-cols-5 gap-1.5">
            {calendarRewards.map((reward) => {
              const isClaimed = reward.day < nextRewardDay;
              const isToday = reward.day === nextRewardDay;
              const isUpcoming = reward.day > nextRewardDay;

              return (
                <div 
                  key={reward.day}
                  className={cn(
                    "relative p-1.5 py-2.5 rounded-lg border flex flex-col items-center justify-center transition-all",
                    isClaimed ? "bg-secondary/10 border-white/5 opacity-40" : 
                    isToday ? "bg-primary/20 border-primary shadow-[0_0_10px_rgba(var(--primary),0.3)] ring-1 ring-primary/50" : 
                    "bg-secondary/40 border-white/5"
                  )}
                >
                  <span className={cn(
                    "text-[7px] font-black uppercase tracking-tighter mb-1",
                    isToday ? "text-primary" : "text-muted-foreground"
                  )}>
                    {t.day}{reward.day}
                  </span>
                  
                  <div className="space-y-0.5 text-center">
                    <div className="flex items-center justify-center gap-0.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-yellow-500/20 flex items-center justify-center">
                        <span className="text-yellow-500 text-[5px] font-bold">€</span>
                      </div>
                      <span className="text-[8px] font-bold">{(reward.credits / 1000).toFixed(0)}k</span>
                    </div>
                    <div className="flex items-center justify-center gap-0.5">
                      <Gem className={cn("w-1.5 h-1.5", isToday ? "text-accent" : "text-muted-foreground")} />
                      <span className="text-[8px] font-bold">{reward.crystals}</span>
                    </div>
                  </div>

                  {isClaimed && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[0.5px] rounded-lg">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                    </div>
                  )}
                  {isUpcoming && <div className="absolute top-0.5 right-0.5"><Lock className="w-1.5 h-1.5 text-muted-foreground/30" /></div>}
                  {isToday && <div className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[5px] font-black px-1 rounded-sm uppercase">{t.today}</div>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-4 bg-secondary/20 border-t border-white/5 flex-shrink-0">
          <div className="space-y-2 mb-4">
            <div className="p-2.5 bg-background/50 rounded-xl border border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-1.5 rounded-lg bg-primary/20"><Sparkles className="w-4 h-4 text-primary" /></div>
                <div>
                  <p className="text-[7px] uppercase font-black text-muted-foreground">{t.today} (День {nextRewardDay})</p>
                  <p className="text-[11px] font-bold text-primary">{currentDayReward.credits.toLocaleString()} € + {currentDayReward.crystals} Gems</p>
                </div>
              </div>
            </div>
            
            {isPremiumActive && (
              <div className="p-2.5 bg-yellow-500/10 rounded-xl border border-yellow-500/20 flex items-center justify-between shadow-[0_0_15px_rgba(234,179,8,0.1)]">
                <div className="flex items-center gap-3">
                  <div className="p-1.5 rounded-lg bg-yellow-500/20"><Crown className="w-4 h-4 text-yellow-500" /></div>
                  <div>
                    <p className="text-[7px] uppercase font-black text-yellow-500">Elite Reward</p>
                    <p className="text-[11px] font-bold text-yellow-500">{t.eliteBonus}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <Button 
            className="w-full h-12 hero-gradient font-black uppercase text-[10px] tracking-[0.2em] shadow-lg active:scale-95 transition-all" 
            onClick={handleClaim}
            disabled={isClaiming}
          >
            {isClaiming ? (language === 'ru' ? 'ЗАЧИСЛЕНИЕ...' : 'CREDITING...') : t.claim}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
