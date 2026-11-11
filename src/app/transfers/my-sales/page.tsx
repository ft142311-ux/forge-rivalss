
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useGameState } from '@/app/lib/store';
import { Button } from '@/components/ui/button';
import { ChevronLeft, Loader2, Coins, Search, Lock } from 'lucide-react';
import Link from 'next/link';
import { useUser, useFirestore, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { collection, query, where, doc } from 'firebase/firestore';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { TransferPlayerCard } from '@/components/game/TransferPlayerCard';
import { getMoscowTime } from '@/app/lib/time-utils';

export default function MySalesPage() {
  const { language, isLoaded: isStoreLoaded } = useGameState();
  const { user, isUserLoading } = useUser();
  const db = useFirestore();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(getMoscowTime().getTime()), 1000);
    return () => clearInterval(timer);
  }, []);

  const marketQuery = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return query(collection(db, 'market_v7'), where('sellerId', '==', user.uid));
  }, [db, user?.uid]);

  const { data: agents, isLoading: isMarketLoading } = useCollection(marketQuery);
  const userDocRef = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return doc(db, 'players_v14', user.uid);
  }, [db, user?.uid]);
  
  const { data: profile } = useDoc(userDocRef);

  const activeSales = useMemo(() => {
    return (agents || []).filter(a => new Date(a.expiresAt).getTime() > now)
      .sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());
  }, [agents, now]);

  if (isUserLoading || !isStoreLoaded) return <LoadingScreen />;

  const t = {
    title: language === 'ru' ? 'МОИ ПРОДАЖИ' : 'MY SALES',
    offline: language === 'ru' ? "ОФЛАЙН: Ваши лоты недоступны." : "OFFLINE: Personal listings restricted."
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
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-black opacity-60">Personal Asset Auctions</p>
        </div>
      </header>

      <div className="space-y-3 animate-in fade-in duration-500">
        {activeSales.length > 0 ? (
          activeSales.map((agent) => (
            <TransferPlayerCard 
              key={agent.id} 
              agent={agent} 
              user={user} 
              profile={profile} 
              onBid={async () => {}} // Seller cannot bid
              now={now}
              language={language}
            />
          ))
        ) : (
          <div className="py-20 text-center opacity-30 text-[10px] uppercase font-black border border-dashed border-white/10 rounded-2xl flex flex-col items-center gap-4 p-10 leading-relaxed">
            <Coins className="w-10 h-10" />
            <p>No active asset listings found</p>
            <Link href="/roster/contracts">
              <Button variant="outline" className="h-10 text-[9px] uppercase font-black tracking-widest mt-4">
                List Unit for Sale
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
