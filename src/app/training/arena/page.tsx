'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useGameState } from '../../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';
import { 
  ChevronLeft, MessageSquare, Coffee, ShoppingBag, 
  Monitor, Car, Lightbulb, Wallet, Clock,
  Hammer, MinusCircle, PlusCircle, Lock, Gem, Zap
} from 'lucide-react';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { PlaceHolderImages } from '@/app/lib/placeholder-images';

const ACCEL_CREWS = [
  { id: 1, multiplier: 2, price: 100, labelRu: 'Малая бригада (2x)', labelEn: 'Small Crew (2x)' },
  { id: 2, multiplier: 4, price: 250, labelRu: 'Средняя бригада (4x)', labelEn: 'Medium Crew (4x)' },
  { id: 3, multiplier: 8, price: 600, labelRu: 'Большая бригада (8x)', labelEn: 'Large Crew (8x)' },
];

export default function ArenaPage() {
  const { 
    arena, credits, crystals, startCapacityExpansion, startArenaConstruction, 
    accelerateConstruction, checkConstructions, language, isLoaded, activeLicenseTier, isPremium
  } = useGameState();
  const { toast } = useToast();
  
  const [selectedFacility, setSelectedFacility] = useState<string | null>(null);
  const [acceleratingFacility, setAcceleratingFacility] = useState<string | null>(null);
  const [showCapacityDialog, setShowCapacityDialog] = useState(false);
  const [isExpanding, setIsExpanding] = useState(false);
  const [expansionSeats, setExpansionSeats] = useState([500]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (isLoaded) {
      const timer = setInterval(() => {
        checkConstructions();
        setNow(Date.now());
      }, 5000); // Реже опрашиваем базу
      return () => clearInterval(timer);
    }
  }, [isLoaded, checkConstructions]);

  const maxArenaLevel = useMemo(() => {
    if (!arena) return 0;
    return Math.max(
      Number(arena.pressCenterLevel || 0),
      Number(arena.cafeLevel || 0),
      Number(arena.shopLevel || 0),
      Number(arena.screensLevel || 0),
      Number(arena.parkingLevel || 0),
      Number(arena.lightingLevel || 0)
    );
  }, [arena]);

  const showStarterImage = Number(maxArenaLevel) >= 0 && Number(maxArenaLevel) <= 10;
  const starterImage = (PlaceHolderImages || []).find(img => img.id === 'arena-starter')?.imageUrl;

  const isCapacityConstructing = !!arena.constructionFinishes?.capacity;

  const labels = {
    en: {
      title: "ARENA MANAGEMENT",
      subtitle: "Stadium Operations Terminal",
      capacityTitle: "Stadium Expansion",
      currentStatus: "Current Status",
      maintenance: "Support",
      expand: "Expand",
      decrease: "Decrease",
      seats: "seats",
      confirm: "Initiate Construction",
      cost: "Cost",
      duration: "Duration",
      hours: "hours",
      level: "Ур",
      upgrade: "Upgrade",
      accelerate: "Accelerate",
      accelTitle: "Speed Up Project",
      accelDesc: "Hire an elite engineering crew to finish construction faster.",
      alreadyAccelerated: "Limit reached: 1 per cycle",
      inProgress: "Construction in Progress",
      improving: "Improving...",
      finishAt: "Ready at",
      facilities: "Facility Upgrades",
      match: "SUPPORT",
      max: "Max",
      locked: "B-Tier License Required",
      items: {
        capacity: { label: "Stadium Capacity", desc: "Current stadium seating capacity." },
        pressCenterLevel: { label: "Press Center", desc: "The club receives income from TV broadcasts." },
        cafeLevel: { label: "Food Court", desc: "Allows each visitor to spend extra money." },
        shopLevel: { label: "Fan Shop", desc: "Regular income from the fan club." },
        screensLevel: { label: "Digital Screens", desc: "Slightly increases attendance and income from TV broadcasts." },
        parkingLevel: { label: "Parking", desc: "Increases stadium attendance." },
        lightingLevel: { label: "Lighting System", desc: "Eliminates the negative impact of bad weather on attendance." }
      }
    },
    ru: {
      title: "УПРАВЛЕНИЕ АРЕНОЙ",
      subtitle: "Терминал эксплуатации стадиона",
      capacityTitle: "Расширение стадиона",
      currentStatus: "Текущее состояние",
      maintenance: "Поддержка",
      expand: "Расширить",
      decrease: "Уменьшить",
      seats: "мест",
      confirm: "Начать постройку",
      cost: "Стоимость",
      duration: "Длительность",
      hours: "ч",
      level: "Ур",
      upgrade: "Улучшить",
      accelerate: "Ускорить",
      accelTitle: "Ускорение проекта",
      accelDesc: "Наймите элитную инженерную группу, чтобы завершить строительство быстрее.",
      alreadyAccelerated: "Лимит: 1 за постройку",
      inProgress: "Идет строительство",
      improving: "Улучшается...",
      finishAt: "Готовность в",
      facilities: "Улучшение объектов",
      match: "ПОДДЕРЖКА",
      max: "Макс",
      locked: "Нужна Лицензия B-Tier",
      items: {
        capacity: { label: "Вместимость стадиона", desc: "Текущая вместимость зрительских мест." },
        pressCenterLevel: { label: "Пресс-центр", desc: "Клуб получает доход от телетрансляций." },
        cafeLevel: { label: "Кафе и фуд-корт", desc: "Позволяет каждому посетителю потратить дополнительные деньги." },
        shopLevel: { label: "Магазин атрибутики", desc: "Регулярный доход от фанклуба." },
        screensLevel: { label: "Экраны и табло", desc: "Немного увеличивает посещаемость и доход от телетрансляций." },
        parkingLevel: { label: "Парковка", desc: "Увеличивает посещаемость стадиона." },
        lightingLevel: { label: "Система освещения", desc: "Устраняет негативные влияние плохой погоды на посещаемость." }
      }
    }
  };

  const t = labels[language as keyof typeof labels] || labels.ru;

  const calculateProgress = useCallback((id: string) => {
    const start = arena.constructionStarts?.[id];
    const finish = arena.constructionFinishes?.[id];
    if (!finish || !start) return 0;
    const startTime = new Date(start).getTime();
    const finishTime = new Date(finish).getTime();
    const total = finishTime - startTime;
    const elapsed = Date.now() - startTime;
    if (total <= 0) return 100;
    return Math.min(Math.max((elapsed / total) * 100, 0), 100);
  }, [arena]);

  const handleFacilityUpgrade = async () => {
    if (!selectedFacility) return;
    const currentLevel = (arena as any)[selectedFacility];
    const cost = 15000 * (currentLevel + 1);
    if (await startArenaConstruction(selectedFacility as any, cost)) {
      toast({ title: t.inProgress });
      setSelectedFacility(null);
    }
  };

  const handleAccelerate = async (multiplier: number) => {
    if (!acceleratingFacility) return;
    if (await accelerateConstruction('arena', acceleratingFacility, multiplier, ACCEL_CREWS.find(c => c.multiplier === multiplier)?.price || 0)) {
      toast({ title: language === 'ru' ? "Проект ускорен!" : "Project Accelerated!" });
      setAcceleratingFacility(null);
    } else {
      toast({ title: t.alreadyAccelerated, variant: "destructive" });
    }
  };

  const facilityList = [
    { id: 'pressCenterLevel', icon: MessageSquare, color: 'text-blue-400' },
    { id: 'cafeLevel', icon: Coffee, color: 'text-orange-400' },
    { id: 'shopLevel', icon: ShoppingBag, color: 'text-green-400' },
    { id: 'screensLevel', icon: Monitor, color: 'text-primary' },
    { id: 'parkingLevel', icon: Car, color: 'text-slate-400' },
    { id: 'lightingLevel', icon: Lightbulb, color: 'text-yellow-400' },
  ];

  if (!isLoaded) return null;

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-6">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/training">
            <Button variant="ghost" size="icon" className="rounded-full">
              <ChevronLeft className="w-6 h-6" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter">{t.title}</h1>
            <p className="text-muted-foreground text-[10px] uppercase tracking-widest">{t.subtitle}</p>
          </div>
        </div>
      </header>

      <Card className={cn(
        "glass-card mb-6 border-white/10 bg-black overflow-hidden transition-all",
        isCapacityConstructing && "border-orange-500/30 ring-1 ring-orange-500/20"
      )}>
        <CardContent className="p-0">
          {showStarterImage && starterImage && (
            <div className="w-full bg-background border-b border-white/5 overflow-hidden">
               <img src={starterImage} alt="Arena Preview" className="w-full h-auto block" loading="eager" />
            </div>
          )}

          <div className="p-4 cursor-pointer hover:bg-white/5 transition-all" onClick={() => setShowCapacityDialog(true)}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[7px] uppercase font-black text-muted-foreground tracking-[0.05em] mb-0.5 leading-none">{t.items.capacity.label}</p>
                <div className="flex items-baseline gap-1.5">
                  <p className="text-2xl font-headline font-bold text-white tracking-tighter leading-none">{arena.capacity.toLocaleString()}</p>
                  <span className="text-[8px] font-black text-primary/40 uppercase">{t.seats.toUpperCase()}</span>
                </div>
              </div>
              {isCapacityConstructing && !(arena.isAccelerated?.capacity) ? (
                <Button size="sm" className="bg-orange-600 hover:bg-orange-700 text-white font-black text-[9px] h-8 px-3 gap-1.5" onClick={(e) => { e.stopPropagation(); setAcceleratingFacility('capacity'); }}>
                  <Zap className="w-3 h-3" /> {t.accelerate}
                </Button>
              ) : !isCapacityConstructing ? (
                <div className="p-1.5 rounded-full bg-white/5 border border-white/5">
                  <PlusCircle className="w-4 h-4 text-primary/50" />
                </div>
              ) : (
                <Badge variant="outline" className="text-[7px] border-orange-500/50 text-orange-400">BOOSTED</Badge>
              )}
            </div>
            
            {isCapacityConstructing && (
              <div className="space-y-1 mt-4">
                <div className="flex justify-between text-[7px] uppercase font-black text-orange-400 tracking-widest">
                  <span>{t.improving}</span>
                  <span>{Math.floor(calculateProgress('capacity'))}%</span>
                </div>
                <Progress value={calculateProgress('capacity')} className="h-1 bg-orange-500/10" />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <h2 className="text-xs font-headline font-bold text-accent uppercase tracking-[0.2em] mb-4 px-1">{t.facilities}</h2>

      <div className="space-y-3">
        {facilityList.map((item) => {
          const level = (arena as any)[item.id] || 0;
          const finishTime = arena.constructionFinishes?.[item.id];
          const isConstructing = !!finishTime;
          const isAccelerated = arena.isAccelerated?.[item.id];
          const progress = isConstructing ? calculateProgress(item.id) : 0;
          const isLevelLocked = false;
          
          return (
            <Card key={item.id} className={cn(
              "glass-card border-white/5 overflow-hidden transition-all",
              isConstructing && "bg-orange-500/5 border-orange-500/20"
            )}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={cn("p-2.5 rounded-xl bg-secondary/50", isConstructing ? "text-orange-400 animate-pulse" : item.color)}>
                      {isConstructing ? <Hammer className="w-5 h-5" /> : <item.icon className="w-5 h-5" />}
                    </div>
                    <div>
                      <h3 className="text-sm font-bold uppercase tracking-tight">{t.items[item.id as keyof typeof t.items].label}</h3>
                      <Badge variant="outline" className="text-[8px] h-4 py-0 uppercase mt-1 border-white/10 opacity-60">{t.level} {level}</Badge>
                    </div>
                  </div>
                  {isConstructing && !isAccelerated ? (
                    <Button size="sm" className="bg-orange-600 hover:bg-orange-700 text-white font-black text-[9px] h-8 px-3 gap-1.5" onClick={() => setAcceleratingFacility(item.id)}>
                      <Zap className="w-3 h-3" /> {t.accelerate}
                    </Button>
                  ) : isConstructing && isAccelerated ? (
                    <Badge variant="outline" className="text-[7px] border-orange-500/50 text-orange-400">BOOSTED</Badge>
                  ) : isLevelLocked ? (
                    <div className="flex items-center gap-1 text-[8px] font-black text-red-400 uppercase"><Lock className="w-3 h-3" /> MAX</div>
                  ) : (
                    <Button size="sm" variant="outline" className="h-9 px-4 border-white/10" onClick={() => setSelectedFacility(item.id)}>
                      <span className="text-[9px] uppercase font-black tracking-widest">{t.upgrade}</span>
                    </Button>
                  )}
                </div>
                {isConstructing && (
                  <div className="mt-4 space-y-1.5">
                    <div className="flex justify-between text-[7px] uppercase font-black text-orange-400 tracking-widest">
                      <span>{t.improving}</span>
                      <span>{Math.floor(progress)}%</span>
                    </div>
                    <Progress value={progress} className="h-1 bg-orange-500/10" />
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
              <div className="bg-secondary/30 p-4 rounded-2xl text-center border border-white/5 shadow-inner">
                 <p className="text-[8px] uppercase font-black text-muted-foreground mb-1 tracking-widest">{t.cost}</p>
                 <p className="text-sm font-bold text-accent italic">€ {(15000 * (((arena as any)[selectedFacility] || 0) + 1)).toLocaleString()}</p>
              </div>
              <div className="bg-secondary/30 p-4 rounded-2xl text-center border border-white/5 shadow-inner">
                 <p className="text-[8px] uppercase font-black text-muted-foreground mb-1 tracking-widest">{t.duration}</p>
                 <p className="text-sm font-bold text-primary flex items-center justify-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {4 * (((arena as any)[selectedFacility] || 0) + 1)} {t.hours}</p>
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
