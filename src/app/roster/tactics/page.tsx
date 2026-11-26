'use client';

import { useState } from 'react';
import { useGameState } from '../../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronLeft, Swords, Save, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { useToast } from '@/hooks/use-toast';

const options = {
  direction: [['easy','Лёгкая линия'],['mid','МИД'],['hard','Сложная линия']],
  style: [['offense','Атака'],['control','Контроль']],
  pressing: [['low','Низкий'],['medium','Средний'],['high','Высокий']],
  rigidity: [['low','Мягкая'],['medium','Средняя'],['high','Жёсткая']],
  tempo: [['slow','Медленный'],['medium','Средний'],['fast','Быстрый']],
  risk: [['cautious','Осторожный'],['balanced','Сбалансированный'],['aggressive','Агрессивный']],
  range: [['close','Ближняя'],['medium','Средняя'],['long','Дальняя']],
} as const;

type Key = keyof typeof options;

export default function TacticsPage() {
  const { language, isLoaded, tactics, updateTactics } = useGameState();
  const { toast } = useToast();
  const ru = language === 'ru';
  const [draft, setDraft] = useState<any>(() => ({
    direction: ['easy','mid','hard'].includes(String(tactics?.direction)) ? String(tactics?.direction) : 'mid',
    style: tactics?.style === 'aggressive' ? 'offense' : tactics?.style === 'control' ? 'control' : 'control',
    pressing: tactics?.pressing || 'medium',
    rigidity: tactics?.rigidity || 'medium',
    tempo: tactics?.tempo === 'careful' ? 'slow' : tactics?.tempo || 'medium',
    risk: tactics?.risk || (tactics?.aggression === 'high' ? 'aggressive' : tactics?.aggression === 'low' ? 'cautious' : 'balanced'),
    range: tactics?.range || 'medium',
  }));

  const labels: Record<Key,string> = {
    direction: ru ? 'Направление действий' : 'Action direction', style: ru ? 'Стиль игры' : 'Style', pressing: ru ? 'Прессинг' : 'Pressing',
    rigidity: ru ? 'Жёсткость' : 'Rigidity', tempo: ru ? 'Темп' : 'Tempo', risk: ru ? 'Риск' : 'Risk', range: ru ? 'Дальность' : 'Range'
  };
  const descriptions: Record<Key,string> = {
    direction: ru ? 'Только три направления MOBA: Лёгкая линия, МИД или Сложная линия.' : 'Three MOBA directions: Easy lane, MID or Hard lane.',
    style: ru ? 'Атака усиливает столкновения, Контроль усиливает карту и стабильность.' : 'Offense favors engagements; Control favors map stability.',
    pressing: ru ? 'Высокий прессинг увеличивает давление, но сильнее расходует энергию.' : 'Higher pressing increases pressure but costs more energy.',
    rigidity: ru ? 'Определяет строгость исполнения выбранной схемы.' : 'Determines how strictly the plan is executed.',
    tempo: ru ? 'Быстрый темп требует подходящих навыков.' : 'Fast tempo requires suitable skills.',
    risk: ru ? 'Определяет баланс между безопасностью и риском.' : 'Balances safety and risk.',
    range: ru ? 'Определяет дистанцию действий.' : 'Controls action range.'
  };

  const save = () => {
    const legacyAggression = draft.risk === 'aggressive' ? 'high' : draft.risk === 'cautious' ? 'low' : 'medium';
    const legacyTempo = draft.tempo === 'slow' ? 'careful' : draft.tempo === 'fast' ? 'fast' : 'balanced';
    const name = draft.style === 'offense' ? 'Offense Play' : 'Control Play';
    updateTactics(name, { ...draft, aggression: legacyAggression, tempo: legacyTempo });
    toast({ title: ru ? 'Тактика сохранена' : 'Tactics saved' });
  };

  if (!isLoaded) return <LoadingScreen />;
  return <div className="max-w-md mx-auto px-4 pt-8 pb-32">
    <header className="mb-6 flex items-center gap-4">
      <Link href="/roster"><Button variant="ghost" size="icon" className="rounded-full"><ChevronLeft className="w-6 h-6" /></Button></Link>
      <div><h1 className="text-2xl font-headline font-bold uppercase tracking-tighter flex items-center gap-2"><Swords className="w-6 h-6 text-primary" />{ru ? 'ТАКТИКА КОМАНДЫ' : 'TEAM TACTICS'}</h1><p className="text-muted-foreground text-[10px] uppercase tracking-widest">{ru ? '7 параметров MOBA-тактики' : '7 MOBA tactical parameters'}</p></div>
    </header>
    <div className="space-y-4">
      {(Object.keys(options) as Key[]).map(key => <Card key={key} className="glass-card border-white/5"><CardContent className="p-4">
        <h2 className="text-xs font-black uppercase tracking-widest text-primary">{labels[key]}</h2>
        <p className="text-[9px] text-muted-foreground mt-1 mb-3 leading-relaxed">{descriptions[key]}</p>
        <div className={cn('grid gap-1 bg-secondary/30 p-1 rounded-xl border border-white/5', options[key].length === 2 ? 'grid-cols-2' : 'grid-cols-3')}>
          {options[key].map(([value,label]) => <button key={value} onClick={() => setDraft((d:any)=>({...d,[key]:value}))} className={cn('py-2 px-2 text-[9px] font-black uppercase rounded-lg transition-all', draft[key] === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-white/5')}>{ru ? label : value}</button>)}
        </div>
      </CardContent></Card>)}
      <Card className="bg-primary/5 border-primary/20"><CardContent className="p-4 flex gap-3"><Info className="w-5 h-5 text-primary shrink-0"/><p className="text-[9px] text-muted-foreground leading-relaxed">{ru ? 'Тактика является входом Match Core. Её эффект зависит от навыков, ролей, формы, усталости и сыгранности игроков.' : 'Tactics feed the Match Core and interact with skills, roles, condition and synergy.'}</p></CardContent></Card>
      <Button onClick={save} className="w-full h-14 hero-gradient font-black text-xs tracking-[0.2em] uppercase"><Save className="w-4 h-4 mr-2" />{ru ? 'СОХРАНИТЬ ТАКТИКУ' : 'SAVE TACTICS'}</Button>
    </div>
  </div>;
}
