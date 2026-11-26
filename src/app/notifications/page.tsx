'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useGameState } from '../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  Bell, ChevronLeft, Trash2, 
  CheckCircle2, Info, 
  Swords, ShoppingCart, UserPlus, Zap, Trophy, ShieldAlert, Loader2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { LoadingScreen } from '@/components/game/LoadingScreen';

/**
 * Локальная страница уведомлений v2.0.
 * Использует данные из локального стора вместо Firebase.
 */
export default function NotificationsPage() {
  const router = useRouter();
  const { language, isLoaded, matchHistory = [] } = useGameState();
  const [isClearing, setIsClearing] = useState(false);

  // Синтезируем уведомления из истории матчей и системных событий
  const displayNotifs = useMemo(() => {
    if (!isLoaded) return [];

    const notifs = matchHistory.map(m => ({
      id: m.id,
      type: 'match',
      title: language === 'ru' ? 'Результат матча' : 'Match Result',
      description: language === 'ru' ? `Бой против ${m.opponentName} завершен.` : `Battle against ${m.opponentName} completed.`,
      createdAt: m.playedAt || m.startTime,
      read: m.seen === true
    }));

    return notifs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [isLoaded, matchHistory, language]);

  if (!isLoaded) {
    return <LoadingScreen />;
  }

  const t = {
    en: {
      title: "NOTIFICATIONS",
      subtitle: "Operational Event Log",
      markAllRead: "Read All",
      clearAll: "Clear All",
      noNotifs: "Operational status quiet",
      noNotifsDesc: "No significant tactical events detected.",
      typeMatch: "Match Event",
      clearing: "Clearing..."
    },
    ru: {
      title: "УВЕДОМЛЕНИЯ",
      subtitle: "Журнал оперативных событий",
      markAllRead: "Прочитать всё",
      clearAll: "Очистить всё",
      noNotifs: "Важных событий нет",
      noNotifsDesc: "Значимых оперативных событий не зафиксировано.",
      typeMatch: "Матчи",
      clearing: "Очистка..."
    }
  }[language as 'en' | 'ru'] || { title: "NOTIFICATIONS", subtitle: "Log" };

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-6">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon" className="rounded-full">
              <ChevronLeft className="w-6 h-6" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter flex items-center gap-2 text-white">
              <Bell className="w-6 h-6 text-primary" /> {t.title}
            </h1>
            <p className="text-muted-foreground text-[10px] uppercase tracking-widest">{t.subtitle}</p>
          </div>
        </div>
      </header>

      <div className="space-y-2">
        {displayNotifs.length > 0 ? (
          displayNotifs.map((notif) => (
            <Card 
              key={notif.id} 
              className={cn(
                "glass-card border-white/5 transition-all overflow-hidden relative cursor-pointer active:scale-[0.98]",
                !notif.read && "border-primary/20 bg-primary/5"
              )}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  <div className="p-2.5 rounded-xl bg-secondary/50 shrink-0 text-primary">
                    <Swords className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-[8px] font-black uppercase tracking-widest text-primary">{t.typeMatch}</span>
                      <span className="text-[8px] text-muted-foreground font-mono">
                        {notif.createdAt ? new Date(notif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-white leading-tight mb-1">{notif.title}</h3>
                    <p className="text-[10px] text-muted-foreground leading-relaxed italic">{notif.description}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <div className="py-20 flex flex-col items-center justify-center text-center opacity-30">
            <ShieldAlert className="w-12 h-12 text-muted-foreground mb-4" />
            <h2 className="text-xl font-headline font-bold uppercase text-white tracking-tight">{t.noNotifs}</h2>
            <p className="text-xs text-muted-foreground mt-2 max-w-[240px] leading-relaxed italic">
              {t.noNotifsDesc}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
