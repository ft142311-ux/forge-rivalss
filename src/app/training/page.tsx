
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/firebase';
import { useGameState } from '../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  ChevronLeft, Castle, Building2, Zap, 
  GraduationCap, HeartPulse, ChevronRight,
  ShieldAlert, Settings, Construction
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { LoadingScreen } from '@/components/game/LoadingScreen';

export default function TrainingPage() {
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

  const labels = {
    en: {
      title: "CLUB INFRASTRUCTURE",
      subtitle: "Management of organizational sectors",
      locked: "Restricted",
      facilities: [
        { id: 'arena', label: 'Arena', desc: 'Stadium management and matchday logistics', icon: Castle, active: true, href: '/training/arena', color: 'text-primary' },
        { id: 'hq', label: 'Headquarters', desc: 'Strategic operations and staff administration', icon: Building2, active: true, href: '/training/hq', color: 'text-yellow-500' },
        { id: 'bootcamp', label: 'Bootcamp', desc: 'Intensive team training and synergy drills', icon: Zap, active: true, href: '/training/bootcamp', color: 'text-accent' },
        { id: 'academy', label: 'Youth School', desc: 'Scouting and development of future talents', icon: GraduationCap, active: true, href: '/training/academy', color: 'text-blue-400' },
        { id: 'medical', label: 'Medical Center', desc: 'Hero recovery and health monitoring protocols', icon: HeartPulse, active: true, href: '/training/medical', color: 'text-red-400' },
      ]
    },
    ru: {
      title: "ИНФРАСТРУКТУРА КЛУБА",
      subtitle: "Управление секторами организации",
      locked: "Закрыто",
      facilities: [
        { id: 'arena', label: 'Арена', desc: 'Управление стадионом и логистика матчей', icon: Castle, active: true, href: '/training/arena', color: 'text-primary' },
        { id: 'hq', label: 'Главный офис', desc: 'Стратегические операции и штаб управления', icon: Building2, active: true, href: '/training/hq', color: 'text-yellow-500' },
        { id: 'bootcamp', label: 'Буткемп', desc: 'Интенсивные тренировки и отработка синергии', icon: Zap, active: true, href: '/training/bootcamp', color: 'text-accent' },
        { id: 'academy', label: 'Юношеская школа', desc: 'Поиск и развитие будущих талантов', icon: GraduationCap, active: true, href: '/training/academy', color: 'text-blue-400' },
        { id: 'medical', label: 'Медицинский центр', desc: 'Восстановление героев и мониторинг здоровья', icon: HeartPulse, active: true, href: '/training/medical', color: 'text-red-400' },
      ]
    }
  };

  const t = labels[language as keyof typeof labels] || labels.ru;

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
            <Construction className="w-6 h-6 text-primary" />
            {t.title}
          </h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-black opacity-50">{t.subtitle}</p>
        </div>
      </header>

      <div className="space-y-2">
        {t.facilities.map((facility) => (
          <Link 
            key={facility.id} 
            href={facility.active ? facility.href : '#'}
            className={cn(
              "block transition-all",
              !facility.active && "cursor-not-allowed"
            )}
          >
            <Card 
              className={cn(
                "glass-card border-white/5 transition-all group overflow-hidden",
                facility.active ? "hover:bg-white/5 cursor-pointer" : "opacity-60"
              )}
            >
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-secondary/50 border border-white/5 group-hover:bg-primary/10 transition-colors shadow-inner">
                    <facility.icon className={cn("w-6 h-6", facility.active ? facility.color : "text-muted-foreground")} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2 group-hover:text-white transition-colors">
                      {facility.label}
                      {!facility.active && <ShieldAlert className="w-3 h-3 text-destructive" />}
                    </h3>
                    <p className="text-[10px] text-muted-foreground leading-tight max-w-[200px] font-medium">
                      {facility.desc}
                    </p>
                  </div>
                </div>
                
                {facility.active ? (
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-all" />
                ) : (
                  <div className="flex flex-col items-center gap-1">
                     <span className="text-[8px] uppercase font-bold text-destructive/70 tracking-tighter">
                       {t.locked}
                     </span>
                  </div>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
