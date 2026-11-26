'use client';

import { useState, useEffect, useMemo } from 'react';
import { useGameState } from '../../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  ChevronLeft, Radar, Search, UserPlus, 
  Info, Zap, Star, Trophy, Sparkles, Loader2,
  Users, Target, Brain, TrendingUp, Crosshair, 
  Sword, Eye, Map, Clock, ShieldAlert, X,
  ChevronRight, RefreshCw, AlertTriangle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { Badge } from '@/components/ui/badge';
import { Player } from '../../lib/moba-data';
import { calculateLiveAge, getMoscowTime } from '@/app/lib/time-utils';
import { renderStars, STAT_KEYS } from '@/components/game/transfer-stats';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Progress } from '@/components/ui/progress';

const normTalent = (val: any) => {
  const n = Number(val);
  if (isNaN(n)) return 0;
  return n < 10 ? Math.round(n * 10) : Math.round(n);
};

export default function ScoutingPage() {
  const { 
    language, isLoaded, scoutingCandidates, lastScoutDate, 
    scoutCandidates, recruitCandidate, clearScoutingReport,
    hq, academy, youthAcademyPlayers
  } = useGameState();
  
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);

  const scoutLevel = Number(academy?.scoutsLevel || 0);

  const rolesRu: Record<string, string> = {
    'Carry': 'Керри',
    'Midlaner': 'Мидер',
    'Tank': 'Танк',
    'Jungler': 'Лес',
    'Support': 'Саппорт'
  };

  const t = {
    en: {
      title: "SCOUTING TERMINAL",
      subtitle: "Talent Discovery Hub",
      find: "INITIATE SEARCH",
      findDesc: `Academy Scout Level (${scoutLevel}) determines talent quality.`,
      reportTitle: "Active Candidates",
      expiresIn: "Cooldown Bypass Active",
      noCandidates: "Scouting sectors clear. Initiate search mission.",
      recruit: "SIGN TO ACADEMY",
      limitReached: "Academy at full capacity",
      success: "Cadet Enlisted",
      successDesc: "New talent moved to Academy squad.",
      capacity: "ACADEMY SLOTS",
      stats: "Candidate Dossier",
      close: "CLOSE",
      potential: "Potential",
      telemetry: "TALENT TELEMETRY",
      ovr: "Initial OVR",
      intel: "GENERAL INTEL",
      scoutPower: "Academy Scouts",
      proStatsLabels: {
        lastHitting: "Last Hitting",
        mapAwareness: "Map Awareness",
        positioning: "Positioning",
        reflexes: "Reflexes",
        manaManagement: "Mana Management",
        objectiveControl: "Objective Control",
        communication: "Communication",
        tiltResistance: "Tilt Resistance",
        versatility: "Versatility",
        ganking: "Ganking",
      }
    },
    ru: {
      title: "ТЕРМИНАЛ СКАУТИНГА",
      subtitle: "Центр поиска талантов",
      find: "НАЧАТЬ ПОИСК",
      findDesc: `Уровень Скаутов Академии (${scoutLevel}) влияет на качество находок.`,
      reportTitle: "Доступные кандидаты",
      expiresIn: "Bypass: Кулдаун временно отключен",
      noCandidates: "Сектора пусты. Запросите новый отчет скаутов.",
      recruit: "ЗАЧИСЛИТЬ В ШКОЛУ",
      limitReached: "Академия переполнена",
      success: "Кадет зачислен",
      successDesc: "Новый талант направлен в Юношескую школу.",
      capacity: "МЕСТА В ШКОЛЕ",
      stats: "Досье кандидата",
      close: "ЗАКРЫТЬ",
      potential: "Потенциал",
      telemetry: "ТЕЛЕМЕТРИЯ ТАЛАНТА",
      ovr: "Начальный ОБЩ",
      intel: "ОБЩИЕ ДАННЫЕ",
      scoutPower: "Скауты Академии",
      proStatsLabels: {
        lastHitting: "Добив крипов",
        mapAwareness: "Контроль карты",
        positioning: "Позиционка",
        reflexes: "Рефлексы",
        manaManagement: "Менеджмент маны",
        objectiveControl: "Объекты",
        communication: "Коммуникация",
        tiltResistance: "Стрессоустойчивость",
        versatility: "Универсальность",
        ganking: "Ганкинг",
      }
    }
  }[language as 'en' | 'ru'];

  const academyLimit = 10 + (academy.youthBootcampLevel || 0);

  const handleScout = async () => {
    setIsProcessing(true);
    setTimeout(() => {
      scoutCandidates();
      setIsProcessing(false);
      toast({ title: language === 'ru' ? "Сектора просканированы!" : "Sectors Scanned!" });
    }, 1500);
  };

  const handleRecruit = (player: Player) => {
    if (youthAcademyPlayers.length >= academyLimit) {
      toast({ title: t.limitReached, variant: "destructive" });
      return;
    }
    recruitCandidate(player.id);
    toast({ title: t.success, description: t.successDesc });
    setSelectedPlayer(null);
  };

  if (!isLoaded) return <LoadingScreen />;

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-32">
      <header className="mb-6 flex items-center gap-4">
        <Link href="/youth-academy">
          <Button variant="ghost" size="icon" className="rounded-full">
            <ChevronLeft className="w-6 h-6" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter flex items-center gap-2 text-primary">
            <Radar className="w-6 h-6 text-primary" />
            {t.title}
          </h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-black opacity-50">{t.subtitle}</p>
        </div>
      </header>

      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3">
          <Card className="glass-card border-white/5 bg-secondary/10">
            <CardContent className="p-3 text-center">
               <p className="text-[7px] font-black uppercase text-muted-foreground mb-1">{t.capacity}</p>
               <p className="text-xl font-headline font-bold text-white italic">{youthAcademyPlayers.length} / {academyLimit}</p>
            </CardContent>
          </Card>
          <Card className="glass-card border-accent/20 bg-accent/5">
            <CardContent className="p-3 text-center">
               <p className="text-[7px] font-black uppercase text-muted-foreground mb-1">{t.scoutPower}</p>
               <p className="text-xl font-headline font-bold text-accent italic">Ур {scoutLevel}</p>
            </CardContent>
          </Card>
        </div>

        <Card className={cn(
          "glass-card border-dashed border-primary/30 transition-all",
          isProcessing && "animate-pulse border-accent"
        )}>
          <CardContent className="p-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center mx-auto relative">
              {isProcessing ? <Loader2 className="w-8 h-8 text-accent animate-spin" /> : <Radar className="w-8 h-8 text-primary" />}
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold uppercase text-white">{t.find}</h3>
              <p className="text-[9px] text-muted-foreground uppercase leading-relaxed italic">{t.findDesc}</p>
            </div>
            <Button 
              className="w-full h-12 hero-gradient font-black text-[10px] tracking-widest uppercase shadow-lg shadow-primary/20"
              onClick={handleScout}
              disabled={isProcessing}
            >
              {isProcessing ? (language === 'ru' ? 'СКАНИРОВАНИЕ...' : 'SCANNING SECTORS...') : t.find}
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-3">
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-accent flex items-center gap-2 px-1">
            <Search className="w-3.5 h-3.5" /> {t.reportTitle}
          </h2>

          {scoutingCandidates && scoutingCandidates.length > 0 ? (
            <div className="space-y-2">
              {scoutingCandidates.map((player) => {
                const talentsValues = Object.values(player.proTalents || {}).map(v => normTalent(v));
                const maxTalentValue = Math.max(...talentsValues);
                
                return (
                  <Card key={player.id} className="glass-card border-white/5 hover:bg-white/5 transition-all cursor-pointer" onClick={() => setSelectedPlayer(player)}>
                    <CardContent className="p-3 flex items-center gap-4">
                      <div className="w-12 h-12 rounded-lg overflow-hidden border border-white/10 bg-secondary/50 shrink-0">
                        <img src={player.image} alt="" className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="text-xs font-bold uppercase truncate text-white">{player.name}</h4>
                          <Badge variant="outline" className="text-[6px] h-3 px-1 border-white/10 uppercase opacity-60">
                            {rolesRu[player.role] || player.role}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3">
                           {renderStars(maxTalentValue)}
                           <span className="text-[8px] font-black text-muted-foreground uppercase">{language === 'ru' ? 'ВОЗРАСТ' : 'AGE'}: {player.baseAge}</span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground/30" />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : !isProcessing && (
            <div className="py-12 text-center opacity-30 border border-dashed border-white/5 rounded-2xl flex flex-col items-center gap-4">
               <ShieldAlert className="w-8 h-8" />
               <p className="text-[8px] font-black uppercase tracking-widest leading-relaxed">
                 {t.noCandidates}
               </p>
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!selectedPlayer} onOpenChange={() => setSelectedPlayer(null)}>
        <DialogContent className="max-w-md bg-background border-white/10 p-0 overflow-hidden shadow-2xl h-[90vh] flex flex-col">
          <div className="p-4 pt-12 pb-8 bg-gradient-to-br from-primary/20 via-background to-accent/10 border-b border-white/5 relative shrink-0 text-center">
            <Button variant="ghost" size="icon" className="absolute left-4 top-10 rounded-full bg-black/20" onClick={() => setSelectedPlayer(null)}><X className="w-5 h-5" /></Button>
            <div className="relative mx-auto w-24 h-24 mb-4">
              <div className="w-full h-full rounded-2xl overflow-hidden border-2 border-primary/50 shadow-2xl bg-secondary/50">
                <img src={selectedPlayer?.image} alt="" className="w-full h-full object-cover" />
              </div>
              <div className="absolute -bottom-2 -right-2 w-10 h-10 rounded-xl bg-background border border-white/10 flex items-center justify-center shadow-xl">
                <span className="text-xl">{selectedPlayer?.country?.flag}</span>
              </div>
            </div>
            <DialogTitle className="text-2xl font-headline font-bold uppercase tracking-tight text-white leading-none">
              {selectedPlayer?.name}
            </DialogTitle>
            <div className="flex items-center justify-center gap-2 mt-2">
              <Badge className="bg-primary text-primary-foreground text-[10px] font-black uppercase px-2 h-5">
                {selectedPlayer ? (rolesRu[selectedPlayer.role] || selectedPlayer.role) : ''}
              </Badge>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-8 scrollbar-hide">
            <section className="space-y-3">
              <h3 className="text-[9px] font-black text-primary uppercase tracking-[0.2em] mb-4 flex items-center gap-2 opacity-80 px-1">
                <Info className="w-3.5 h-3.5" /> {t.intel}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between p-3 bg-secondary/10 rounded-xl border border-white/5">
                   <span className="text-[9px] font-bold text-muted-foreground uppercase">{t.ovr}</span>
                   <span className="text-sm font-headline font-bold text-accent">{selectedPlayer?.overallRating}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-secondary/10 rounded-xl border border-white/5">
                   <span className="text-[9px] font-bold text-muted-foreground uppercase">{t.potential}</span>
                   <div className="flex items-center">
                    {selectedPlayer && renderStars(Math.max(...Object.values(selectedPlayer.proTalents || {}).map(v => Number(v))))}
                   </div>
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-[9px] font-black text-accent uppercase tracking-[0.2em] mb-4 flex items-center gap-2 opacity-80 px-1">
                <Zap className="w-3.5 h-3.5" /> {t.telemetry}
              </h3>
              <div className="space-y-2">
                {STAT_KEYS.map((key) => {
                  const talentLimit = selectedPlayer ? normTalent((selectedPlayer.proTalents as any)[key]) : 0;
                  return (
                    <div key={key} className="p-3 bg-secondary/10 rounded-xl border border-white/5 flex justify-between items-center">
                      <span className="text-[9px] font-bold uppercase text-muted-foreground tracking-widest">
                        {(t.proStatsLabels as any)[key] || key.toUpperCase()}
                      </span>
                      <div className="flex items-center gap-3">
                         {renderStars(talentLimit)}
                         <span className="text-xs font-mono font-bold text-accent">{talentLimit}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          <div className="p-4 bg-secondary/20 border-t border-white/5 shrink-0">
             <Button 
               className="w-full h-14 hero-gradient font-black text-xs uppercase tracking-widest shadow-xl active:scale-95 transition-all" 
               onClick={() => selectedPlayer && handleRecruit(selectedPlayer)}
             >
               <UserPlus className="w-4 h-4 mr-2" />
               {t.recruit}
             </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
