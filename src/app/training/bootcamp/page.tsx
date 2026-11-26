
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useGameState } from '../../lib/store';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { 
  ChevronLeft, Zap, Target, Waves, Microscope, 
  Hammer, Clock, Loader2, Gem
} from 'lucide-react';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const ACCEL_CREWS = [
  { id: 1, multiplier: 2, price: 100, labelRu: 'Малая бригада (2x)', labelEn: 'Small Crew (2x)' },
  { id: 2, multiplier: 4, price: 250, labelRu: 'Средняя бригада (4x)', labelEn: 'Medium Crew (4x)' },
  { id: 3, multiplier: 8, price: 600, labelRu: 'Большая бригада (8x)', labelEn: 'Large Crew (8x)' },
];

export default function BootcampPage() {
  const { 
    bootcamp, credits, crystals, startBootcampConstruction, accelerateConstruction, checkConstructions, language, isLoaded 
  } = useGameState();
  const { toast } = useToast();
  
  const [selectedFacility, setSelectedFacility] = useState<string | null>(null);
  const [acceleratingFacility, setAcceleratingFacility] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (isLoaded) {
      const timer = setInterval(() => {
        checkConstructions();
        setNow(Date.now());
      }, 1000); 
      return () => clearInterval(timer);
    }
  }, [isLoaded, checkConstructions]);

  const labels = {
    en: {
      title: "BOOTCAMP",
      subtitle: "Intensive Team Training Base",
      confirm: "Initiate Construction",
      cost: "Investment",
      duration: "Duration",
      hours: "hours",
      level: "Ур",
      upgrade: "Upgrade",
      accelerate: "Accelerate",
      accelTitle: "Rush Bootcamp Drills",
      accelDesc: "Bring in specialized trainers and engineers to expedite the build.",
      alreadyAccelerated: "Limit reached: 1 per cycle",
      inProgress: "Construction in Progress",
      improving: "Improving...",
      finishAt: "Ready at",
      facilities: "Facilities Upgrades",
      items: {
        bootcampLevel: { label: "Main Bootcamp", desc: "Speeds up player training and makes it possible for players to reach maximum skill levels." },
        tacticsHallLevel: { label: "Tactics Hall", desc: "Makes various tactical instructions more effective and eliminates their negative consequences." },
        poolLevel: { label: "Pool & Wellness", desc: "Slows down skill decay in older players (30+) and form decay in resting players." },
        researchLevel: { label: "Research Lab", desc: "Increases training in unofficial matches and speeds up training at high skill levels." }
      }
    },
    ru: {
      title: "БУТКЕМП",
      subtitle: "База интенсивной подготовки",
      confirm: "Начать постройку",
      cost: "Инвестиции",
      duration: "Срок",
      hours: "ч",
      level: "Ур",
      upgrade: "Улучшить",
      accelerate: "Ускорить",
      accelTitle: "Ускорение буткемпа",
      accelDesc: "Привлеките профильных специалистов для ускорения работ по базе.",
      alreadyAccelerated: "Лимит: 1 за постройку",
      inProgress: "Идет строительство",
      improving: "Улучшается...",
      finishAt: "Готовность в",
      facilities: "Улучшение объектов",
      items: {
        bootcampLevel: { label: "Основной Буткемп", desc: "Ускоряет тренировку игроков и делает возможным достижение игроками максимальных уровней навыков." },
        tacticsHallLevel: { label: "Зал тактики", desc: "Делает различные тактические указания более эффективными и устраняет их негативные последствия во время матча." },
        poolLevel: { label: "Бассейн и отдых", desc: "Замедляет падение навыков у возрастных игроков (30+) и падение формы у отдыхавших игроков." },
        researchLevel: { label: "Исследования", desc: "Увеличивает рост характеристик в неофициальных матчах и ускоряет тренировку на высоких уровнях навыков." }
      }
    }
  };

  const t = labels[language as keyof typeof labels] || labels.ru;

  const calculateProgress = useCallback((id: string) => {
    const start = bootcamp.constructionStarts?.[id];
    const finish = bootcamp.constructionFinishes?.[id];
    if (!finish || !start) return 0;
    const startTime = new Date(start).getTime();
    const finishTime = new Date(finish).getTime();
    const total = finishTime - startTime;
    const elapsed = Date.now() - startTime;
    return Math.min(Math.max((elapsed / total) * 100, 0), 100);
  }, [bootcamp.constructionStarts, bootcamp.constructionFinishes]);

  const handleFacilityUpgrade = async () => {
    if (!selectedFacility) return;
    const currentLevel = (bootcamp as any)[selectedFacility];
    const cost = 40000 * (currentLevel + 1);
    if (await startBootcampConstruction(selectedFacility as any, cost)) {
      toast({ title: t.inProgress });
      setSelectedFacility(null);
    }
  };

  const handleAccelerate = async (multiplier: number) => {
    if (!acceleratingFacility) return;
    if (await accelerateConstruction('bootcamp', acceleratingFacility, multiplier, ACCEL_CREWS.find((crew) => crew.multiplier === multiplier)?.price ?? 0)) {
      toast({ title: language === 'ru' ? "Буткемп ускорен!" : "Bootcamp Rushed!" });
      setAcceleratingFacility(null);
    } else {
      toast({ title: t.alreadyAccelerated, variant: "destructive" });
    }
  };

  const facilityList = [
    { id: 'bootcampLevel', icon: Zap, color: 'text-primary' },
    { id: 'tacticsHallLevel', icon: Target, color: 'text-red-400' },
    { id: 'poolLevel', icon: Waves, color: 'text-blue-400' },
    { id: 'researchLevel', icon: Microscope, color: 'text-accent' },
  ];

  if (!isLoaded) return <LoadingScreen />;

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-6">
      <header className="mb-6 flex items-center gap-4">
        <Link href="/training">
          <Button variant="ghost" size="icon" className="rounded-full">
            <ChevronLeft className="w-6 h-6" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter">{t.title}</h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest">{t.subtitle}</p>
        </div>
      </header>

      <h2 className="text-xs font-headline font-bold text-accent uppercase tracking-[0.2em] mb-4 px-1">{t.facilities}</h2>

      <div className="space-y-3">
        {facilityList.map((item) => {
          const level = (bootcamp as any)[item.id] || 0;
          const finishTime = bootcamp.constructionFinishes?.[item.id];
          const isConstructing = !!finishTime;
          const isAccelerated = bootcamp.isAccelerated?.[item.id];
          const progress = isConstructing ? calculateProgress(item.id) : 0;
          
          return (
            <Card key={item.id} className={cn(
              "glass-card border-white/5 overflow-hidden",
              isConstructing && "bg-orange-500/5 border-orange-500/20"
            )}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={cn("p-2.5 rounded-xl bg-secondary/50", isConstructing ? "text-orange-400 animate-pulse" : item.color)}>
                      {isConstructing ? <Hammer className="w-5 h-5" /> : <item.icon className="w-5 h-5" />}
                    </div>
                    <div>
                      <h3 className="text-sm font-bold uppercase">{t.items[item.id as keyof typeof t.items].label}</h3>
                      <Badge variant="secondary" className="text-[9px] h-4 py-0 uppercase mt-1">{t.level} {level}</Badge>
                    </div>
                  </div>
                  {isConstructing && !isAccelerated ? (
                    <Button size="sm" className="bg-orange-600 hover:bg-orange-700 text-white font-black text-[9px] h-8 px-3 gap-1.5" onClick={() => setAcceleratingFacility(item.id)}>
                      <Zap className="w-3 h-3" /> {t.accelerate}
                    </Button>
                  ) : isConstructing && isAccelerated ? (
                    <Badge variant="outline" className="text-[7px] border-orange-500/50 text-orange-400">BOOSTED</Badge>
                  ) : (
                    <Button size="sm" variant="outline" className="h-9 px-3" onClick={() => setSelectedFacility(item.id)}>
                      <span className="text-[9px] uppercase font-bold text-primary">{t.upgrade}</span>
                    </Button>
                  )}
                </div>
                {isConstructing && (
                  <div className="mt-3 space-y-1">
                    <div className="flex justify-between text-[7px] uppercase font-bold text-orange-400">
                      <span>{t.improving}</span>
                      <span>{Math.floor(progress)}%</span>
                    </div>
                    <Progress value={progress} className="h-1 bg-orange-500/20" />
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!selectedFacility} onOpenChange={() => setSelectedFacility(null)}>
        {selectedFacility && (
          <DialogContent className="max-w-md bg-card border-white/10 p-0 overflow-hidden shadow-2xl">
            <div className="p-6 text-center bg-gradient-to-br from-primary/20 via-background to-accent/10 border-b border-white/5">
              <DialogTitle className="text-xl font-headline font-bold uppercase tracking-tight text-primary">
                {t.items[selectedFacility as keyof typeof t.items].label}
              </DialogTitle>
              <DialogDescription className="text-center text-xs mt-4 italic text-muted-foreground leading-relaxed bg-secondary/20 p-4 rounded-xl border border-white/5">
                {t.items[selectedFacility as keyof typeof t.items].desc}
              </DialogDescription>
            </div>
            <div className="p-6 grid grid-cols-2 gap-3">
              <div className="bg-secondary/30 p-4 rounded-2xl text-center border border-white/5">
                 <p className="text-[8px] uppercase font-black text-muted-foreground mb-1 tracking-widest">{t.cost}</p>
                 <p className="text-sm font-bold text-accent italic">€ {(40000 * (((bootcamp as any)[selectedFacility] || 0) + 1)).toLocaleString()}</p>
              </div>
              <div className="bg-secondary/30 p-4 rounded-2xl text-center border border-white/5">
                 <p className="text-[8px] uppercase font-black text-muted-foreground mb-1 tracking-widest">{t.duration}</p>
                 <p className="text-sm font-bold text-primary flex items-center justify-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {4 * (((bootcamp as any)[selectedFacility] || 0) + 1)} {t.hours}</p>
              </div>
            </div>
            <DialogFooter className="p-4 bg-secondary/20 border-t border-white/5">
              <Button className="w-full h-14 hero-gradient font-black text-[10px] uppercase tracking-[0.2em]" onClick={handleFacilityUpgrade}>
                {t.confirm}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!acceleratingFacility} onOpenChange={() => setAcceleratingFacility(null)}>
        {acceleratingFacility && (
          <DialogContent className="max-w-md bg-card border-white/10 p-0 overflow-hidden shadow-2xl">
            <div className="p-6 text-center bg-gradient-to-br from-orange-500/20 via-background to-transparent border-b border-white/5">
              <DialogTitle className="text-xl font-headline font-bold uppercase tracking-tight text-orange-400 flex items-center justify-center gap-2">
                <Zap className="w-5 h-5" /> {t.accelTitle}
              </DialogTitle>
              <DialogDescription className="text-center text-[10px] mt-2 uppercase font-black tracking-widest opacity-60">
                {t.accelDesc}
              </DialogDescription>
            </div>
            <div className="p-4 space-y-2">
              {ACCEL_CREWS.map((crew) => (
                <Card key={crew.id} className="glass-card border-white/5 hover:border-orange-500/30 cursor-pointer transition-all" onClick={() => handleAccelerate(crew.multiplier)}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold uppercase text-white">{language === 'ru' ? crew.labelRu : crew.labelEn}</h4>
                      <p className="text-[8px] text-muted-foreground uppercase font-black mt-1">Остаток времени / {crew.multiplier}</p>
                    </div>
                    <Badge className="bg-accent text-accent-foreground font-black h-8 px-3">{crew.price} 💎</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
