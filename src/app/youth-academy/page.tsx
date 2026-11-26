
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/firebase';
import { useGameState } from '../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  Users, GraduationCap, Dumbbell, ShoppingCart,
  ChevronLeft, ChevronRight, Search, Radar
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { LoadingScreen } from '@/components/game/LoadingScreen';

export default function YouthAcademyHubPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const { language, isLoaded, scoutingCandidates } = useGameState();

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
      title: "YOUTH ACADEMY",
      subtitle: "Talent Development Hub",
      locked: "Locked",
      menu: [
        { label: 'Academy Squad', desc: 'Manage your current students', icon: Users, href: '/youth-academy/squad', active: true },
        { label: 'Scouting Terminal', desc: 'Find and recruit rising talents', icon: Radar, href: '/youth-academy/scouting', active: true, badge: scoutingCandidates?.length > 0 ? scoutingCandidates.length.toString() : null },
        { label: 'Youth Training', desc: 'Daily skill development for pupils', icon: Dumbbell, href: '/youth-academy/training', active: true },
        { label: 'Youth Transfers', desc: 'Market operations for rising stars', icon: ShoppingCart, href: '/youth-academy/transfers', active: true },
      ]
    },
    ru: {
      title: "ЮНОШЕСКАЯ АКАДЕМИЯ",
      subtitle: "Центр развития талантов",
      locked: "Закрыто",
      menu: [
        { label: 'Состав академии', desc: 'Ваши текущие ученики', icon: Users, href: '/youth-academy/squad', active: true },
        { label: 'Терминал скаутинга', desc: 'Поиск и набор новых талантов', icon: Radar, href: '/youth-academy/scouting', active: true, badge: scoutingCandidates?.length > 0 ? scoutingCandidates.length.toString() : null },
        { label: 'Тренировка юниоров', desc: 'Развитие навыков молодежи', icon: Dumbbell, href: '/youth-academy/training', active: true },
        { label: 'Трансферы юниоров', desc: 'Рынок будущих легенд', icon: ShoppingCart, href: '/youth-academy/transfers', active: true },
      ]
    }
  };

  const t = translations[language as keyof typeof translations] || translations.ru;

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-20">
      <header className="mb-6 flex items-center gap-4">
        <Link href="/">
          <Button variant="ghost" size="icon" className="rounded-full">
            <ChevronLeft className="w-6 h-6" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter flex items-center gap-2 text-primary">
            <GraduationCap className="w-6 h-6 text-primary" />
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
                  <div className="p-2.5 rounded-xl bg-secondary/50 border border-white/5 group-hover:bg-primary/20 transition-colors shadow-inner">
                    <item.icon className={cn("w-5 h-5", item.active ? "text-primary" : "text-muted-foreground")} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold uppercase group-hover:text-white transition-colors">{item.label}</h3>
                      {item.badge && (
                        <Badge className="bg-primary text-primary-foreground text-[8px] font-black h-4 px-1.5 animate-pulse">
                          {item.badge}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground font-medium">{item.desc}</p>
                  </div>
                </div>
                {item.active ? (
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-all" />
                ) : (
                  <Badge variant="outline" className="text-[8px] uppercase">{t.locked}</Badge>
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
