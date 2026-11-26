
'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useGameState, LineupSlot } from '../../lib/store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { 
  Sword, Shield, Sparkles, Plus, 
  ChevronLeft, UserPlus, X,
  ShieldCheck, Zap, HeartPulse,
  Hammer, Info, ShoppingCart, Loader2,
  Users, Target, Eye, Map, Star, Activity, User, ShieldAlert, Gem, Timer, 
  Activity as ActivityIcon, Brain, TrendingUp, Crosshair, Search
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Player } from '../../lib/moba-data';
import Link from 'next/link';
import { calculateLiveAge, getMoscowDateString, getMoscowTime } from '@/app/lib/time-utils';
import { useToast } from '@/hooks/use-toast';
import { useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { renderStars, STAT_KEYS } from '@/components/game/transfer-stats';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const normTalent = (val: any) => {
  const n = Number(val);
  if (isNaN(n)) return 0;
  return n < 10 ? Math.round(n * 10) : Math.round(n);
};

const getStatusColor = (val: number) => {
  if (val >= 100) return "text-white";
  if (val >= 75) return "text-green-400";
  if (val >= 35) return "text-yellow-400";
  return "text-red-500";
};

export default function SquadPage() {
  const { 
    ownedPlayers, youthAcademyPlayers, lineup, assignToRole, updateLineup, isLoaded, 
    language, updatePlayer, isPremium, activeLicenseTier, displayName, credits, crystals
  } = useGameState();
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();
  
  const [managedSlot, setManagedSlot] = useState<LineupSlot | null>(null);
  const [profilePlayer, setProfilePlayer] = useState<Player | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);
  const [now, setNow] = useState(Date.now());
  
  const [selectedSlotForSwap, setSelectedSlotForSwap] = useState<LineupSlot | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Use players_v14 for active profile
  const userRef = useMemoFirebase(() => (user?.uid && db ? doc(db, 'players_v14', user.uid) : null), [db, user?.uid]);
  const { data: profile } = useDoc(userRef);

  const squadLimit = useMemo(() => {
    if (isPremium) return 18;
    const tier = activeLicenseTier || 4;
    if (tier === 1) return 15;
    if (tier === 2) return 12;
    if (tier === 3) return 10;
    return 10;
  }, [isPremium, activeLicenseTier]);

  const allAvailablePlayers = useMemo(() => {
    return [...ownedPlayers, ...youthAcademyPlayers];
  }, [ownedPlayers, youthAcademyPlayers]);

  const assignedPlayerIds = useMemo(() => {
    return new Set(Object.values(lineup).filter(Boolean) as string[]);
  }, [lineup]);

  const t = {
    title: language === 'ru' ? "СОСТАВ ИГРОКОВ" : "PLAYER ROSTER",
    subtitle: language === 'ru' ? "Управление активным ростером" : "Direct roster management",
    activeLabel: language === 'ru' ? "Основа (Core 5)" : "Core Five (5)",
    subsLabel: language === 'ru' ? "Запас (Subs 5)" : "Direct Subs (5)",
    reservesLabel: language === 'ru' ? `Резерв (${squadLimit - 10})` : `Reserves (${squadLimit - 10})`,
    emptySlot: language === 'ru' ? "Назначить" : "Assign",
    teamOverall: language === 'ru' ? "ОБЩ" : "OVR",
    selectPlayer: language === 'ru' ? "Выберите игрока" : "Select player",
    availablePlayers: language === 'ru' ? "Свободные игроки" : "Available Players",
    assigned: language === 'ru' ? "ЗАНЯТ" : "ASSIGNED",
    cancel: language === 'ru' ? "ОТМЕНА" : "CANCEL",
    tooYoung: language === 'ru' ? "Игрок в Академии! Нужно 18 лет." : "In Academy! Needs age 18.",
    onAuction: language === 'ru' ? "ИГРОК НА АУКЦИОНЕ" : "PLAYER ON AUCTION",
    roleError: language === 'ru' ? "Несовместимая роль!" : "Incompatible Role!",
    swapSuccess: language === 'ru' ? "Замена произведена" : "Replacement Success",
    metrics: {
      form: language === 'ru' ? 'ФРМ' : 'FRM',
      fatigue: language === 'ru' ? 'УСТ' : 'UST',
      overall: language === 'ru' ? 'ОБЩ' : 'OVR',
    },
    roles: {
      carry: { label: language === 'ru' ? "Керри" : "Carry", icon: Sword, color: "text-red-400" },
      mid: { label: language === 'ru' ? "Мидер" : "Midlaner", icon: Sparkles, color: "text-blue-400" },
      offlane: { label: language === 'ru' ? "Танк" : "Offlaner", icon: Shield, color: "text-orange-400" },
      support: { label: language === 'ru' ? "Лес" : "Support", icon: Zap, color: "text-yellow-400" },
      full_support: { label: language === 'ru' ? "Саппорт" : "Full Support", icon: HeartPulse, color: "text-green-400" },
      
      sub_carry: { label: language === 'ru' ? "Керри" : "Carry", icon: Sword, color: "text-red-400" },
      sub_mid: { label: language === 'ru' ? "Мидер" : "Midlaner", icon: Sparkles, color: "text-blue-400" },
      sub_offlane: { label: language === 'ru' ? "Танк" : "Offlaner", icon: Shield, color: "text-orange-400" },
      sub_support: { label: language === 'ru' ? "Лес" : "Support", icon: Zap, color: "text-yellow-400" },
      sub_full_support: { label: language === 'ru' ? "Саппорт" : "Full Support", icon: HeartPulse, color: "text-green-400" },
      
      res1: { label: language === 'ru' ? "Резерв" : "Reserve", icon: User, color: "text-muted-foreground" },
      res2: { label: language === 'ru' ? "Резерв" : "Reserve", icon: User, color: "text-muted-foreground" },
      res3: { label: language === 'ru' ? "Резерв" : "Reserve", icon: User, color: "text-muted-foreground" },
      res4: { label: language === 'ru' ? "Резерв" : "Reserve", icon: User, color: "text-muted-foreground" },
      res5: { label: language === 'ru' ? "Резерв" : "Reserve", icon: User, color: "text-muted-foreground" },
      res6: { label: language === 'ru' ? "Резерв" : "Reserve", icon: User, color: "text-muted-foreground" },
      res7: { label: language === 'ru' ? "Резерв" : "Reserve", icon: User, color: "text-muted-foreground" },
      res8: { label: language === 'ru' ? "Резерв" : "Reserve", icon: User, color: "text-muted-foreground" },
    },
    proStatsLabels: {
      lastHitting: language === 'ru' ? "Добив крипов" : "Last Hitting",
      mapAwareness: language === 'ru' ? "Контроль карты" : "Map Awareness",
      positioning: language === 'ru' ? "Позиционка" : "Positioning",
      reflexes: language === 'ru' ? "Рефлексы" : "Reflexes",
      manaManagement: language === 'ru' ? "Менеджмент маны" : "Mana Management",
      objectiveControl: language === 'ru' ? "Объекты" : "Objective Control",
      communication: language === 'ru' ? "Конмуникация" : "Communication",
      tiltResistance: language === 'ru' ? "Стрессоустойчивость" : "Tilt Resistance",
      versatility: language === 'ru' ? "Универсальность" : "Versatility",
      ganking: language === 'ru' ? "Ганкинг" : "Ganking",
    }
  };

  const ALL_ROLES = ['Carry', 'Midlaner', 'Tank', 'Jungler', 'Support'];

  const roleMapping: Record<LineupSlot, string[]> = {
    carry: ['Carry'], mid: ['Midlaner'], offlane: ['Tank'], support: ['Jungler'], full_support: ['Support'],
    sub_carry: ['Carry'], sub_mid: ['Midlaner'], sub_offlane: ['Tank'], sub_support: ['Jungler'], sub_full_support: ['Support'],
    res1: ALL_ROLES, res2: ALL_ROLES, res3: ALL_ROLES, res4: ALL_ROLES, res5: ALL_ROLES, res6: ALL_ROLES, res7: ALL_ROLES, res8: ALL_ROLES,
  };

  const getPlayerById = (id: string | null) => allAvailablePlayers.find(p => p.id === id);


  const handleSlotClick = (slotKey: LineupSlot) => {
    const clickedPlayerId = lineup[slotKey];

    // First click selects the whole player block.
    // The selected block is highlighted; no automatic cycling happens.
    if (!selectedSlotForSwap) {
      if (clickedPlayerId) {
        setSelectedSlotForSwap(slotKey);
      } else {
        setManagedSlot(slotKey);
      }
      return;
    }

    // Clicking the same block cancels selection.
    if (selectedSlotForSwap === slotKey) {
      setSelectedSlotForSwap(null);
      return;
    }

    const sourcePlayerId = lineup[selectedSlotForSwap];
    const targetPlayerId = clickedPlayerId;

    // Move/swap directly between any roster blocks: a starter can be
    // replaced by a substitute and a substitute can become a starter.
    // The same mechanism also works for reserve slots.
    if (sourcePlayerId) {
      updateLineup({
        [selectedSlotForSwap]: targetPlayerId || null,
        [slotKey]: sourcePlayerId,
      });
      setSelectedSlotForSwap(null);
      toast({
        title: language === 'ru' ? 'Игрок перемещён' : 'Player moved',
        description: language === 'ru' ? 'Игроки основы и замены теперь можно менять местами.' : 'Starters and substitutes can now be swapped freely.'
      });
    }
  };

  const handlePlayerAssign = (player: Player) => {
    if (!managedSlot) return;
    if (player.onTransferUntil && new Date(player.onTransferUntil) > new Date()) {
      toast({ variant: "destructive", title: t.onAuction }); return;
    }
    if (player.isYouth) {
      toast({ variant: "destructive", title: t.tooYoung }); return;
    }
    assignToRole(managedSlot, player.id);
    setManagedSlot(null);
    toast({ title: language === 'ru' ? "Состав обновлен" : "Squad Updated" });
  };

  const activeRoleSlots: LineupSlot[] = ['carry', 'mid', 'offlane', 'support', 'full_support'];
  const slotRole: Record<string, string> = { carry: 'Carry', mid: 'Midlaner', offlane: 'Tank', support: 'Jungler', full_support: 'Support' };
  const roleFitPercent = (player: Player, slot: LineupSlot) => {
    const target = slotRole[slot];
    if (!target) return 100;
    if (player.role === target) return 100;
    const stat = player.proStats || ({} as any);
    const weights: Record<string, Record<string, number>> = {
      Carry: { lastHitting: .25, positioning: .20, reflexes: .18, tiltResistance: .13, versatility: .10 },
      Midlaner: { reflexes: .22, lastHitting: .18, ganking: .18, positioning: .15, tiltResistance: .10 },
      Tank: { objectiveControl: .24, positioning: .20, tiltResistance: .16, mapAwareness: .14, versatility: .10 },
      Jungler: { ganking: .22, objectiveControl: .18, communication: .18, mapAwareness: .15, positioning: .12 },
      Support: { communication: .22, objectiveControl: .18, positioning: .18, mapAwareness: .15, tiltResistance: .12 }
    };
    const w = weights[target] || weights.Carry;
    const values = Object.entries(w).reduce((sum, [key, weight]) => sum + Number((stat as any)[key] || 0) * weight, 0) / Math.max(.01, Object.values(w).reduce((a,b)=>a+b,0));
    const best = Object.values(stat).map(Number).filter(Number.isFinite).reduce((a,b)=>a+b,0) / Math.max(1,Object.values(stat).length);
    return Math.max(45, Math.min(100, Math.round(72 + ((values - best) / Math.max(1,best)) * 70)));
  };
  const fitColor = (fit: number) => fit >= 92 ? 'text-white' : fit >= 78 ? 'text-green-400' : fit >= 62 ? 'text-yellow-400' : 'text-red-500';
  const effectiveOverall = (player: Player, slot: LineupSlot) => {
    const fit = roleFitPercent(player, slot);
    // Correct role = full OVR. Off-role placement lowers the displayed
    // effective rating, while the player's base OVR remains unchanged.
    const multiplier = 0.75 + (fit / 100) * 0.25;
    return Math.max(1, Math.round(Number(player.overallRating || 0) * multiplier));
  };
  const teamOvr = useMemo(() => {
    const activeSlots: LineupSlot[] = ['carry', 'mid', 'offlane', 'support', 'full_support'];
    const activePlayers = activeSlots.map(slot => ({
      slot,
      player: getPlayerById(lineup[slot])
    })).filter(item => item.player) as { slot: LineupSlot; player: Player }[];
    if (activePlayers.length === 0) return 0;
    return Math.round(activePlayers.reduce((acc, item) => acc + effectiveOverall(item.player, item.slot), 0) / activePlayers.length);
  }, [lineup, allAvailablePlayers]);

  const statusLabel = (player: Player) => {
    const nowMs = Date.now();
    const suspended = !!player.suspensionUntil && new Date(player.suspensionUntil).getTime() > nowMs;
    const tilted = Number(player.tilt || 0) > 0;
    return suspended ? (language === 'ru' ? 'ДИСКВАЛИФИКАЦИЯ' : 'SUSPENDED') : tilted ? (language === 'ru' ? `ТИЛЬТ ${Math.round(Number(player.tilt))}%` : `TILT ${Math.round(Number(player.tilt))}%`) : null;
  };

  const renderSlot = (slotKey: LineupSlot) => {
    const player = getPlayerById(lineup[slotKey]);
    const roleInfo = (t.roles as any)[slotKey];
    const isSelected = selectedSlotForSwap === slotKey;

    return (
      <div key={slotKey} className="group relative">
        <Card 
          onDoubleClick={() => { if (player) setProfilePlayer(player); }}
          onClick={() => handleSlotClick(slotKey)}
          className={cn(
            "glass-card border-white/5 overflow-hidden transition-all cursor-pointer select-none", 
            player ? "bg-primary/5 border-primary/20" : "hover:bg-white/5",
            isSelected && "border-accent ring-2 ring-accent bg-accent/10 shadow-[0_0_20px_rgba(var(--accent),0.3)] animate-pulse"
          )}
        >
          <CardContent className="p-2 flex items-center justify-between gap-3 relative">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="relative shrink-0">
                <div className={cn("w-10 h-10 rounded-lg border flex items-center justify-center bg-secondary/50 overflow-hidden", player ? "border-primary/50" : "border-dashed border-muted")}>
                  {player ? <img src={player.image} alt="" className="w-full h-full object-cover" /> : <roleInfo.icon className={cn("w-4 h-4", roleInfo.color)} />}
                </div>
                {player && <div className="absolute -bottom-1 -right-1 bg-background rounded-full p-0.5 border border-white/10 shadow-lg"><roleInfo.icon className={cn("w-2 h-2", roleInfo.color)} /></div>}
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn("text-[7px] uppercase font-black tracking-widest", player ? "text-primary" : "text-muted-foreground")}>{roleInfo.label}</p>
                <h3 className={cn("text-[11px] font-bold leading-tight truncate", player && statusLabel(player) && "text-red-400")}>{player ? player.name : t.emptySlot}</h3>
                {player && <div className="flex items-center gap-1 mt-0.5">
                  <span className={cn("text-[7px] font-black uppercase", fitColor(roleFitPercent(player, slotKey)))}>
                    {language === 'ru' ? `РОЛЬ ${roleFitPercent(player, slotKey)}%` : `ROLE ${roleFitPercent(player, slotKey)}%`}
                  </span>
                  {statusLabel(player) && <span className="text-[7px] font-black uppercase text-red-500">• {statusLabel(player)}</span>}
                </div>}
              </div>
            </div>
            
            {player && (
              <div className="flex items-center gap-3 shrink-0 border-l border-white/5 pl-3">
                <div className="flex flex-col items-center min-w-[24px]">
                  <p className="text-[6px] font-black text-muted-foreground uppercase tracking-tighter mb-0.5">{t.metrics.form}</p>
                  <span className={cn("text-lg font-headline font-bold italic", getStatusColor(player.form))}>{player.form}</span>
                </div>
                <div className="flex flex-col items-center min-w-[24px]">
                  <p className="text-[6px] font-black text-muted-foreground uppercase tracking-tighter mb-0.5">{t.metrics.fatigue}</p>
                  <span className={cn("text-lg font-headline font-bold italic", getStatusColor(player.fatigue))}>{player.fatigue}</span>
                </div>
                <div className="flex flex-col items-center min-w-[28px]">
                  <p className="text-[6px] font-black text-primary uppercase tracking-widest mb-0.5">{t.metrics.overall}</p>
                  <span className={cn("text-lg font-headline font-bold italic leading-none", fitColor(roleFitPercent(player, slotKey)))}>{effectiveOverall(player, slotKey)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  const reserveSlots: LineupSlot[] = [];
  for (let i = 1; i <= squadLimit - 10; i++) { reserveSlots.push(`res${i}` as LineupSlot); }

  if (!isLoaded) return <LoadingScreen />;

  const managedSlotInfo = managedSlot ? (t.roles as any)[managedSlot] : null;
  const compatiblePlayers = managedSlot ? allAvailablePlayers.filter(p => 
    !Object.values(lineup).includes(p.id) &&
    !p.isYouth &&
    (!p.onTransferUntil || new Date(p.onTransferUntil) <= new Date())
  ) : [];

  const rolesRu: Record<string, string> = {
    'Carry': 'Керри', 'Midlaner': 'Мидер', 'Tank': 'Танк', 'Jungler': 'Лес', 'Support': 'Саппорт'
  };

  const icons: Record<string, any> = {
    lastHitting: Target, mapAwareness: Eye, positioning: Map, reflexes: Zap,
    manaManagement: Sparkles, objectiveControl: Sword, communication: Users,
    tiltResistance: Brain, versatility: TrendingUp, ganking: Crosshair,
  };

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-32">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <Link href="/roster"><Button variant="ghost" size="icon" className="rounded-full shrink-0"><ChevronLeft className="w-6 h-6" /></Button></Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-headline font-black uppercase tracking-tighter truncate text-white">{profile?.clubName || t.title}</h1>
            <p className="text-muted-foreground text-[10px] uppercase tracking-widest">{t.subtitle}</p>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center min-w-[60px] shrink-0">
          <p className="text-[9px] font-black text-primary tracking-widest uppercase mb-1">{t.teamOverall}</p>
          <div className="relative flex items-center justify-center">
            <Shield className="w-10 h-10 text-primary fill-primary/10" strokeWidth={2} />
            <span className="absolute inset-0 flex items-center justify-center text-lg font-headline font-bold text-accent italic pt-0.5">{teamOvr}</span>
          </div>
        </div>
      </header>

      <div className="space-y-8">
        <section className="space-y-2">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent px-1 flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5" /> {t.activeLabel}</h2>
          <div className="space-y-1.5">{ (['carry', 'mid', 'offlane', 'support', 'full_support'] as LineupSlot[]).map(renderSlot) }</div>
        </section>
        
        <section className="space-y-2">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary/80 px-1 flex items-center gap-2"><UserPlus className="w-3.5 h-3.5" /> {t.subsLabel}</h2>
          <div className="space-y-1.5">{ (['sub_carry', 'sub_mid', 'sub_offlane', 'sub_support', 'sub_full_support'] as LineupSlot[]).map(renderSlot) }</div>
        </section>
        
        {reserveSlots.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/50 px-1 flex items-center gap-2"><Users className="w-3.5 h-3.5" /> {t.reservesLabel}</h2>
            <div className="space-y-1.5">{ reserveSlots.map(renderSlot) }</div>
          </section>
        )}
      </div>

      <Dialog open={!!managedSlot} onOpenChange={() => setManagedSlot(null)}>
        <DialogContent className="max-w-md bg-background border-white/10 p-0 overflow-hidden shadow-2xl h-[85vh] flex flex-col">
          <DialogHeader className="p-6 bg-gradient-to-br from-primary/10 to-transparent border-b border-white/5 shrink-0">
             <div className="flex items-center gap-4">
                <div className={cn("w-14 h-14 rounded-2xl bg-secondary/50 flex items-center justify-center border border-white/10 shadow-xl", managedSlotInfo?.color)}>
                  {managedSlotInfo?.icon && <managedSlotInfo.icon className="w-7 h-7" />}
                </div>
                <div>
                   <DialogTitle className="text-xl font-headline font-bold uppercase tracking-tight text-white">{managedSlotInfo?.label}</DialogTitle>
                   <DialogDescription className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">{language === 'ru' ? 'НАЖМИТЕ НА ИГРОКА, ЧТОБЫ ВЫБРАТЬ ЕГО НА ЭТУ ПОЗИЦИЮ' : 'SELECT ANY PLAYER FOR THIS POSITION'}</DialogDescription>
                </div>
             </div>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-hide">
            <section className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-[9px] font-black uppercase text-accent tracking-widest">{t.availablePlayers}</h3>
                <Badge variant="outline" className="text-[7px] border-white/10 opacity-50 uppercase">{compatiblePlayers.length} UNIT(S)</Badge>
              </div>
              {compatiblePlayers.length > 0 ? (
                <div className="grid grid-cols-1 gap-2">
                  {compatiblePlayers.map((player) => (
                    <Card key={player.id} className="glass-card border-white/5 hover:bg-white/5 cursor-pointer transition-all active:scale-[0.98]" onClick={() => handlePlayerAssign(player)}>
                      <CardContent className="p-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                           <div className="w-10 h-10 rounded-lg overflow-hidden border border-white/10 bg-secondary/30"><img src={player.image} alt="" className="w-full h-full object-cover" /></div>
                           <div>
                             <h4 className="text-xs font-bold uppercase text-white truncate max-w-[120px]">{player.name}</h4>
                             <p className="text-[8px] text-muted-foreground uppercase font-black">{player.overallRating} OVR • {player.role}</p>
                           </div>
                        </div>
                        <Button size="sm" variant="ghost" className="h-8 px-3 text-[8px] font-black uppercase text-primary"><Plus className="w-3 h-3 mr-1" /> {language === 'ru' ? 'ВЫБРАТЬ' : 'SELECT'}</Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center opacity-30 border border-dashed border-white/5 rounded-2xl flex flex-col items-center gap-4">
                   <Users className="w-8 h-8" />
                   <p className="text-[9px] font-bold uppercase tracking-widest max-w-[160px] mx-auto">No available units for this slot</p>
                </div>
              )}
            </section>
          </div>
          <div className="p-4 bg-secondary/20 border-t border-white/5 shrink-0">
             <Button variant="outline" className="w-full h-12 uppercase font-black text-[10px] border-white/10" onClick={() => setManagedSlot(null)}>{language === 'ru' ? 'ЗАКРЫТЬ' : 'CLOSE'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!profilePlayer} onOpenChange={() => setProfilePlayer(null)}>
        {profilePlayer && (
          <DialogContent className="max-w-md bg-background border-white/10 p-0 overflow-y-auto overflow-x-hidden shadow-2xl h-full flex flex-col">
            <DialogHeader className="p-4 pt-12 pb-8 bg-gradient-to-br from-primary/20 via-background to-accent/10 border-b border-white/5 flex flex-col items-center text-center gap-4 relative shrink-0">
              <Button variant="ghost" size="icon" className="absolute left-4 top-10 rounded-full bg-black/20" onClick={() => setProfilePlayer(null)}><X className="w-5 h-5" /></Button>
              <div className="relative mx-auto w-24 h-24 mb-4">
                <div className={cn("w-full h-full rounded-2xl overflow-hidden border-2 border-primary/50 shadow-2xl bg-secondary/50", profilePlayer.isPro ? "border-yellow-500" : "border-primary/50")}>
                  <img src={profilePlayer.image} alt={profilePlayer.name} className="w-full h-full object-cover" />
                </div>
                <div className="absolute -bottom-2 -right-2 w-10 h-10 rounded-xl bg-background border border-white/10 flex items-center justify-center shadow-xl">
                  <span className="text-xl">{profilePlayer.country?.flag}</span>
                </div>
              </div>
              <div className="space-y-1">
                <DialogTitle className="text-2xl font-headline font-bold uppercase text-white tracking-tight leading-none">{profilePlayer.name}</DialogTitle>
                <DialogDescription className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest mt-1">{language === 'ru' ? 'ЛИЧНОЕ ДОСЬЕ ИГРОКА' : 'PLAYER OPERATIONAL DOSSIER'}</DialogDescription>
                <div className="flex items-center justify-center gap-2 mt-2"><Badge className="bg-primary text-primary-foreground text-[10px] font-black uppercase px-2 h-5">{rolesRu[profilePlayer.role] || profilePlayer.role}</Badge></div>
              </div>
            </DialogHeader>
            <div className="p-4 space-y-8 flex-1 scrollbar-hide">
                <section className="grid grid-cols-2 gap-3">
                  <div className="bg-secondary/20 p-3 rounded-xl border border-white/5 space-y-1">
                    <p className="text-[8px] font-black text-muted-foreground uppercase tracking-widest">{language === 'ru' ? 'ВЛАДЕЛЕЦ' : 'OWNER'}</p>
                    <div className="flex items-center gap-2"><ShieldCheck className="w-3 h-3 text-primary" /><p className="text-[10px] font-bold uppercase truncate">{profile?.clubName || displayName || "Manager"}</p></div>
                  </div>
                  <div className="bg-secondary/20 p-3 rounded-xl border border-white/5 space-y-1">
                    <p className="text-[8px] font-black text-muted-foreground uppercase tracking-widest">{language === 'ru' ? 'ПРОДАЖА' : 'SALE'}</p>
                    <div className="flex items-center gap-2"><Timer className="w-3 h-3 text-accent animate-pulse" /><p className="text-[10px] font-mono font-bold text-accent">{profilePlayer.onTransferUntil ? new Date(profilePlayer.onTransferUntil).toLocaleTimeString() : 'OFF MARKET'}</p></div>
                  </div>
                </section>
                <section className="space-y-3">
                  <h3 className="text-[9px] font-black text-primary uppercase tracking-[0.2em] mb-4 flex items-center gap-2 opacity-80 px-1"><Info className="w-3.5 h-3.5" /> {language === 'ru' ? 'ОБЩИЕ ДАННЫЕ' : 'GENERAL INTEL'}</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center justify-between p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[64px]"><span className="text-[9px] font-bold text-muted-foreground uppercase">{language === 'ru' ? 'Возраст' : 'Age'}</span><span className="text-[10px] font-bold">{calculateLiveAge(profilePlayer.baseAge, profilePlayer.hiredAt, profilePlayer.birthDate).display} {language === 'ru' ? 'лет' : 'yrs'}</span></div>
                    <div className="flex items-center justify-between p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[64px]"><span className="text-[9px] font-bold text-muted-foreground uppercase whitespace-nowrap">{language === 'ru' ? 'Талант' : 'Talent'}</span><div className="flex items-center">{renderStars(Math.max(...Object.values(profilePlayer.proTalents || {}).map(v => normTalent(v))))}</div></div>
                    <div className="flex items-center justify-between p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[64px]"><span className="text-[9px] font-bold text-muted-foreground uppercase">{language === 'ru' ? 'Зарплата' : 'Salary'}</span><span className="text-[10px] font-bold text-primary">€{(profilePlayer.salary || 0).toLocaleString()}</span></div>
                    <div className="flex items-center justify-between p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[64px]">
                       <span className="text-[9px] font-bold text-muted-foreground uppercase">{language === 'ru' ? 'Роль' : 'Role'}</span>
                       <span className="text-[10px] font-bold uppercase">{rolesRu[profilePlayer.role] || profilePlayer.role}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[64px]"><span className="text-[9px] font-bold text-muted-foreground uppercase">{language === 'ru' ? 'ФРМ' : 'FRM'}</span><span className={cn("text-lg font-headline font-bold italic", getStatusColor(profilePlayer.form))}>{profilePlayer.form}</span></div>
                    <div className="flex items-center justify-between p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[64px]"><span className="text-[9px] font-bold text-muted-foreground uppercase">{language === 'ru' ? 'УСТ' : 'UST'}</span><span className={cn("text-lg font-headline font-bold italic", getStatusColor(profilePlayer.fatigue))}>{profilePlayer.fatigue}</span></div>
                  </div>
                </section>
                <section>
                  <h3 className="text-[9px] font-black text-primary uppercase tracking-[0.2em] mb-4 flex items-center gap-2 opacity-80 px-1"><ActivityIcon className="w-3.5 h-3.5" /> {language === 'ru' ? 'НАВЫКИ' : 'SKILLS'}</h3>
                  <div className="space-y-3">
                    {STAT_KEYS.map((key) => { 
                      const Icon = icons[key] || Info;
                      const displayValue = Math.round(Number((profilePlayer.proStats as any)[key]));
                      const talentLimit = normTalent((profilePlayer.proTalents as any)[key] || 10);
                      return (
                        <div key={`skill-${key}`} className="space-y-2 p-3 rounded-xl border border-white/5 bg-secondary/10">
                          <div className="flex justify-between items-center px-0.5">
                            <div className="flex items-center gap-2"><Icon className="w-4 h-4 text-muted-foreground/60" /><span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{(language === 'ru' ? t.proStatsLabels : t.proStatsLabels)[key as keyof typeof t.proStatsLabels] || key.toUpperCase()}</span></div>
                            <div className="flex items-center gap-1.5"><span className="text-xs font-mono font-bold text-white">{displayValue}</span><span className="text-[10px] text-muted-foreground/50">/</span><span className="text-xs font-mono font-bold text-primary/70">{talentLimit}</span></div>
                          </div>
                          <Progress value={(displayValue / talentLimit) * 100} max={100} className="h-1 rounded-full bg-secondary/40" />
                        </div>
                      ); 
                    })}
                  </div>
                </section>

                <section>
                  <h3 className="text-[9px] font-black text-accent uppercase tracking-[0.2em] mb-4 flex items-center gap-2 opacity-80 px-1">
                    <Zap className="w-3.5 h-3.5" /> {language === 'ru' ? 'ТЕЛЕМЕТРИЯ ТАЛАНТА' : 'TALENT TELEMETRY'}
                  </h3>
                  <div className="space-y-2">
                    {STAT_KEYS.map((key) => {
                      const talentLimit = normTalent((profilePlayer.proTalents as any)[key]);
                      const Icon = icons[key] || Info;
                      return (
                        <div key={`talent-${key}`} className="p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[48px] flex flex-col justify-center">
                          <div className="flex justify-between items-center px-0.5">
                            <div className="flex items-center gap-2">
                              <Icon className="w-4 h-4 text-accent/50" />
                              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{(language === 'ru' ? t.proStatsLabels : t.proStatsLabels)[key as keyof typeof t.proStatsLabels] || key.toUpperCase()}</span>
                            </div>
                            <div className="flex items-center gap-3">
                               {renderStars(talentLimit)}
                               <span className="text-xs font-mono font-bold text-accent">{talentLimit}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
            </div>
            <div className="p-4 bg-secondary/20 border-t border-white/5 shrink-0">
               <Button variant="outline" className="w-full h-12 uppercase font-black text-[10px] border-white/10" onClick={() => setProfilePlayer(null)}>{language === 'ru' ? 'ЗАКРЫТЬ' : 'CLOSE'}</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
