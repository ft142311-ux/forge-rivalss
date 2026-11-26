'use client';

import { useGameState } from '@/app/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronLeft, Zap, Gem, ScrollText, ShieldCheck, Sword, Coffee, Swords, Shield, Target, Sparkles, Flame, Eye, HeartPulse, Activity, Heart, Users } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ItemBase {
  name: string;
  label: string;
  desc: string;
  type: string;
  price: number;
  icon: any;
  color: string;
}

export default function ItemsKnowledgePage() {
  const { language } = useGameState();

  const items: ItemBase[] = [
    // Consumables
    {
      name: "Tango",
      label: "Tango",
      desc: language === 'ru' ? "Восстанавливает здоровье в течение времени. Базовый реген." : "Restores health over time. Basic regeneration tool.",
      type: "Consumable",
      price: 90,
      icon: Coffee,
      color: "text-green-400"
    },
    {
      name: "Healing Salve",
      label: "Healing Salve",
      desc: language === 'ru' ? "Быстро восстанавливает большое количество здоровья." : "Rapidly restores a large amount of health.",
      type: "Consumable",
      price: 110,
      icon: HeartPulse,
      color: "text-green-500"
    },
    {
      name: "Clarity",
      label: "Clarity",
      desc: language === 'ru' ? "Восстанавливает ману в течение времени." : "Restores mana over time.",
      type: "Consumable",
      price: 50,
      icon: Sparkles,
      color: "text-blue-400"
    },
    // Artifacts
    {
      name: "Blink Dagger",
      label: "Blink Dagger",
      desc: language === 'ru' ? "Мгновенно перемещает героя на короткое расстояние." : "Instantly teleports the hero over a short distance.",
      type: "Artifact",
      price: 2250,
      icon: Zap,
      color: "text-blue-500"
    },
    {
      name: "Power Treads",
      label: "Power Treads",
      desc: language === 'ru' ? "Дает скорость атаки и бонус к выбранному атрибуту." : "Grants attack speed and a bonus to selected attribute.",
      type: "Equipment",
      price: 1400,
      icon: Activity,
      color: "text-orange-400"
    },
    // Core
    {
      name: "Black King Bar",
      label: "Black King Bar",
      desc: language === 'ru' ? "Дает иммунитет к большинству заклинаний на 6-9 секунд." : "Grants immunity to most spells for 6-9 seconds.",
      type: "Core",
      price: 4050,
      icon: Shield,
      color: "text-yellow-500"
    },
    {
      name: "Aghanim's Scepter",
      label: "Aghanim's Scepter",
      desc: language === 'ru' ? "Улучшает ультимативную способность героя." : "Upgrades the hero's ultimate ability.",
      type: "Core",
      price: 4200,
      icon: Sparkles,
      color: "text-blue-400"
    },
    {
      name: "Manta Style",
      label: "Manta Style",
      desc: language === 'ru' ? "Создает 2 иллюзии героя для запутывания врага." : "Creates 2 illusions of the hero to confuse enemies.",
      type: "Artifact",
      price: 4600,
      icon: Users,
      color: "text-blue-300"
    },
    {
      name: "Daedalus",
      label: "Daedalus",
      desc: language === 'ru' ? "Значительно увеличивает шанс критического урона." : "Significantly increases the chance of critical strikes.",
      type: "Artifact",
      price: 5150,
      icon: Target,
      color: "text-red-400"
    },
    // Late Game / S-Tier
    {
      name: "Divine Rapier",
      label: "Divine Rapier",
      desc: language === 'ru' ? "Экстремальный урон (+350). Выпадает при смерти." : "Extreme damage (+350). Drops upon death.",
      type: "S-Tier",
      price: 5600,
      icon: Sword,
      color: "text-yellow-400"
    },
    {
      name: "Abyssal Blade",
      label: "Abyssal Blade",
      desc: language === 'ru' ? "Оглушает врага при атаке сквозь невосприимчивость." : "Stuns the target upon attack, even through immunity.",
      type: "S-Tier",
      price: 6250,
      icon: Swords,
      color: "text-slate-400"
    },
    {
      name: "Satanic",
      label: "Satanic",
      desc: language === 'ru' ? "Мгновенно дает 200% вампиризма при активации." : "Instantly grants 200% lifesteal when activated.",
      type: "S-Tier",
      price: 5050,
      icon: Heart,
      color: "text-red-600"
    }
  ];

  const t = {
    ru: {
      title: "КАТАЛОГ ПРЕДМЕТОВ",
      subtitle: "Артефакты и операционные ресурсы",
      cost: "Цена",
    },
    en: {
      title: "ITEM CATALOG",
      subtitle: "Artifacts and operational resources",
      cost: "Price",
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

      <div className="space-y-3">
        {items.map((item) => (
          <Card key={item.name} className="glass-card border-white/5 bg-secondary/10 overflow-hidden group hover:border-blue-500/30 transition-all active:scale-95 duration-75">
            <CardContent className="p-4 flex items-start gap-4">
              <div className={cn("p-2.5 rounded-xl bg-secondary/50 border border-white/5 shrink-0", item.color)}>
                <item.icon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-start mb-1">
                  <h3 className="text-xs font-bold uppercase text-white truncate">{item.label}</h3>
                  <Badge className="bg-secondary text-[6px] font-black uppercase tracking-tighter border-white/5">{item.type}</Badge>
                </div>
                <p className="text-[10px] text-muted-foreground italic leading-relaxed mb-2">
                  "{item.desc}"
                </p>
                <div className="flex items-center gap-1.5 text-yellow-500 font-mono text-[10px] font-black">
                  <div className="w-3 h-3 rounded-full bg-yellow-500/20 flex items-center justify-center">
                    <span className="text-[7px]">€</span>
                  </div>
                  {item.price.toLocaleString()}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
