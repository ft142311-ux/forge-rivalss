'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { useGameState } from '@/app/lib/store';
import { cancelCwBasketQueueAction, joinCwBasketQueueAction } from '@/app/actions/cw-basket';
import { useToast } from '@/hooks/use-toast';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { doc } from 'firebase/firestore';
import { ChevronLeft, Loader2, Lock, Radar, ShoppingBasket, Swords, Timer, Users } from 'lucide-react';

function timestampMs(value: any): number {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value) || 0;
  return 0;
}

function countdownLabel(targetMs: number, nowMs: number): string {
  const remaining = Math.max(0, targetMs - nowMs);
  const minutes = Math.floor(remaining / 60_000).toString().padStart(2, '0');
  const seconds = Math.floor((remaining % 60_000) / 1_000).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export default function CWBasketPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const db = useFirestore();
  const { toast } = useToast();
  const { language, isLoaded } = useGameState();
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const isRussian = language === 'ru';

  const queueRef = useMemoFirebase(() => {
    if (!db || !user) return null;
    return doc(db, 'cw_basket_v2', user.uid);
  }, [db, user]);
  const { data: entry, isLoading: isEntryLoading } = useDoc(queueRef);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isUserLoading && !user) router.push('/auth/login');
  }, [user, isUserLoading, router]);

  const isMatched = entry?.status === 'matched';
  const isSearching = entry?.status === 'searching';
  const queueExpiresAt = timestampMs(entry?.expiresAt) || (timestampMs(entry?.createdAt) + 5 * 60_000);
  const isQueueExpired = isSearching && queueExpiresAt > 0 && queueExpiresAt <= now;
  const matchStartsAt = timestampMs(entry?.scheduledStartAt || entry?.matchStartTime);
  const matchCountdown = useMemo(() => countdownLabel(matchStartsAt, now), [matchStartsAt, now]);

  if (isUserLoading || !isLoaded || !user) return <LoadingScreen />;

  const t = isRussian ? {
    title: 'КВ КОРЗИНА', subtitle: 'Быстрый случайный подбор', start: 'НАЧАТЬ ПОИСК', stop: 'ОСТАНОВИТЬ ПОИСК',
    expired: 'ПОВТОРИТЬ ПОИСК', searching: 'Поиск соперника...', matched: 'СОПЕРНИК НАЙДЕН',
    opponent: 'ВАШ СОПЕРНИК', starts: 'До начала матча', scheduled: 'Матч назначен',
    delay: 'Матч будет назначен через 15 минут после подбора.',
    busy: 'Матч или другой поиск уже активен.',
    matchLocked: 'Соперник найден. Отменить назначенный матч нельзя.',
    errors: {
      CW_USER_HAS_ACTIVE_FRIENDLY_LOBBY: 'Сначала завершите или отмените поиск товарищеского матча.',
      CW_USER_HAS_ACTIVE_FRIENDLY_MATCH: 'У вас уже есть назначенный товарищеский матч.',
      CW_MATCH_ALREADY_ASSIGNED: 'Соперник уже найден. Отмена недоступна.',
      PLAYER_NOT_FOUND: 'Не удалось найти профиль клуба.',
    },
  } : {
    title: 'CW BASKET', subtitle: 'Quick random matchmaking', start: 'START SEARCH', stop: 'STOP SEARCH',
    expired: 'SEARCH AGAIN', searching: 'Searching for an opponent...', matched: 'OPPONENT FOUND',
    opponent: 'YOUR OPPONENT', starts: 'Match starts in', scheduled: 'Match scheduled',
    delay: 'The match is scheduled 15 minutes after pairing.',
    busy: 'A match or another matchmaking request is already active.',
    matchLocked: 'An opponent has been found. The scheduled match cannot be cancelled.',
    errors: {
      CW_USER_HAS_ACTIVE_FRIENDLY_LOBBY: 'Finish or cancel your friendly matchmaking request first.',
      CW_USER_HAS_ACTIVE_FRIENDLY_MATCH: 'You already have a scheduled friendly match.',
      CW_MATCH_ALREADY_ASSIGNED: 'An opponent has already been found. Cancellation is unavailable.',
      PLAYER_NOT_FOUND: 'Your club profile could not be found.',
    },
  };

  const handleToggleSearch = async () => {
    if (!user || isActionLoading) return;
    setIsActionLoading(true);
    try {
      const token = await user.getIdToken(true);
      if (isSearching && !isQueueExpired) {
        await cancelCwBasketQueueAction(token);
        toast({ title: isRussian ? 'Поиск остановлен' : 'Search stopped' });
      } else {
        const result = await joinCwBasketQueueAction(token);
        if (result.status === 'matched') {
          toast({
            title: isRussian ? 'Соперник найден!' : 'Opponent found!',
            description: result.matchedWithName || undefined,
          });
        } else {
          toast({ title: isRussian ? 'Поиск начат' : 'Search started' });
        }
      }
    } catch (error: any) {
      const code = String(error?.message || 'CW_BASKET_FAILED');
      toast({
        title: isRussian ? 'Не удалось выполнить поиск' : 'Matchmaking failed',
        description: t.errors[code as keyof typeof t.errors] || t.busy,
        variant: 'destructive',
      });
    } finally {
      setIsActionLoading(false);
    }
  };

  if (!db) {
    return (
      <div className="max-w-md mx-auto px-4 pt-8 text-center">
        <Link href="/tournaments"><Button variant="ghost" size="icon"><ChevronLeft className="w-6 h-6" /></Button></Link>
        <Lock className="w-16 h-16 mx-auto my-12 opacity-40" />
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-24">
      <header className="mb-6 flex items-center gap-4">
        <Link href="/tournaments">
          <Button variant="ghost" size="icon" className="rounded-full"><ChevronLeft className="w-6 h-6" /></Button>
        </Link>
        <div>
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter flex items-center gap-2">
            <ShoppingBasket className="w-6 h-6 text-primary" />{t.title}
          </h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest">{t.subtitle}</p>
        </div>
      </header>

      <Card className={`glass-card border-white/10 overflow-hidden ${isSearching ? 'border-primary/30 bg-primary/5' : ''} ${isMatched ? 'border-green-500/30 bg-green-500/5' : ''}`}>
        <CardContent className="p-8 text-center flex flex-col items-center min-h-[300px] justify-center">
          {isEntryLoading ? <Loader2 className="w-8 h-8 animate-spin text-primary" /> : isMatched ? (
            <>
              <div className="w-24 h-24 rounded-full bg-green-500/20 border-2 border-green-500 flex items-center justify-center mb-5">
                <Swords className="w-12 h-12 text-green-400" />
              </div>
              <h2 className="text-2xl font-headline font-bold uppercase text-white mb-2">{t.matched}</h2>
              <Badge className="bg-green-500 text-white uppercase text-[10px] mb-4">{t.scheduled}</Badge>
              <p className="text-[10px] uppercase font-black text-muted-foreground mb-2">{t.opponent}</p>
              <p className="text-xl font-headline font-bold text-primary italic uppercase mb-5">{entry?.matchedWithName || 'Manager'}</p>
              <div className="flex items-center gap-2 text-accent">
                <Timer className="w-4 h-4" />
                <p className="text-xs font-bold uppercase tracking-widest">{t.starts}: {matchCountdown}</p>
              </div>
              <p className="text-xs text-muted-foreground mt-4">{t.matchLocked}</p>
            </>
          ) : isSearching && !isQueueExpired ? (
            <>
              <div className="relative w-32 h-32 mb-6">
                <div className="absolute inset-0 rounded-full border-2 border-primary/20 animate-ping" />
                <div className="absolute inset-0 rounded-full border-2 border-primary/40 animate-pulse" />
                <div className="relative w-full h-full rounded-full bg-primary/10 flex items-center justify-center">
                  <Radar className="w-12 h-12 text-primary animate-spin" />
                </div>
              </div>
              <h2 className="text-lg font-headline font-bold text-primary uppercase animate-pulse">{t.searching}</h2>
              <p className="text-xs text-muted-foreground mt-3">{countdownLabel(queueExpiresAt, now)}</p>
            </>
          ) : (
            <>
              <Users className="w-20 h-20 mb-5 text-muted-foreground opacity-40" />
              <p className="text-xs uppercase font-black tracking-widest leading-relaxed text-muted-foreground">
                {isQueueExpired ? (isRussian ? 'Время поиска истекло. Можно начать заново.' : 'Search expired. You can start again.') : t.delay}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {!isMatched && (
        <Button
          className={`w-full h-16 mt-6 font-headline font-bold text-lg uppercase tracking-widest ${isSearching && !isQueueExpired ? 'bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20' : 'hero-gradient'}`}
          onClick={handleToggleSearch}
          disabled={isActionLoading || isEntryLoading}
        >
          {isActionLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : isSearching && !isQueueExpired ? t.stop : isQueueExpired ? t.expired : t.start}
        </Button>
      )}
    </div>
  );
}
