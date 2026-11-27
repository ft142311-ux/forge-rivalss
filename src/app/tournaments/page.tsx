'use client';

/**
 * @fileOverview ТУРНИРНЫЙ ХАБ v2.2.
 * Исправлена работа Пробного матча (теперь полностью локально).
 */

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { useGameState } from '../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  Trophy, Medal, Swords, UserPlus, 
  Search, History, ChevronLeft, 
  ChevronRight, Loader2, XCircle, ShoppingBasket,
  Globe, Briefcase, Zap, Lock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { doc } from 'firebase/firestore';
import { createFriendlyLobbyAction, cancelFriendlyLobbyAction } from '@/app/actions/friendly-matchmaking';
import { useToast } from '@/hooks/use-toast';

export default function TournamentsPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const db = useFirestore();
  const { toast } = useToast();
  const { language, isLoaded, runTrialMatch } = useGameState();
  const [isActionLoading, setIsActionLoading] = useState(false);

  const myLobbyRef = useMemoFirebase(() => {
    if (!db || !user) return null;
    return doc(db, 'friendly_lobbies_v3', user.uid);
  }, [db, user]);
  
  const { data: myLobby, isLoading: isLobbyLoading } = useDoc(myLobbyRef);


  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/auth/register');
    }
  }, [user, isUserLoading, router]);

  if (isUserLoading || !isLoaded || !user) {
    return <LoadingScreen />;
  }

  const t = {
    en: {
      title: "TOURNAMENT HUB",
      subtitle: "Operational Terminals",
      offline: "OFFLINE: Tournament frequency jammed.",
      menu: [
        { id: 'schedule', label: myLobby?.status === 'accepted' ? 'Friendly Match Assigned' : myLobby ? 'Cancel Match' : 'Schedule Friendly', desc: myLobby?.status === 'accepted' ? 'Match assigned — cancellation unavailable' : myLobby ? 'Abort active request' : 'Wait for an opponent', icon: myLobby?.status === 'accepted' ? Lock : myLobby ? XCircle : UserPlus, color: myLobby?.status === 'accepted' ? 'text-primary' : myLobby ? 'text-red-400' : 'text-accent' },
        { id: 'open', label: 'Open Friendlies', desc: 'Browse available challenges', icon: Search, href: '/tournaments/open-friendlies', color: 'text-primary' },
        { id: 'cw', label: 'CW Basket', desc: 'Instant random pairing', icon: ShoppingBasket, href: '/tournaments/cw-basket', color: 'text-green-400' },
        { id: 'list', label: 'Open Tournaments', desc: 'Active competition schedule', icon: Globe, href: '/tournaments/open', color: 'text-blue-400' },
        { id: 'trial', label: 'Trial Match', desc: 'Instant combat test vs Bot', icon: Zap, color: 'text-yellow-500' },
        { id: 'history', label: 'Tournament History', desc: 'Official record of achievements', icon: History, href: '/tournaments/history', color: 'text-slate-400' }
      ]
    },
    ru: {
      title: "ТУРНИРНЫЙ ХАБ",
      subtitle: "Операционные терминалы",
      offline: "ОФЛАЙН: Частоты турниров заглушены.",
      menu: [
        { id: 'schedule', label: myLobby?.status === 'accepted' ? 'Тов. матч назначен' : myLobby ? 'Отменить тов. матч' : 'Назначить тов. матч', desc: myLobby?.status === 'accepted' ? 'Тов. матч уже назначен' : myLobby ? 'Прервать активный поиск' : 'Ожидать вызова соперника', icon: myLobby?.status === 'accepted' ? Lock : myLobby ? XCircle : UserPlus, color: myLobby?.status === 'accepted' ? 'text-primary' : myLobby ? 'text-red-400' : 'text-accent' },
        { id: 'open', label: 'Открытые тов. матчи', desc: 'Список доступных вызовов', icon: Search, href: '/tournaments/open-friendlies', color: 'text-primary' },
        { id: 'cw', label: 'КВ (Корзина)', desc: 'Мгновенный случайный подбор', icon: ShoppingBasket, href: '/tournaments/cw-basket', color: 'text-green-400' },
        { id: 'list', label: 'Открытые турниры', desc: 'Список активных чемпионатов', icon: Globe, href: '/tournaments/open', color: 'text-blue-400' },
        { id: 'trial', label: 'Пробный матч', desc: 'Мгновенный тест состава против Бота', icon: Zap, color: 'text-yellow-500' },
        { id: 'history', label: 'История турниров', desc: 'Архив официальных достижений', icon: History, href: '/tournaments/history', color: 'text-slate-400' }
      ]
    }
  }[language === 'ru' ? 'ru' : 'en'];

  const handleToggleLobby = async () => {
    if (!user || isActionLoading || !db) return;
    setIsActionLoading(true);
    try {
      if (myLobby?.status === 'accepted') {
        toast({
          title: language === 'ru' ? 'Тов. матч назначен' : 'Friendly match assigned',
          description: language === 'ru' ? 'Матч уже создан. Отмена недоступна.' : 'The match is already created. Cancellation is unavailable.'
        });
        return;
      }

      if (myLobby) {
        await cancelFriendlyLobbyAction(await user.getIdToken(true));
        toast({ title: language === 'ru' ? "Поиск отменен" : "Search cancelled" });
      } else {
        await createFriendlyLobbyAction(await user.getIdToken(true));
        toast({ title: language === 'ru' ? "Поиск начат" : "Search initiated" });
      }
    } finally { setIsActionLoading(false); }
  };

  const handleStartTrial = async () => {
    if (isActionLoading) return;
    setIsActionLoading(true);
    try {
      const matchId = await runTrialMatch();
      if (matchId) {
        toast({ title: language === 'ru' ? "Пробный матч завершен!" : "Trial match finished!" });
        // Матч не открывается автоматически. Он попадает в общий unread-очередь
        // и открывается вручную через «Обзор матча».
        void matchId;
      } else {
        toast({ 
          variant: "destructive",
          title: language === 'ru' ? "Ошибка" : "Error",
          description: language === 'ru' ? "Назначьте 5 игроков в основу!" : "Assign 5 players to core squad!" 
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsActionLoading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-28 pt-6 sm:px-5">
      <header className="mb-6 flex items-center gap-4 rounded-2xl border border-amber-300/15 bg-gradient-to-r from-[#201707] via-[#11131c] to-[#0a1420] p-4 shadow-[0_14px_40px_rgba(0,0,0,.3)]">
        <Link href="/">
          <Button variant="ghost" size="icon" className="rounded-full bg-secondary/50 border border-white/5">
            <ChevronLeft className="w-6 h-6" />
          </Button>
        </Link>
        <div>
          <h1 className="flex items-center gap-2 text-xl font-headline font-black uppercase tracking-tight text-white sm:text-2xl">\n            <Trophy className="h-6 w-6 text-amber-300" />
            {t.title}
          </h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-black opacity-50">{t.subtitle}</p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {t.menu.map((item) => {
          const isClickAction = item.id === 'schedule' || item.id === 'trial';
          const clickHandler = item.id === 'schedule' ? handleToggleLobby : (item.id === 'trial' ? handleStartTrial : undefined);

          const content = (
            <Card 
              key={item.id}
              onClick={clickHandler}
              className={cn(
                "glass-card min-h-[94px] border-white/10 bg-gradient-to-br from-[#111d2b]/95 to-[#090f19]/95 transition-all duration-200 group overflow-hidden cursor-pointer hover:-translate-y-0.5 hover:border-cyan-300/35 hover:shadow-[0_12px_32px_rgba(0,0,0,.3)]",
                item.id === 'schedule' && myLobby?.status === 'accepted' && "border-primary/30 bg-primary/5",
                item.id === 'schedule' && myLobby?.status === 'searching' && "border-red-500/30 bg-red-500/5"
              )}
            >
              <CardContent className="relative p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={cn("p-3 rounded-xl bg-secondary/50 border border-white/10 group-hover:bg-primary/10 transition-colors shadow-inner", item.color)}>
                    {isActionLoading && (item.id === 'schedule' || item.id === 'trial') ? <Loader2 className="w-5 h-5 animate-spin" /> : <item.icon className="w-5 h-5" />}
                  </div>
                  <div>
                    <h3 className="text-[13px] font-black uppercase tracking-wide group-hover:text-white transition-colors">{item.label}</h3>
                    <p className="mt-1 text-[11px] text-muted-foreground font-medium leading-snug">{item.desc}</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-all" />
              </CardContent>
            </Card>
          );

          if (item.href && !isClickAction) {
            return <Link key={item.id} href={item.href} className="block">{content}</Link>;
          }
          return content;
        })}
      </div>
    </div>
  );
}
