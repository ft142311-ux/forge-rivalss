'use client';

import { useState, useEffect } from 'react';
import { useGameState } from '../../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { 
  ChevronLeft, Clock, Target, Zap, 
  CheckCircle2, Loader2, Info
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function YouthTrainingPage() {
  const { youthAcademyPlayers, language, isLoaded, startDailyPlayerTraining, claimDailyPlayerTraining } = useGameState();
  const [now, setNow] = useState(Date.now());
  const [selectedSkills, setSelectedSkills] = useState<Record<string, string>>({});

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!isLoaded) return <LoadingScreen />;

  const t = {
    title: language === 'ru' ? "ТРЕНИРОВКА ЮНИОРОВ" : "YOUTH TRAINING",
    subtitle: language === 'ru' ? "Интенсивный цикл развития" : "Intensive development cycle",
    start: language === 'ru' ? "НАЧАТЬ ЦИКЛ" : "START CYCLE",
    claim: language === 'ru' ? "ЗАВЕРШИТЬ" : "COMPLETE",
    finishAt: language === 'ru' ? "Завершение в" : "Finish at",
    noFocus: language === 'ru' ? "Выберите навык" : "Select Focus",
    ready: language === 'ru' ? "ГОТОВО" : "READY",
    desc: language === 'ru' 
      ? "Развивайте таланты юниоров ежедневно. 24-часовой цикл дает значительный прирост к выбранному навыку."
      : "Develop youth talents daily. 24-hour cycle provides a significant boost to the selected skill.",
    skills: {
      lastHitting: language === 'ru' ? "Добив крипов" : "Last Hitting",
      mapAwareness: language === 'ru' ? "Контроль карты" : "Map Awareness",
      positioning: language === 'ru' ? "Позиционка" : "Positioning",
      reflexes: language === 'ru' ? "Рефлексы" : "Reflexes",
      manaManagement: language === 'ru' ? "Менеджмент маны" : "Mana Management",
      objectiveControl: language === 'ru' ? "Объекты" : "Objective Control",
      communication: language === 'ru' ? "Коммуникация" : "Communication",
      tiltResistance: language === 'ru' ? "Стрессоустойчивость" : "Tilt Resistance",
      versatility: language === 'ru' ? "Универсальность" : "Versatility",
      ganking: language === 'ru' ? "Ганкинг" : "Ganking",
    }
  };

  const formatCountdown = (finishTime: string) => {
    const diff = new Date(finishTime).getTime() - now;
    if (diff <= 0) return "00:00:00";
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const calculateProgress = (finishTime: string) => {
    const total = 24 * 3600000;
    const start = new Date(finishTime).getTime() - total;
    const elapsed = now - start;
    return Math.min(Math.max((elapsed / total) * 100, 0), 100);
  };

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-32">
      <header className="mb-6 flex items-center gap-4">
        <Link href="/youth-academy">
          <Button variant="ghost" size="icon" className="rounded-full">
            <ChevronLeft className="w-6 h-6" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter flex items-center gap-2">
            <Zap className="w-6 h-6 text-primary" />
            {t.title}
          </h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest">{t.subtitle}</p>
        </div>
      </header>

      <div className="space-y-6">
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-4 flex gap-4">
            <Info className="w-5 h-5 text-primary shrink-0" />
            <p className="text-[10px] text-muted-foreground leading-relaxed italic">"{t.desc}"</p>
          </CardContent>
        </Card>

        <div className="space-y-3">
          {youthAcademyPlayers.map((player) => {
            const isConstructing = !!player.dailyTrainingFinishTime;
            const isFinished = isConstructing && now >= new Date(player.dailyTrainingFinishTime!).getTime();
            const progress = isConstructing ? calculateProgress(player.dailyTrainingFinishTime!) : 0;
            
            return (
              <Card key={player.id} className={cn(
                "glass-card border-white/5 overflow-hidden transition-all",
                isConstructing && !isFinished && "border-orange-500/20 bg-orange-500/5",
                isFinished && "border-green-500/30 bg-green-500/10"
              )}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl border border-white/10 overflow-hidden bg-secondary/50">
                        <img src={player.image} alt={player.name} className="w-full h-full object-cover" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold uppercase truncate max-w-[120px]">{player.name}</h3>
                        <Badge variant="outline" className="text-[7px] h-3 px-1 border-white/10 uppercase opacity-60">{player.role}</Badge>
                      </div>
                    </div>

                    {!isConstructing ? (
                      <div className="w-36">
                        <Select 
                          value={selectedSkills[player.id] || ""} 
                          onValueChange={(val) => setSelectedSkills(prev => ({ ...prev, [player.id]: val }))}
                        >
                          <SelectTrigger className="h-8 bg-secondary/50 border-white/5 text-[9px] font-bold uppercase tracking-tighter">
                            <SelectValue placeholder={t.noFocus} />
                          </SelectTrigger>
                          <SelectContent className="bg-card border-white/10">
                            {Object.entries(t.skills).map(([key, label]) => (
                              <SelectItem key={key} value={key} className="text-[9px] uppercase font-bold">{label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <div className="text-right">
                        {isFinished ? (
                          <Badge className="bg-green-500 text-white uppercase text-[8px] font-black">{t.ready}</Badge>
                        ) : (
                          <div className="flex flex-col items-end">
                            <span className="text-[7px] text-muted-foreground uppercase font-black">{t.finishAt}</span>
                            <span className="text-[10px] font-mono font-bold text-orange-400">{formatCountdown(player.dailyTrainingFinishTime!)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {isConstructing && (
                    <div className="mb-4 space-y-1.5">
                      <div className="flex justify-between items-center text-[8px] font-bold uppercase">
                        <span className="text-accent flex items-center gap-1">
                          <Target className="w-2.5 h-2.5" /> {t.skills[player.dailyTrainingFocus as keyof typeof t.skills]}
                        </span>
                        <span className={cn(isFinished ? "text-green-400" : "text-orange-400")}>{Math.floor(progress)}%</span>
                      </div>
                      <Progress value={progress} className={cn("h-1", isFinished ? "bg-green-500/20" : "bg-orange-500/20")} />
                    </div>
                  )}

                  {!isConstructing ? (
                    <Button 
                      className="w-full h-10 hero-gradient font-bold text-[10px] uppercase tracking-widest"
                      disabled={!selectedSkills[player.id]}
                      onClick={() => startDailyPlayerTraining(player.id, selectedSkills[player.id])}
                    >
                      <Zap className="w-3 h-3 mr-2" /> {t.start}
                    </Button>
                  ) : (
                    <Button 
                      variant={isFinished ? "default" : "outline"}
                      className={cn("w-full h-10 font-bold text-[10px] uppercase tracking-widest", isFinished ? "bg-green-600 shadow-lg" : "border-white/10 opacity-50")}
                      disabled={!isFinished}
                      onClick={() => claimDailyPlayerTraining(player.id)}
                    >
                      {isFinished ? <><CheckCircle2 className="w-3 h-3 mr-2" /> {t.claim}</> : <><Loader2 className="w-3 h-3 mr-2 animate-spin" /> TRAINING...</>}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
