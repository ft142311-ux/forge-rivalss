'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useGameState } from '@/app/lib/store';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { 
  ChevronLeft, Loader2, Gavel, ShieldCheck, 
  Timer, Star, ShoppingCart, X, Check, Search, Info, Users,
  ChevronLeft as ChevronLeftIcon, ChevronRight as ChevronRightIcon,
  ChevronsLeft, ChevronsRight, Zap, Gem, Award, Target, Eye, Map, 
  Sparkles, Sword, Crosshair, Brain, TrendingUp, Activity, User, ShieldAlert, HeartPulse, Activity as ActivityIcon
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { placePlayerBidAction } from '@/app/actions/gameplay';
import { getMoscowTime } from '@/app/lib/time-utils';
import { TransferPlayerCard } from '@/components/game/TransferPlayerCard';

export default function QuickSearchPage() {
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
    if (!db) return null;
    return query(collection(db, 'market_v7'), where('marketType', '==', 'player'));
  }, [db]);

  const { data: agents, isLoading: isMarketLoading } = useCollection(marketQuery);

  const handleGlobalBid = useCallback(async (agent: any, amount: number) => {
    if (!user) return;
    try {
      let idToken = await user.getIdToken(true);
      const result: any = await placePlayerBidAction(idToken, String(agent.id), amount);

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
    } catch (e: any) {
      const message = String(e?.message || 'BID_FAILED');
      const revoked = message.toLowerCase().includes('id token has been revoked') ||
        message.toLowerCase().includes('token has been revoked') ||
        message.toLowerCase().includes('auth/id-token-revoked');
      toast({
        title: language === 'ru' ? 'Ошибка ставки' : 'Bid error',
        description: revoked
          ? (language === 'ru' ? 'Сессия Firebase устарела. Обновите страницу и повторите ставку.' : 'The Firebase session is stale. Refresh the page and place the bid again.')
          : message,
        variant: 'destructive'
      });
    }
  }, [user, language, toast]);

  const activeAgents = useMemo(() => {
    return (agents || [])
      .filter((agent: any) => agent?.status !== 'sold' && new Date(agent?.expiresAt || 0).getTime() > now)
      .sort((a: any, b: any) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());
  }, [agents, now]);

  if (isStoreLoaded === false || isUserLoading) return <LoadingScreen />;

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-32">
      <header className="mb-6 flex items-center gap-4">
        <Link href="/transfers"><Button variant="ghost" size="icon" className="rounded-full border border-white/5"><ChevronLeft className="w-6 h-6" /></Button></Link>
        <div><h1 className="text-2xl font-headline font-bold uppercase text-white">{language === 'ru' ? 'БЫСТРЫЙ ПОИСК' : 'QUICK SEARCH'}</h1><p className="text-muted-foreground text-[10px] uppercase font-bold opacity-60">{language === 'ru' ? 'АКТИВНЫЕ АУКЦИОНЫ ИГРОКОВ' : 'ACTIVE PLAYER AUCTIONS'}</p></div>
      </header>

      {isMarketLoading ? (
        <div className="py-20 flex justify-center opacity-60"><Loader2 className="w-8 h-8 animate-spin" /></div>
      ) : activeAgents.length > 0 ? (
        <div className="space-y-3">
          {activeAgents.map((agent: any) => (
            <TransferPlayerCard key={agent.id} agent={agent} user={user} onBid={handleGlobalBid} now={now} language={language} />
          ))}
        </div>
      ) : (
        <div className="py-20 text-center opacity-30 border border-dashed border-white/10 rounded-2xl flex flex-col items-center gap-4 p-10">
          <ShoppingCart className="w-12 h-12" />
          <p className="text-[10px] uppercase font-black">{language === 'ru' ? 'Сейчас нет игроков на трансфере' : 'No players are currently on the transfer market'}</p>
        </div>
      )}
    </div>
  );
}
