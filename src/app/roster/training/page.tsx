'use client';

import { useState } from 'react';
import { useGameState } from '../../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ChevronLeft, Dumbbell, Target, Info, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const SKILLS = {
  lastHitting: 'Добив крипов', mapAwareness: 'Контроль карты', positioning: 'Позиционка',
  reflexes: 'Рефлексы', manaManagement: 'Менеджмент маны', objectiveControl: 'Объекты',
  communication: 'Коммуникация', tiltResistance: 'Стрессоустойчивость', versatility: 'Универсальность', ganking: 'Ганкинг',
};

export default function TrainingPage() {
  const { ownedPlayers, language, isLoaded, setTrainingFocus } = useGameState();
  const [saving, setSaving] = useState<string | null>(null);
  const t = {
    title: language === 'ru' ? 'ТРЕНИРОВКА НАВЫКОВ' : 'SKILL TRAINING',
    subtitle: language === 'ru' ? 'Развитие через игровые минуты' : 'Development through match minutes',
    desc: language === 'ru' ? 'Выберите навык. Прогресс начисляется за минуты, проведённые игроком в матчах. Талант, склонность к обучению, физика, выносливость и возраст влияют на скорость роста. После 90% потенциала обучение замедляется.' : 'Choose a skill. Progress is earned from minutes played. Talent, training propensity, physical condition, resilience and age affect growth. Training slows after 90% of potential.',
    focus: language === 'ru' ? 'ФОКУС' : 'FOCUS',
    progress: language === 'ru' ? 'ПРОГРЕСС' : 'PROGRESS',
    potential: language === 'ru' ? 'ПОТЕНЦИАЛ' : 'POTENTIAL',
    propensity: language === 'ru' ? 'Склонность' : 'Propensity',
    physical: language === 'ru' ? 'Физика' : 'Physical',
    resilience: language === 'ru' ? 'Выносливость' : 'Resilience',
    minutes: language === 'ru' ? 'Последние минуты' : 'Last minutes',
    noFocus: language === 'ru' ? 'Не выбрано' : 'None',
    saved: language === 'ru' ? 'Фокус сохранён' : 'Focus saved',
  };

  if (!isLoaded) return <LoadingScreen />;

  const saveFocus = async (playerId: string, value: string) => {
    setSaving(playerId);
    try { await setTrainingFocus(playerId, value === 'none' ? null : value); } finally { setSaving(null); }
  };

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-32">
      <header className="mb-6 flex items-center gap-4">
        <Link href="/roster"><Button variant="ghost" size="icon" className="rounded-full"><ChevronLeft className="w-6 h-6" /></Button></Link>
        <div><h1 className="text-2xl font-headline font-bold uppercase tracking-tighter flex items-center gap-2"><Dumbbell className="w-6 h-6 text-primary" />{t.title}</h1><p className="text-muted-foreground text-[10px] uppercase tracking-widest">{t.subtitle}</p></div>
      </header>

      <Card className="bg-primary/5 border-primary/20 mb-6"><CardContent className="p-4 flex gap-4"><Info className="w-5 h-5 text-primary shrink-0" /><p className="text-[10px] text-muted-foreground leading-relaxed italic">"{t.desc}"</p></CardContent></Card>

      <div className="space-y-3">
        {ownedPlayers.map((player: any) => {
          const focus = player.trainingFocus || null;
          const value = focus ? Math.round(Number(player.proStats?.[focus] || 0)) : 0;
          const cap = focus ? Math.round(Number(player.skillCaps?.[focus] || (45 + Number(player.proTalents?.[focus] || 0) * .55))) : 0;
          const progress = focus ? Number(player.trainingProgress?.[focus] || 0) : 0;
          const percent = cap > 0 ? Math.min(100, (value / cap) * 100) : 0;
          const nearCap = focus && value >= cap * .9;
          return (
            <Card key={player.id} className="glass-card border-white/5 overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3 min-w-0"><div className="w-10 h-10 rounded-xl border border-white/10 overflow-hidden bg-secondary/50 shrink-0"><img src={player.image} alt={player.name} className="w-full h-full object-cover" /></div><div className="min-w-0"><h3 className="text-sm font-bold uppercase truncate max-w-[125px]">{player.name}</h3><Badge variant="outline" className="text-[7px] h-3 px-1 border-white/10 uppercase opacity-60">{player.role}</Badge></div></div>
                  <div className="w-36 shrink-0"><Select value={focus || 'none'} onValueChange={(v) => saveFocus(player.id, v)} disabled={saving === player.id}><SelectTrigger className="h-8 bg-secondary/50 border-white/5 text-[9px] font-bold uppercase tracking-tighter"><SelectValue /></SelectTrigger><SelectContent className="bg-card border-white/10"><SelectItem value="none" className="text-[9px] uppercase font-bold">{t.noFocus}</SelectItem>{Object.entries(SKILLS).map(([key,label]) => <SelectItem key={key} value={key} className="text-[9px] uppercase font-bold">{language === 'ru' ? label : key}</SelectItem>)}</SelectContent></Select></div>
                </div>

                {focus ? <div className="space-y-4 bg-background/40 p-4 rounded-xl border border-white/5">
                  <div className="flex justify-between items-center"><div className="flex items-center gap-2"><Target className={cn('w-4 h-4', nearCap ? 'text-yellow-500' : 'text-primary')} /><span className="text-xs font-black uppercase tracking-widest">{language === 'ru' ? SKILLS[focus as keyof typeof SKILLS] : focus}</span></div><div className="text-right"><div className="text-xs font-mono font-bold">{value} / <span className="text-primary">{cap}</span></div><div className="text-[8px] text-muted-foreground">+{progress.toFixed(2)} XP</div></div></div>
                  <Progress value={percent} className="h-1 bg-secondary/40" />
                  <div className="grid grid-cols-4 gap-2 text-center">
                    {[['propensity', player.trainingPropensity ?? 50, t.propensity], ['physical', player.physical ?? 50, t.physical], ['resilience', player.resilience ?? 50, t.resilience], ['minutes', player.lastMatchMinutes ?? 0, t.minutes]].map(([key,val,label]) => <div key={String(key)} className="rounded-lg bg-secondary/30 p-2"><p className="text-[6px] text-muted-foreground uppercase font-black">{label}</p><p className="text-xs font-headline font-bold">{Math.round(Number(val))}{key === 'minutes' ? 'm' : ''}</p></div>)}
                  </div>
                  {nearCap && <div className="flex items-center justify-center gap-1.5 text-yellow-500"><CheckCircle2 className="w-3 h-3" /><span className="text-[8px] font-black uppercase tracking-widest">90%+ — рост замедлен</span></div>}
                </div> : <div className="py-5 text-center border border-dashed border-white/5 rounded-xl opacity-30"><p className="text-[8px] font-bold uppercase tracking-widest">{t.focus}</p></div>}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
