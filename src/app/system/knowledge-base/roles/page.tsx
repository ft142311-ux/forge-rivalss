'use client';

import { useGameState } from '@/app/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronLeft, Sword, Zap, Shield, Target, HeartPulse, Sparkles, Crosshair } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export default function RolesKnowledgePage() {
  const { language } = useGameState();

  const t = {
    ru: {
      title: "РЕЕСТР РОЛЕЙ",
      subtitle: "Справочник игровых специализаций",
      roles: [
        {
          name: "Carry",
          label: "Керри",
          desc: "Основная ударная сила. Слабы в начале, но к концу игры способны уничтожить любого противника.",
          skills: ["Добив крипов", "Позиционка", "Рефлексы"],
          icon: Sword,
          color: "text-red-400"
        },
        {
          name: "Midlaner",
          label: "Мидер",
          desc: "Контролируют центр карты. Быстрее всех получают уровень и задают темп всей игре.",
          skills: ["Рефлексы", "Ганкинг", "Добив крипов"],
          icon: Sparkles,
          color: "text-blue-400"
        },
        {
          name: "Tank",
          label: "Танк",
          desc: "Мастера инициации и выживания. Принимают на себя основной урон в замесах.",
          skills: ["Объекты", "Позиционка", "Универсальность"],
          icon: Shield,
          color: "text-orange-400"
        },
        {
          name: "Jungler",
          label: "Лесник",
          desc: "Действуют скрытно. Контролируют лесные объекты и совершают неожиданные нападения.",
          skills: ["Ганкинг", "Объекты", "Рефлексы"],
          icon: Crosshair,
          color: "text-yellow-400"
        },
        {
          name: "Support",
          label: "Саппорт",
          desc: "Обеспечивают выживание команды. Обеспечивают обзор на карте и спасают союзников.",
          skills: ["Коммуникация", "Рефлексы", "Позиционка"],
          icon: HeartPulse,
          color: "text-green-400"
        }
      ]
    },
    en: {
      title: "ROLE REGISTRY",
      subtitle: "Game specialization guide",
      roles: [
        {
          name: "Carry",
          label: "Carry",
          desc: "Primary offensive force. Weak early, but capable of devastating enemies late game.",
          skills: ["Last Hitting", "Positioning", "Reflexes"],
          icon: Sword,
          color: "text-red-400"
        },
        {
          name: "Midlaner",
          label: "Midlaner",
          desc: "Center map controllers. Level up fastest and dictate the game's pace.",
          skills: ["Reflexes", "Ganking", "Last Hitting"],
          icon: Sparkles,
          color: "text-blue-400"
        },
        {
          name: "Tank",
          label: "Tank",
          desc: "Masters of initiation and survival. Absorb primary damage in teamfights.",
          skills: ["Objectives", "Positioning", "Versatility"],
          icon: Shield,
          color: "text-orange-400"
        },
        {
          name: "Jungler",
          label: "Jungler",
          desc: "Stealth operatives. Control forest objectives and execute surprise attacks.",
          skills: ["Ganking", "Objectives", "Reflexes"],
          icon: Crosshair,
          color: "text-yellow-400"
        },
        {
          name: "Support",
          label: "Support",
          desc: "Ensures team survival. Provides map vision and saves allies from death.",
          skills: ["Communication", "Reflexes", "Positioning"],
          icon: HeartPulse,
          color: "text-green-400"
        }
      ]
    }
  }[language === 'ru' ? 'ru' : 'en'];

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-32">
      <header className="mb-8 flex items-center gap-4">
        <Link href="/system">
          <Button variant="ghost" size="icon" className="rounded-full bg-secondary/50 border border-white/5">
            <ChevronLeft className="w-6 h-6" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter text-white">{t.title}</h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-black opacity-50">{t.subtitle}</p>
        </div>
      </header>

      <div className="space-y-4">
        {t.roles.map((role) => (
          <Card key={role.name} className="glass-card border-white/5 bg-secondary/10 overflow-hidden">
            <CardContent className="p-5">
              <div className="flex items-center gap-4 mb-4">
                <div className={cn("p-3 rounded-2xl bg-secondary/50 border border-white/5 shadow-inner", role.color)}>
                  <role.icon className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-headline font-bold text-white uppercase italic">{role.label}</h3>
                  <Badge variant="outline" className="text-[7px] font-black tracking-widest border-white/10 opacity-50">UNIT_TYPE_{role.name.toUpperCase()}</Badge>
                </div>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed italic mb-6">
                "{role.desc}"
              </p>
              <div className="space-y-2">
                <p className="text-[8px] font-black uppercase text-accent tracking-[0.2em]">{language === 'ru' ? 'КЛЮЧЕВЫЕ НАВЫКИ' : 'CORE COMPETENCIES'}</p>
                <div className="flex flex-wrap gap-2">
                  {role.skills.map(s => (
                    <Badge key={s} className="bg-primary/10 text-primary text-[8px] font-black uppercase tracking-wider px-3 border-primary/20">
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
