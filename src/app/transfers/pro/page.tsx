
/**
 * @fileOverview РЫНОК PRO-ИГРОКОВ (v901).
 * Специализированная торговая площадка для элитных атлетов.
 * Работает с игроками v14.
 */

'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useGameState } from '@/app/lib/store';
import { ensureProMarketDailyDropAction, placeProMarketBidAction } from '@/app/actions/pro-market';
import { runWithFreshIdToken } from '@/lib/client-auth-action';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  ChevronLeft, Crown, Zap, Target, Trophy, Info, Users, Lock
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { useUser, useAuth, useFirestore, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { 
  collection, query, doc, where 
} from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { getMoscowTime } from '@/app/lib/time-utils';
import { TransferPlayerCard } from '@/components/game/TransferPlayerCard';
import Link from 'next/link';

export default function ProTransfersPage() {
  const { language, isLoaded: isStoreLoaded } = useGameState();
  const { user, isUserLoading } = useUser();
  const auth = useAuth();
  const db = useFirestore();
  const { toast } = useToast();
  
  const [now, setNow] = useState(Date.now());
  const initTriggeredRef = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(getMoscowTime().getTime()), 1000);
    return () => clearInterval(timer);
  }, []);

  const marketQuery = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return query(collection(db, 'market_v7'), where('isPro', '==', true));
  }, [db, user?.uid]);

  const { data: agents, isLoading: isMarketLoading } = useCollection(marketQuery);
  const userDocRef = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return doc(db, 'players_v14', user.uid);
  }, [db, user?.uid]);
  
  const { data: profile } = useDoc(userDocRef);

  useEffect(() => {
    if (!db || !user?.uid || !isStoreLoaded) return;

    if (!initTriggeredRef.current && user) {
      initTriggeredRef.current = true;
      void runWithFreshIdToken(auth, user, ensureProMarketDailyDropAction).catch((error) => {
        console.error('System legend management failed', error);
        initTriggeredRef.current = false;
      });
    }
  }, [auth, user, user?.uid, isStoreLoaded, db]);

  const handleGlobalBid = useCallback(async (agent: any, amount: number) => {
    if (!db || !user) return;

    try {
      const result = await runWithFreshIdToken(auth, user, (idToken) =>
        placeProMarketBidAction(idToken, String(agent.id), amount)
      );
      if ('error' in result) {
        throw new Error(result.error || 'BID_FAILED');
      }

      toast({
        title: language === 'ru' ? 'Ставка принята!' : 'Elite Bid Confirmed!',
        description: 'expiresAt' in result && new Date(result.expiresAt).getTime() > new Date(agent.expiresAt).getTime()
          ? (language === 'ru' ? 'Аукцион продлён на 10 минут!' : 'Auction extended by 10 minutes!')
          : undefined,
      });
    } catch (error: any) {
      const message = String(error?.message || 'BID_FAILED');
      const localized = language === 'ru'
        ? message === 'INSUFFICIENT_CRYSTALS' ? 'Недостаточно кристаллов' : message === 'BID_TOO_LOW' ? 'Ставка должна быть выше текущей' : 'Не удалось разместить ставку'
        : message === 'INSUFFICIENT_CRYSTALS' ? 'Insufficient crystals' : message === 'BID_TOO_LOW' ? 'Bid must exceed the current bid' : 'Could not place bid';
      toast({ title: localized, variant: 'destructive' });
    }
  }, [auth, user, language, toast, db]);

  const t = {
    title: language === 'ru' ? 'ЭЛИТНЫЕ ПРОФИ' : 'PRO MARKET',
    subtitle: language === 'ru' ? 'РЫНОК ЛЕГЕНДАРНЫХ АТЛЕТОВ' : 'Elite Strategic Assets',
    benefits: language === 'ru' ? 'ПРЕИМУЩЕСТВА PRO-СТАТУСА' : 'PRO UNIT ADVANTAGES',
    talent: language === 'ru' ? 'Запредельный талант (до 100 единиц)' : 'Extreme Talent (Up to 100 units)',
    tactics: language === 'ru' ? 'Тактическая точность в важных моментах' : 'Tactical Precision (Clutch moments)',
    status: language === 'ru' ? 'Высокий статус (Буст посещаемости)' : 'High Media Status (Attendance boost)',
    noUnits: language === 'ru' ? 'Все легенды законтрактованы' : 'All elite assets commissioned',
    offline: language === 'ru' ? "ОФЛАЙН: Рынок элитных атлетов недоступен." : "OFFLINE: Elite asset market restricted."
  };

  if (isUserLoading || !isStoreLoaded) return <LoadingScreen />;

  if (!db) {
    return (
      <div className="max-w-md mx-auto px-4 pt-8 text-center">
        <header className="mb-6 flex items-center gap-4">
          <Link href="/transfers"><Button variant="ghost" size="icon" className="rounded-full"><ChevronLeft className="w-6 h-6" /></Button></Link>
          <div><h1 className="text-2xl font-headline font-bold uppercase">{t.title}</h1></div>
        </header>
        <div className="py-20 opacity-30 flex flex-col items-center gap-6">
           <Lock className="w-16 h-16" />
           <p className="text-xs font-black uppercase tracking-widest">{t.offline}</p>
        </div>
      </div>
    );
  }

  const proAgents = useMemo(() => {
    if (!agents) return [];
    
    return agents.filter(a => {
      if (a.isSystem && !a.id.includes('v900')) return false;
      const expiry = new Date(a.expiresAt).getTime();
      if (expiry <= now) return false;
      return true;
    }).sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());
  }, [agents, now]);

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-32">
      <header className="mb-6 flex items-center gap-4">
        <Link href="/transfers">
          <Button variant="ghost" size="icon" className="rounded-full"><ChevronLeft className="w-6 h-6" /></Button>
        </Link>
        <div>
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter text-white flex items-center gap-2">
            <Crown className="w-6 h-6 text-yellow-500" />
            {t.title}
          </h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-bold opacity-60">
            {t.subtitle}
          </p>
        </div>
      </header>

      <div className="space-y-6">
        <Card className="glass-card border-yellow-500/30 bg-gradient-to-br from-yellow-500/10 to-transparent">
          <CardContent className="p-4 space-y-4">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-yellow-500 flex items-center gap-2">
              <Info className="w-3.5 h-3.5" /> {t.benefits}
            </h3>
            <div className="grid grid-cols-1 gap-2">
               <div className="flex items-center gap-3 text-[10px] font-bold uppercase text-white/80">
                 <Zap className="w-3.5 h-3.5 text-yellow-500" /> 
                 {t.talent}
               </div>
               <div className="flex items-center gap-3 text-[10px] font-bold uppercase text-white/80">
                 <Target className="w-3.5 h-3.5 text-primary" /> 
                 {t.tactics}
               </div>
               <div className="flex items-center gap-3 text-[10px] font-bold uppercase text-white/80">
                 <Users className="w-3.5 h-3.5 text-accent" /> 
                 {t.status}
               </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-3">
          {proAgents.length > 0 ? (
            proAgents.map((agent) => (
              <div key={agent.id} className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-yellow-500/30 to-accent/30 rounded-2xl blur opacity-30 group-hover:opacity-60 transition duration-500"></div>
                <TransferPlayerCard 
                  agent={agent} 
                  user={user} 
                  profile={profile} 
                  onBid={handleGlobalBid}
                  now={now}
                  language={language}
                />
              </div>
            ))
          ) : (
            <div className="py-20 text-center opacity-30 border border-dashed border-white/10 rounded-2xl flex flex-col items-center gap-4 p-10">
              <Trophy className="w-12 h-12" />
              <p className="text-[10px] uppercase font-black">{t.noUnits}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
