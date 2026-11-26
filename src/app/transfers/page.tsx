
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/firebase';
import { useGameState } from '../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  ShoppingCart, Star, Search, SlidersHorizontal, 
  Package, Coins, ChevronLeft, ChevronRight, Lock, Briefcase
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { LoadingScreen } from '@/components/game/LoadingScreen';

export default function TransfersPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const { language, isLoaded } = useGameState();

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/auth/login');
    }
  }, [user, isUserLoading, router]);

  if (isUserLoading || !isLoaded || !user) {
    return <LoadingScreen />;
  }

  const translations = {
    en: {
      title: "TRANSFER TERMINAL",
      subtitle: "Market Operations Hub",
      locked: "Restricted",
      menu: [
        { label: 'PRO Players', desc: 'Elite professional athletes market', icon: Star, active: true, href: '/transfers/pro', color: 'text-yellow-500' },
        { label: 'Quick Search', desc: 'Rapid acquisition protocols', icon: Search, active: true, href: '/transfers/quick-search', color: 'text-primary' },
        { label: 'Advanced Search', desc: 'Detailed scouting filters', icon: SlidersHorizontal, active: true, href: '/transfers/advanced-search', color: 'text-accent' },
        { label: 'My Bids', desc: 'Track and re-bid on active agents', icon: Package, active: true, href: '/transfers/my-bids', color: 'text-blue-400' },
        { label: 'My Sales', desc: 'Monitor your players on auction', icon: Coins, active: true, href: '/transfers/my-sales', color: 'text-green-400' },
      ]
    },
    ru: {
      title: "ТРАНСФЕРНЫЙ ТЕРМИНАЛ",
      subtitle: "Хаб рыночных операций",
      locked: "Закрыто",
      menu: [
        { label: 'PRO-Игроки', desc: 'Рынок элитных профессионалов', icon: Star, active: true, href: '/transfers/pro', color: 'text-yellow-500' },
        { label: 'Быстрый поиск', desc: 'Протоколы мгновенного найма', icon: Search, active: true, href: '/transfers/quick-search', color: 'text-primary' },
        { label: 'Расширенный поиск', desc: 'Детальные фильтры скаутинга', icon: SlidersHorizontal, active: true, href: '/transfers/advanced-search', color: 'text-accent' },
        { label: 'Мои покупки', desc: 'Список игроков на которых вы ставили', icon: Package, active: true, href: '/transfers/my-bids', color: 'text-blue-400' },
        { label: 'Мои продажи', desc: 'Ваши игроки на трансферном рынке', icon: Coins, active: true, href: '/transfers/my-sales', color: 'text-green-400' },
      ]
    }
  };

  const t = translations[language as keyof typeof translations] || translations.ru;

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-20">
      <header className="mb-8 flex items-center gap-4">
        <Link href="/">
          <Button variant="ghost" size="icon" className="rounded-full bg-secondary/50 border border-white/5">
            <ChevronLeft className="w-6 h-6" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter flex items-center gap-2">
            <Briefcase className="w-6 h-6 text-primary" />
            {t.title}
          </h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-black opacity-50">{t.subtitle}</p>
        </div>
      </header>

      <div className="space-y-2">
        {t.menu.map((item) => {
          const content = (
            <Card 
              className={cn(
                "glass-card border-white/5 transition-all group overflow-hidden",
                item.active ? "hover:bg-white/5 cursor-pointer" : "opacity-60"
              )}
            >
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-2.5 rounded-xl bg-secondary/50 border border-white/5 group-hover:bg-primary/10 transition-colors shadow-inner">
                    <item.icon className={cn("w-5 h-5", item.active ? item.color : "text-muted-foreground")} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold uppercase group-hover:text-white transition-colors">{item.label}</h3>
                    <p className="text-[10px] text-muted-foreground font-medium leading-tight">{item.desc}</p>
                  </div>
                </div>
                {item.active ? (
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-all" />
                ) : (
                  <div className="flex flex-col items-center gap-1">
                     <Lock className="w-3 h-3 text-muted-foreground/50" />
                     <span className="text-[7px] uppercase font-bold text-muted-foreground/50">{t.locked}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          );

          if (item.active && item.href) {
            return (
              <Link key={item.label} href={item.href} className="block">
                {content}
              </Link>
            );
          }

          return (
            <div key={item.label} className={cn("block", !item.active && "cursor-not-allowed")}>
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
