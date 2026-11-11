
'use client';

import { useGameState, LineupSlot } from '../../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { 
  Link as LinkIcon, ChevronLeft, ShieldCheck, 
  Info, History, Swords, Trophy, Target, AlertTriangle,
  Zap, Star, Award, ShieldAlert, User, ChevronRight, Users
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useMemo } from 'react';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';

export default function SynergyPage() {
  const { user, isUserLoading } = useUser();
  const db = useFirestore();
  const { matchHistory, language, isLoaded, lineup, ownedPlayers } = useGameState();

  // Strictly use players_v14
  const userRef = useMemoFirebase(() => user ? db && user ? doc(db, 'players_v14', user.uid) : null : null, [db, user]);
  const { data: profile } = useDoc(userRef);

  // Сыгранность считается только по официальным клубным матчам.
  // Товарищеские матчи и турниры не увеличивают этот счётчик.
  const corePlayers = useMemo(() => {
    const coreIds = (['carry', 'mid', 'offlane', 'support', 'full_support'] as LineupSlot[]).map(slot => lineup[slot]).filter(Boolean);
    return coreIds.map(id => ownedPlayers.find(p => p.id === id)).filter(Boolean) as any[];
  }, [lineup, ownedPlayers]);

  const matchStats = useMemo(() => {
    const officialByPlayer = corePlayers.map(p => Math.max(0, Number(p.chemistryMatches || 0)));
    const official = officialByPlayer.length ? Math.round(officialByPlayer.reduce((a, b) => a + b, 0) / officialByPlayer.length) : 0;
    return { official, unofficial: 0, total: official };
  }, [corePlayers]);

  const synergyValue = useMemo(() => Math.min(100, (matchStats.official / 20) * 100), [matchStats.official]);
  const synergyDisplay = synergyValue.toFixed(0);

  const squadPlayers = useMemo(() => {
    const allSlots: LineupSlot[] = ['carry','mid','offlane','support','full_support','sub_carry','sub_mid','sub_offlane','sub_support','sub_full_support','res1','res2','res3','res4','res5','res6','res7','res8'];
    return allSlots.map(slot => {
      const pId = lineup[slot];
      const player = ownedPlayers.find(p => p.id === pId);
      if (!player) return null;
      const officialMatches = Math.max(0, Number((player as any).chemistryMatches || 0));
      return { ...player, clubMatches: officialMatches, officialMatches, trainingMatches: 0, slotLabel: slot, isCore: ['carry','mid','offlane','support','full_support'].includes(slot), playerSynergy: Math.min(100, officialMatches / 20 * 100) };
    }).filter(Boolean);
  }, [lineup, ownedPlayers]);

  const t = {
    title: language === 'ru' ? "СЫГРАННОСТЬ" : "TEAM SYNERGY",
    subtitle: language === 'ru' ? "Протокол командного взаимодействия" : "Tactical cohesion protocol",
    mainCard: language === 'ru' ? "УРОВЕНЬ СВЯЗИ ОСНОВЫ" : "CORE COHESION LEVEL",
    officialOnly: language === 'ru' ? "Учитываются только официальные клубные матчи" : "20 official club matches = 100%",
    league: language === 'ru' ? "Оф. Матчи" : "Official",
    cup: language === 'ru' ? "Тренировки" : "Practice",
    total: language === 'ru' ? "Всего игр" : "Total",
    squadUnits: language === 'ru' ? "ЕДИНИЦЫ СОСТАВА" : "SQUAD UNITS",
    gamesCount: language === 'ru' ? "игр" : "games",
    offShort: language === 'ru' ? "ОФ" : "OFF",
    trnShort: language === 'ru' ? "ТРН" : "TRN",
    desc: language === 'ru' 
      ? "Сыгранность рассчитывается на основе совместных выступлений основной пятерки. До 20 официальных матчей сыгранность растёт до 100%. Товарищеские матчи и турниры её не увеличивают."
      : "Synergy is calculated based on core five appearances. Up to 20 official club matches raise synergy to 100%. Friendlies and tournaments do not increase it.",
    levels: [
      { min: 0, label: language === 'ru' ? "Начальный" : "Initial", color: "text-muted-foreground" },
      { min: 10, label: language === 'ru' ? "Низкий" : "Low", color: "text-red-400" },
      { min: 25, label: language === 'ru' ? "Средний" : "Medium", color: "text-yellow-400" },
      { min: 60, label: language === 'ru' ? "Высокий" : "High", color: "text-primary" },
      { min: 100, label: language === 'ru' ? "Элитный" : "Elite", color: "text-accent" },
    ],
    rolesRu: {
      carry: "Керри", mid: "Мидер", offlane: "Танк", support: "Лес", full_support: "Саппорт",
      sub_carry: "Зап. Керри", sub_mid: "Зап. Мидер", sub_offlane: "Зап. Танк", sub_support: "Зап. Лес", sub_full_support: "Зап. Саппорт",
      res1: "Резерв", res2: "Резерв", res3: "Резерв", res4: "Резерв"
    }
  };

  const currentLevel = [...t.levels].reverse().find(l => synergyValue >= l.min) || t.levels[0];

  if (!isLoaded || isUserLoading) return <LoadingScreen />;

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-32">
      <header className="mb-6 flex items-center gap-4">
        <Link href="/roster">
          <Button variant="ghost" size="icon" className="rounded-full">
            <ChevronLeft className="w-6 h-6" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter flex items-center gap-2">
            <LinkIcon className="w-6 h-6 text-primary" />
            {t.title}
          </h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest">{t.subtitle}</p>
        </div>
      </header>

      <div className="space-y-6">
        <Card className="glass-card border-primary/20 bg-gradient-to-br from-primary/10 to-transparent overflow-hidden">
          <CardContent className="p-8 text-center flex flex-col items-center">
            <div className="relative mb-6">
              <div className="w-36 h-36 rounded-full border-4 border-white/5 flex items-center justify-center relative">
                <div 
                  className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin [animation-duration:4s]" 
                  style={{ opacity: synergyValue > 0 ? 1 : 0.2 }}
                />
                <div className="flex flex-col items-center">
                  <span className="text-4xl font-headline font-black italic text-primary">{synergyDisplay}%</span>
                  <p className="text-[8px] font-black text-primary/60 uppercase tracking-tighter mt-1">PRECISION_SYNC</p>
                </div>
              </div>
              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-background px-4 py-1 rounded-full border border-white/10 shadow-xl">
                <p className={cn("text-[10px] font-black uppercase tracking-widest whitespace-nowrap", currentLevel.color)}>
                  {currentLevel.label} Protocol
                </p>
              </div>
            </div>
            
            <h2 className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground mb-4">
              {t.mainCard}
            </h2>

            <div className="w-full space-y-4">
              <div className="bg-secondary/30 p-4 rounded-xl border border-white/5 grid grid-cols-3 gap-2">
                <div className="text-center">
                  <p className="text-[7px] font-black text-muted-foreground uppercase mb-1">{t.league}</p>
                  <p className="text-lg font-headline font-bold text-primary">{matchStats.official}</p>
                </div>
                <div className="text-center border-x border-white/5">
                  <p className="text-[7px] font-black text-muted-foreground uppercase mb-1">{t.cup}</p>
                  <p className="text-lg font-headline font-bold text-accent">{matchStats.unofficial}</p>
                </div>
                <div className="text-center">
                  <p className="text-[7px] font-black text-muted-foreground uppercase mb-1">{t.total}</p>
                  <p className="text-lg font-headline font-bold text-white">{matchStats.total}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* СПИСОК ВСЕХ ИГРОКОВ СОСТАВА */}
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-accent flex items-center gap-2">
              <Users className="w-3.5 h-3.5" /> {t.squadUnits}
            </h3>
            <Badge variant="outline" className="text-[7px] border-white/10 opacity-50 uppercase">Syncing roster stats...</Badge>
          </div>

          <div className="space-y-2">
            {squadPlayers.length > 0 ? squadPlayers.map((player: any) => (
              <Card key={`${player.id}-${player.slotLabel}`} className={cn(
                "glass-card border-white/5 transition-all overflow-hidden",
                player.isCore ? "bg-primary/5 border-primary/20" : "bg-secondary/10"
              )}>
                <CardContent className="p-3 flex items-center justify-between">
                   <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg overflow-hidden border border-white/10 bg-background shrink-0">
                         <img src={player.image} alt="" className="w-full h-full object-cover" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-bold uppercase text-white truncate max-w-[100px]">{player.name}</h4>
                          {player.isCore && <Badge className="text-[6px] h-3 px-1 bg-primary text-primary-foreground font-black">CORE</Badge>}
                        </div>
                        <p className="text-[8px] text-muted-foreground font-black uppercase tracking-widest">
                          {(t.rolesRu as any)[player.slotLabel] || player.role}
                        </p>
                      </div>
                   </div>
                   <div className="text-right flex items-center gap-4">
                      <div className="flex flex-col items-end">
                        <p className="text-[7px] font-black text-muted-foreground uppercase tracking-tighter leading-none mb-1">{t.offShort}</p>
                        <p className="text-xs font-headline font-bold text-primary italic leading-none">{player.officialMatches}</p>
                      </div>
                      <div className="flex flex-col items-end border-l border-white/5 pl-4">
                        <p className="text-[7px] font-black text-muted-foreground uppercase tracking-tighter leading-none mb-1">{t.trnShort}</p>
                        <p className="text-xs font-headline font-bold text-accent italic leading-none">{player.trainingMatches}</p>
                      </div>
                      <div className="flex flex-col items-end border-l border-white/5 pl-4">
                        <p className="text-[7px] font-black text-primary uppercase tracking-tighter leading-none mb-1">{t.total}</p>
                        <p className="text-sm font-headline font-black text-white italic leading-none">{player.clubMatches}</p>
                      </div>
                   </div>
                </CardContent>
              </Card>
            )) : (
              <div className="py-10 text-center opacity-30 border border-dashed border-white/10 rounded-2xl flex flex-col items-center gap-4">
                 <ShieldAlert className="w-8 h-8" />
                 <p className="text-[9px] font-bold uppercase tracking-widest">No units assigned to squad slots</p>
              </div>
            )}
          </div>
        </section>

        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-4 flex gap-4">
            <Info className="w-5 h-5 text-primary shrink-0" />
            <p className="text-[10px] text-muted-foreground leading-relaxed italic">
              "{t.desc}"
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
