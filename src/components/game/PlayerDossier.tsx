'use client';

import { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { calculateLiveAge } from '@/app/lib/time-utils';
import { Player } from '@/app/lib/moba-data';
import { STAT_KEYS } from '@/app/lib/player-stats';
export { STAT_KEYS };
import {
  X, ShieldCheck, Timer, Info, Activity, Zap, Target, Eye, Map, Sparkles,
  Sword, Users, Brain, TrendingUp, Crosshair, Star
} from 'lucide-react';

const normTalent = (val: any) => {
  const n = Number(val);
  if (isNaN(n)) return 0;
  return n < 10 ? Math.round(n * 10) : Math.round(n);
};

const renderStars = (talent: number) => {
  const numericTalent = normTalent(talent);
  if (numericTalent > 50) {
    let src = 'https://iili.io/Cnrlw6F.md.png';
    if (numericTalent >= 60 && numericTalent <= 69) src = 'https://iili.io/CnrSxcJ.md.png';
    if (numericTalent >= 70) src = 'https://iili.io/CnrUKJf.md.png';
    return <img src={src} alt={`${numericTalent} stars`} className="h-7 w-auto object-contain" />;
  }
  const starRating = Math.max(0, numericTalent / 10);
  return (
    <div className="flex items-center gap-0.5 h-7">
      {Array.from({ length: 5 }).map((_, i) => {
        const fill = Math.min(Math.max(starRating - i, 0), 1);
        return <div key={i} className="relative w-3 h-3 flex items-center justify-center"><Star className="absolute inset-0 text-muted-foreground/10 w-3 h-3" /><div className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}><Star className="text-yellow-500 fill-yellow-500 w-3 h-3" /></div></div>;
      })}
    </div>
  );
};

const getStatusColor = (val: number) => {
  if (val >= 100) return 'text-white';
  if (val >= 75) return 'text-green-400';
  if (val >= 35) return 'text-yellow-400';
  return 'text-red-500';
};

const icons: Record<string, any> = {
  lastHitting: Target, mapAwareness: Eye, positioning: Map, reflexes: Zap,
  manaManagement: Sparkles, objectiveControl: Sword, communication: Users,
  tiltResistance: Brain, versatility: TrendingUp, ganking: Crosshair,
};

const rolesRu: Record<string, string> = {
  Carry: 'Керри', Midlaner: 'Мидер', Tank: 'Танк', Jungler: 'Лес', Support: 'Саппорт',
};

export interface PlayerDossierProps {
  player: Player | null;
  open: boolean;
  onClose: () => void;
  language?: string;
  ownerName?: string;
  actions?: ReactNode;
}

export function PlayerDossier({ player, open, onClose, language = 'ru', ownerName, actions }: PlayerDossierProps) {
  if (!player) return null;
  const ru = language === 'ru';
  const age = calculateLiveAge(player.baseAge, player.hiredAt, player.birthDate).display;
  const maxTalent = Math.max(...Object.values(player.proTalents || {}).map(v => normTalent(v)), 0);
  // Form and fatigue are hidden information while a player is actively listed on the transfer market.
  const isOnTransfer = Boolean(
    player.onTransferUntil && new Date(player.onTransferUntil).getTime() > Date.now()
  );

  const labels: Record<string, string> = {
    lastHitting: ru ? 'Добив крипов' : 'Last Hitting',
    mapAwareness: ru ? 'Контроль карты' : 'Map Awareness',
    positioning: ru ? 'Позиционка' : 'Positioning',
    reflexes: ru ? 'Рефлексы' : 'Reflexes',
    manaManagement: ru ? 'Менеджмент маны' : 'Mana Management',
    objectiveControl: ru ? 'Объекты' : 'Objective Control',
    communication: ru ? 'Коммуникация' : 'Communication',
    tiltResistance: ru ? 'Стрессоустойчивость' : 'Tilt Resistance',
    versatility: ru ? 'Универсальность' : 'Versatility',
    ganking: ru ? 'Ганкинг' : 'Ganking',
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md bg-background border-white/10 p-0 overflow-y-auto overflow-x-hidden shadow-2xl h-full flex flex-col">
        <DialogHeader className="p-4 pt-12 pb-8 bg-gradient-to-br from-primary/20 via-background to-accent/10 border-b border-white/5 flex flex-col items-center text-center gap-4 relative shrink-0">
          <Button variant="ghost" size="icon" className="absolute left-4 top-10 rounded-full bg-black/20" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
          <div className="relative mx-auto w-24 h-24 mb-4">
            <div className={cn('w-full h-full rounded-2xl overflow-hidden border-2 shadow-2xl bg-secondary/50', player.isPro ? 'border-yellow-500' : 'border-primary/50')}>
              <img src={player.image} alt={player.name} className="w-full h-full object-cover" />
            </div>
            <div className="absolute -bottom-2 -right-2 w-10 h-10 rounded-xl bg-background border border-white/10 flex items-center justify-center shadow-xl">
              <span className="text-xl">{player.country?.flag}</span>
            </div>
          </div>
          <div className="space-y-1">
            <DialogTitle className="text-2xl font-headline font-bold uppercase text-white tracking-tight leading-none">{player.name}</DialogTitle>
            <DialogDescription className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest mt-1">{ru ? 'ЛИЧНОЕ ДОСЬЕ ИГРОКА' : 'PLAYER OPERATIONAL DOSSIER'}</DialogDescription>
            <div className="flex items-center justify-center gap-2 mt-2">
              <Badge className="bg-primary text-primary-foreground text-[10px] font-black uppercase px-2 h-5">{rolesRu[player.role] || player.role}</Badge>
            </div>
          </div>
        </DialogHeader>

        <div className="p-4 space-y-8 flex-1 scrollbar-hide">
          <section className="grid grid-cols-2 gap-3">
            <div className="bg-secondary/20 p-3 rounded-xl border border-white/5 space-y-1">
              <p className="text-[8px] font-black text-muted-foreground uppercase tracking-widest">{ru ? 'ВЛАДЕЛЕЦ' : 'OWNER'}</p>
              <div className="flex items-center gap-2"><ShieldCheck className="w-3 h-3 text-primary" /><p className="text-[10px] font-bold uppercase truncate">{ownerName || 'Manager'}</p></div>
            </div>
            <div className="bg-secondary/20 p-3 rounded-xl border border-white/5 space-y-1">
              <p className="text-[8px] font-black text-muted-foreground uppercase tracking-widest">{ru ? 'ПРОДАЖА' : 'SALE'}</p>
              <div className="flex items-center gap-2"><Timer className="w-3 h-3 text-accent animate-pulse" /><p className="text-[10px] font-mono font-bold text-accent">{player.onTransferUntil ? new Date(player.onTransferUntil).toLocaleTimeString() : 'OFF MARKET'}</p></div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-[9px] font-black text-primary uppercase tracking-[0.2em] mb-4 flex items-center gap-2 opacity-80 px-1"><Info className="w-3.5 h-3.5" /> {ru ? 'ОБЩИЕ ДАННЫЕ' : 'GENERAL INTEL'}</h3>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center justify-between p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[64px]"><span className="text-[9px] font-bold text-muted-foreground uppercase">{ru ? 'Возраст' : 'Age'}</span><span className="text-[10px] font-bold">{age} {ru ? 'лет' : 'yrs'}</span></div>
              <div className="flex items-center justify-between p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[64px]"><span className="text-[9px] font-bold text-muted-foreground uppercase">{ru ? 'Талант' : 'Talent'}</span><div className="flex items-center">{renderStars(maxTalent)}</div></div>
              <div className="flex items-center justify-between p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[64px]"><span className="text-[9px] font-bold text-muted-foreground uppercase">{ru ? 'Зарплата' : 'Salary'}</span><span className="text-[10px] font-bold text-primary">€{Number(player.salary || 0).toLocaleString()}</span></div>
              <div className="flex items-center justify-between p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[64px]"><span className="text-[9px] font-bold text-muted-foreground uppercase">{ru ? 'Роль' : 'Role'}</span><span className="text-[10px] font-bold uppercase">{rolesRu[player.role] || player.role}</span></div>
              {!isOnTransfer && (
                <>
                  <div className="flex items-center justify-between p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[64px]"><span className="text-[9px] font-bold text-muted-foreground uppercase">{ru ? 'ФРМ' : 'FRM'}</span><span className={cn('text-lg font-headline font-bold italic', getStatusColor(Number(player.form || 0)))}>{player.form}</span></div>
                  <div className="flex items-center justify-between p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[64px]"><span className="text-[9px] font-bold text-muted-foreground uppercase">{ru ? 'УСТ' : 'UST'}</span><span className={cn('text-lg font-headline font-bold italic', getStatusColor(Number(player.fatigue || 0)))}>{player.fatigue}</span></div>
                </>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-[9px] font-black text-primary uppercase tracking-[0.2em] mb-4 flex items-center gap-2 opacity-80 px-1"><Activity className="w-3.5 h-3.5" /> {ru ? 'НАВЫКИ' : 'SKILLS'}</h3>
            <div className="space-y-3">
              {STAT_KEYS.map(key => {
                const Icon = icons[key] || Info;
                const current = Math.round(Number((player.proStats as any)?.[key] || 0));
                const talent = normTalent((player.proTalents as any)?.[key] || 10);
                return <div key={`skill-${key}`} className="space-y-2 p-3 rounded-xl border border-white/5 bg-secondary/10"><div className="flex justify-between items-center px-0.5"><div className="flex items-center gap-2"><Icon className="w-4 h-4 text-muted-foreground/60" /><span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{labels[key]}</span></div><div className="flex items-center gap-1.5"><span className="text-xs font-mono font-bold text-white">{current}</span><span className="text-[10px] text-muted-foreground/50">/</span><span className="text-xs font-mono font-bold text-primary/70">{talent}</span></div></div><Progress value={talent ? (current / talent) * 100 : 0} max={100} className="h-1 rounded-full bg-secondary/40" /></div>;
              })}
            </div>
          </section>

          <section>
            <h3 className="text-[9px] font-black text-accent uppercase tracking-[0.2em] mb-4 flex items-center gap-2 opacity-80 px-1"><Zap className="w-3.5 h-3.5" /> {ru ? 'ТЕЛЕМЕТРИЯ ТАЛАНТА' : 'TALENT TELEMETRY'}</h3>
            <div className="space-y-2">
              {STAT_KEYS.map(key => {
                const talent = normTalent((player.proTalents as any)?.[key]);
                const Icon = icons[key] || Info;
                return <div key={`talent-${key}`} className="p-3 bg-secondary/10 rounded-xl border border-white/5 min-h-[48px] flex flex-col justify-center"><div className="flex justify-between items-center px-0.5"><div className="flex items-center gap-2"><Icon className="w-4 h-4 text-accent/50" /><span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{labels[key]}</span></div><div className="flex items-center gap-3">{renderStars(talent)}<span className="text-xs font-mono font-bold text-accent">{talent}</span></div></div></div>;
              })}
            </div>
          </section>

          {actions && <section className="space-y-2">{actions}</section>}
        </div>

        <div className="p-4 bg-secondary/20 border-t border-white/5 shrink-0">
          <Button variant="outline" className="w-full h-12 uppercase font-black text-[10px] border-white/10" onClick={onClose}>{ru ? 'ЗАКРЫТЬ' : 'CLOSE'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
