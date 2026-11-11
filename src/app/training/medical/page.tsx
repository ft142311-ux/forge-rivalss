'use client';

/**
 * @fileOverview МЕДИЦИНСКИЙ ЦЕНТР v3.
 * Удален раздел пациентов, оставлено только управление объектами инфраструктуры.
 */

import { useState, useEffect, useCallback } from 'react';
import { useGameState } from '../../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { 
  ChevronLeft, Activity, HeartPulse, Brain, FlaskConical, 
  UserCircle, Hammer, Clock, Zap, 
  Stethoscope, 
} from 'lucide-react';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { LoadingScreen } from '@/components/game/LoadingScreen';

const ACCEL_CREWS = [
  { id: 1, multiplier: 2, price: 100, labelRu: 'Малая бригада (2x)', labelEn: 'Small Crew (2x)' },
  { id: 2, multiplier: 4, price: 250, labelRu: 'Средняя бригада (4x)', labelEn: 'Medium Crew (4x)' },
  { id: 3, multiplier: 8, price: 600, labelRu: 'Большая бригада (8x)', labelEn: 'Large Crew (8x)' },
];

export default function MedicalPage() {
  const { 
    medical, startMedicalConstruction, accelerateConstruction, 
    checkConstructions, language, isLoaded 
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
      }, 5000); 
      return () => clearInterval(timer);
    }
  }, [isLoaded, checkConstructions]);

  const labels = {
    en: {
      title: "MEDICAL CENTER",
      subtitle: "Rehabilitation and Health Monitoring",
      facilitiesTitle: "Medical Infrastructure",
      confirm: "Initiate Project",
      cost: "Investment",
      duration: "Timeframe",
      hours: "hours",
      level: "Ур",
      upgrade: "Modernize",
      accelerate: "Accelerate",
      improving: "Improving...",
      items: {
        physiotherapyLevel: { label: "Physiotherapy", desc: "Improves the physical condition of your players, preventing injuries." },
        massageLevel: { label: "Massage Room", desc: "Speeds up player fatigue recovery between matches." },
        psychiatristLevel: { label: "Psychiatrist", desc: "Reduces player fatigue after matches." },
        labLevel: { label: "Medical Lab", desc: "Speeds up the healing process for all injuries." },
        psychologistLevel: { label: "Psychologist", desc: "Slightly speeds up training in unofficial matches." }
      },
      accelTitle: "Rush Medical Project",
      accelDesc: "Bring in specialized medical equipment contractors to speed up work."
    },
    ru: {
      title: "МЕДИЦИНСКИЙ ЦЕНТР",
      subtitle: "Реабилитация и мониторинг здоровья",
      facilitiesTitle: "Медицинские объекты",
      confirm: "Начать проект",
      cost: "Инвестиции",
      duration: "Срок",
      hours: "ч",
      level: "Ур",
      upgrade: "Улучшить",
      accelerate: "Ускорить",
      improving: "Улучшается...",
      items: {
        physiotherapyLevel: { label: "Физиотерапия", desc: "Улучшает физическое состояние игроков, предупреждая травмы." },
        massageLevel: { label: "Массажная", desc: "Ускоряет восстановление усталости между матчами." },
        psychiatristLevel: { label: "Психиатр", desc: "Уменьшает усталость игроков после матчей." },
        labLevel: { label: "Лаборатория", desc: "Значительно ускоряет пассивное лечение всех травм." },
        psychologistLevel: { label: "Психолог", desc: "Ускоряет тренировку в неофициальных матчах." }
      },
      accelTitle: "Ускорение медцентра",
      accelDesc: "Привлеките профильных специалистов для ускорения работ по отделению."
    }
  };

  const t = labels[language as keyof typeof labels] || labels.ru;

  const calculateProgress = useCallback((id: string) => {
    const start = medical.constructionStarts?.[id];
    const finish = medical.constructionFinishes?.[id];
    if (!finish || !start) return 0;
    const startTime = new Date(start).getTime();
    const finishTime = new Date(finish).getTime();
    const total = finishTime - startTime;
    const elapsed = Date.now() - startTime;
    if (total <= 0) return 100;
    return Math.min(Math.max((elapsed / total) * 100, 0), 100);
  }, [medical.constructionStarts, medical.constructionFinishes]);

  const handleFacilityUpgrade = async () => {
    if (!selectedFacility) return;
    const cost = 30000 * (((medical as any)[selectedFacility] || 0) + 1);
    if (await startMedicalConstruction(selectedFacility as any, cost)) {
      toast({ title: language === 'ru' ? "Модернизация начата" : "Upgrade Initiated" });
      setSelectedFacility(null);
    }
  };

  const handleAccelerate = async (multiplier: number) => {
    if (!acceleratingFacility) return;
    if (await accelerateConstruction('medical', acceleratingFacility, multiplier, ACCEL_CREWS.find(c => c.multiplier === multiplier)?.price || 0)) {
      toast({ title: language === 'ru' ? "Медицина ускорена!" : "Medical Rushed!" });
      setAcceleratingFacility(null);
    } else {
      toast({ title: language === 'ru' ? "Лимит: 1 за постройку" : "Limit reached", variant: "destructive" });
    }
  };

  const facilityList = [
    { id: 'physiotherapyLevel', icon: Activity, color: 'text-green-400' },
    { id: 'massageLevel', icon: HeartPulse, color: 'text-red-400' },
    { id: 'psychiatristLevel', icon: Brain, color: 'text-purple-400' },
    { id: 'labLevel', icon: FlaskConical, color: 'text-blue-400' },
    { id: 'psychologistLevel', icon: UserCircle, color: 'text-yellow-400' },
  ];

  if (!isLoaded) return <LoadingScreen />;

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-32">
      <header className="mb-8 flex items-center gap-4">
        <Link href="/training">
          <Button variant="ghost" size="icon" className="rounded-full bg-secondary/50 border border-white/5">
            <ChevronLeft className="w-6 h-6" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter flex items-center gap-2 text-primary">
            <Stethoscope className="w-6 h-6 text-primary" />
            {t.title}
          </h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-black opacity-50">{t.subtitle}</p>
        </div>
      </header>

      <h2 className="text-xs font-headline font-bold text-accent uppercase tracking-[0.2em] mb-4 px-1">{t.facilitiesTitle}</h2>

      <div className="space-y-3">
        {facilityList.map((item) => {
          const level = (medical as any)[item.id] || 0;
          const finishTime = medical.constructionFinishes?.[item.id];
          const isConstructing = !!finishTime;
          const isAccelerated = medical.isAccelerated?.[item.id];
          const progress = isConstructing ? calculateProgress(item.id) : 0;
          
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

      {/* FACILITY MODAL */}
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
                 <p className="text-sm font-bold text-accent italic">€ {(30000 * (((medical as any)[selectedFacility] || 0) + 1)).toLocaleString()}</p>
              </div>
              <div className="bg-secondary/30 p-4 rounded-2xl text-center border border-white/5">
                 <p className="text-[8px] uppercase font-black text-muted-foreground mb-1 tracking-widest">{t.duration}</p>
                 <p className="text-sm font-bold text-primary flex items-center justify-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {4 * (((medical as any)[selectedFacility] || 0) + 1)} {t.hours}</p>
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

      {/* ACCELERATION MODAL */}
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
