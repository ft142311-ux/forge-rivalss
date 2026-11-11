
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useGameState } from '@/app/lib/store';
import { Button } from '@/components/ui/button';
import { ChevronLeft, Loader2, Package, Search, Lock } from 'lucide-react';
import Link from 'next/link';
import { useUser, useFirestore, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { collection, query, where, doc } from 'firebase/firestore';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { placePlayerBidAction } from '@/app/actions/gameplay';
import { TransferPlayerCard } from '@/components/game/TransferPlayerCard';
import { useToast } from '@/hooks/use-toast';
import { getMoscowTime } from '@/app/lib/time-utils';

export default function MyBidsPage() {
  const { language, isLoaded: isStoreLoaded } = useGameState();
  const { user, isUserLoading } = useUser();
  const db = useFirestore();
  const { toast } = useToast();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(getMoscowTime().getTime()), 1000);
    return () => clearInterval(timer);
  }, []);

  const marketQuery = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return query(collection(db, 'market_v7'), where('bidders', 'array-contains', user.uid));
  }, [db, user?.uid]);

  const { data: agents, isLoading: isMarketLoading } = useCollection(marketQuery);
  const userDocRef = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return doc(db, 'players_v14', user.uid);
  }, [db, user?.uid]);
  
  const { data: profile } = useDoc(userDocRef);

  const handleGlobalBid = useCallback(async (agent: any, amount: number) => {
    if (!user) return;
    try {
      const idToken = await user.getIdToken(true);
      const result: any = await placePlayerBidAction(idToken, String(agent.id), Math.floor(amount));
      if (!result.success) {
        const code = String(result.error || 'BID_FAILED');
        const description = code.startsWith('MIN_BID_')
          ? (language === 'ru' ? `Минимальная ставка: €${Number(code.slice(8)).toLocaleString('ru-RU')}` : `Minimum bid: €${Number(code.slice(8)).toLocaleString('en-US')}`)
          : code.startsWith('MAX_BID_')
            ? (language === 'ru' ? `Максимальная ставка: €${Number(code.slice(8)).toLocaleString('ru-RU')}` : `Maximum bid: €${Number(code.slice(8)).toLocaleString('en-US')}`)
            : code === 'INSUFFICIENT_FUNDS'
              ? (language === 'ru' ? 'Недостаточно средств' : 'Insufficient funds')
              : code === 'AUCTION_EXPIRED'
                ? (language === 'ru' ? 'Аукцион уже завершён' : 'Auction already ended')
                : code === 'CANNOT_BID_OWN_PLAYER'
                  ? (language === 'ru' ? 'Нельзя делать ставку на своего игрока' : 'You cannot bid on your own player')
                  : code;
        toast({ title: language === 'ru' ? 'Ставка отклонена' : 'Bid rejected', description, variant: 'destructive' });
        return;
      }
      toast({
        title: language === 'ru' ? 'Ставка принята!' : 'Bid confirmed!',
        description: result.extended
          ? (language === 'ru' ? 'Окончание аукциона перенесено на 10 минут от момента ставки.' : 'Auction end moved to 10 minutes after your bid.')
          : undefined,
      });
    } catch (e: any) {
      toast({ title: language === 'ru' ? 'Ошибка ставки' : 'Bid error', description: e?.message || 'BID_FAILED', variant: 'destructive' });
    }
  }, [user, language, toast]);

  const activeBids = useMemo(() => {
    return (agents || []).filter(a => {
      if (a.isSystem && !a.id.includes('v900')) return false;
      return new Date(a.expiresAt).getTime() > now;
    }).sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());
  }, [agents, now]);

  if (isUserLoading || !isStoreLoaded) return <LoadingScreen />;

  const t = {
    title: language === 'ru' ? 'МОИ ПОКУПКИ' : 'MY BIDS',
    offline: language === 'ru' ? "ОФЛАЙН: Ваши ставки недоступны." : "OFFLINE: Personal bids restricted."
  };

  if (!db) {
    return (
      <div className="max-w-md mx-auto px-4 pt-8 text-center">
        <header className="mb-6 flex items-center gap-4 text-left">
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

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-32">
      <header className="mb-6 flex items-center gap-4">
        <Link href="/transfers">
          <Button variant="ghost" size="icon" className="rounded-full">
            <ChevronLeft className="w-6 h-6" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter text-white">
            {t.title}
          </h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-black opacity-60">Personal Bidding Records</p>
        </div>
      </header>

      <div className="space-y-3 animate-in fade-in duration-500">
        {activeBids.length > 0 ? (
          activeBids.map((agent) => (
            <TransferPlayerCard 
              key={agent.id} 
              agent={agent} 
              user={user} 
              profile={profile} 
              onBid={handleGlobalBid}
              now={now}
              language={language}
            />
          ))
        ) : (
          <div className="py-20 text-center opacity-30 text-[10px] uppercase font-black border border-dashed border-white/10 rounded-2xl flex flex-col items-center gap-4 p-10 leading-relaxed">
            <Package className="w-10 h-10" />
            <p>You haven't placed any bids on active units</p>
            <Link href="/transfers/quick-search">
              <Button variant="outline" className="h-10 text-[9px] uppercase font-black tracking-widest mt-4">
                <Search className="w-3 h-3 mr-2" /> Search Units
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
