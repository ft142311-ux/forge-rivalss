'use client';

import { useState } from 'react';
import { useGameState } from '../lib/store';
import { useUser } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ChevronLeft, UserCog, GraduationCap, Microscope, Stethoscope, CircleDollarSign, TrendingUp, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { calculateLiveAge } from '../lib/time-utils';
import { Progress } from '@/components/ui/progress';
import { getFoundationStaffCandidatesAction, hireFoundationStaffAction } from '@/app/actions/foundation-staff';

const ROLES = ['recruiter', 'coach', 'analyst', 'scout', 'doctor', 'financier'] as const;
type FoundationStaffRole = typeof ROLES[number];

type Candidate = any;

export default function StaffPage() {
  const { user } = useUser();
  const { staff, credits, hq, language, isLoaded } = useGameState();
  const { toast } = useToast();
  const [selectedRole, setSelectedRole] = useState<FoundationStaffRole | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isLoaded || !user) return <LoadingScreen />;

  const isRu = language === 'ru';
  const staffAny = (staff || {}) as any;
  const capacity = Math.max(1, Number(hq?.hrLevel || 1) + 1);
  const used = Object.values(staffAny).filter(Boolean).length;

  const roleMeta: Record<FoundationStaffRole, any> = {
    recruiter: { label: isRu ? 'Кадровик' : 'Recruiter', icon: UserPlus, color: 'text-primary', building: isRu ? 'Главный офис' : 'Head Office', required: null },
    coach: { label: isRu ? 'Главный тренер' : 'Head Coach', icon: GraduationCap, color: 'text-blue-400', building: isRu ? 'Тренировочная база' : 'Bootcamp', required: 'bootcamp' },
    analyst: { label: isRu ? 'Аналитик' : 'Analyst', icon: Microscope, color: 'text-red-400', building: isRu ? 'Главный офис' : 'Head Office', required: 'hq' },
    scout: { label: isRu ? 'Скаут' : 'Scout', icon: TrendingUp, color: 'text-accent', building: isRu ? 'Академия' : 'Academy', required: 'academy' },
    doctor: { label: isRu ? 'Спортивный врач' : 'Team Doctor', icon: Stethoscope, color: 'text-green-400', building: isRu ? 'Медцентр' : 'Medical', required: 'medical' },
    financier: { label: isRu ? 'Финансовый директор' : 'Financier', icon: CircleDollarSign, color: 'text-yellow-400', building: isRu ? 'Главный офис' : 'Head Office', required: 'hq' },
  };

  const openHiring = async (role: FoundationStaffRole) => {
    if (busy) return;
    setSelectedRole(role);
    setCandidate(null);
    setBusy(true);
    try {
      const res = await getFoundationStaffCandidatesAction(await user.getIdToken(true), role);
      if ('error' in res) {
        toast({ variant: 'destructive', title: translateStaffError(res.error, isRu) });
        setSelectedRole(null);
      } else {
        setCandidate(res.candidate);
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: translateStaffError(e?.message, isRu) });
      setSelectedRole(null);
    } finally {
      setBusy(false);
    }
  };

  const hire = async () => {
    if (!selectedRole || !candidate || busy) return;
    setBusy(true);
    try {
      const res = await hireFoundationStaffAction(await user.getIdToken(true), selectedRole);
      if ('error' in res) {
        toast({ variant: 'destructive', title: translateStaffError(res.error, isRu) });
        return;
      }
      toast({ title: isRu ? 'Специалист нанят' : 'Specialist hired' });
      setSelectedRole(null);
      setCandidate(null);
    } catch (e: any) {
      toast({ variant: 'destructive', title: translateStaffError(e?.message, isRu) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-32">
      <header className="mb-6 flex items-center gap-4">
        <Link href="/"><Button variant="ghost" size="icon" className="rounded-full"><ChevronLeft className="w-6 h-6" /></Button></Link>
        <div>
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter flex items-center gap-2"><UserCog className="w-6 h-6 text-primary" />{isRu ? 'ПЕРСОНАЛ КЛУБА' : 'CLUB PERSONNEL'}</h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest">{isRu ? 'Найм через кадровика' : 'Recruitment through HR'}</p>
        </div>
      </header>

      <Card className="mb-6 bg-primary/5 border-primary/20">
        <CardContent className="p-4 grid grid-cols-3 gap-3 text-center">
          <div><p className="text-[8px] text-muted-foreground uppercase font-black">{isRu ? 'Мест' : 'Capacity'}</p><p className="text-xl font-headline font-black text-primary">{used}/{capacity}</p></div>
          <div className="border-x border-white/5"><p className="text-[8px] text-muted-foreground uppercase font-black">{isRu ? 'Баланс' : 'Balance'}</p><p className="text-sm font-headline font-black">€{Math.round(Number(credits || 0)).toLocaleString('ru-RU')}</p></div>
          <div><p className="text-[8px] text-muted-foreground uppercase font-black">{isRu ? 'Уровень ОК' : 'HR Level'}</p><p className="text-xl font-headline font-black text-accent">{Number(hq?.hrLevel || 1)}</p></div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {ROLES.map((role) => {
          const member = staffAny[role];
          const meta = roleMeta[role];
          const Icon = meta.icon;
          const liveAge = member ? calculateLiveAge(member.baseAge, member.hiredAt) : null;
          return (
            <Card key={role} className={cn('glass-card border-white/5 overflow-hidden', !member && 'border-dashed cursor-pointer hover:border-primary/30')} onClick={() => !member && openHiring(role)}>
              <CardContent className="p-0">
                <div className="p-4 flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl bg-secondary/50 border border-white/10 flex items-center justify-center overflow-hidden shrink-0">
                    {member?.image ? <img src={member.image} alt="" className="w-full h-full object-cover" /> : <Icon className={cn('w-7 h-7', meta.color)} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2"><h3 className="text-sm font-bold uppercase truncate">{member ? `${member.firstName} ${member.lastName}` : meta.label}</h3><Badge variant="outline" className={cn('text-[7px] py-0 border-white/10 uppercase', meta.color)}>{meta.label}</Badge></div>
                    {member ? <p className="text-[9px] text-muted-foreground uppercase tracking-widest mt-1">{isRu ? 'Возраст' : 'Age'}: {liveAge?.display} · {isRu ? 'Зарплата' : 'Salary'} €{Number(member.salary || 0).toLocaleString('ru-RU')}</p> : <p className="text-[9px] text-muted-foreground uppercase tracking-widest mt-1">{meta.required ? `${isRu ? 'Требуется' : 'Requires'}: ${meta.building}` : (isRu ? 'Нанять первым' : 'Hire first')}</p>}
                  </div>
                  {!member && <Button size="sm" onClick={(e) => { e.stopPropagation(); void openHiring(role); }} disabled={busy}><UserPlus className="w-3 h-3 mr-1" />{isRu ? 'НАНЯТЬ' : 'HIRE'}</Button>}
                </div>
                {member && role !== 'recruiter' && <div className="px-4 pb-4 grid grid-cols-2 gap-3"><Skill label={isRu ? 'Основной навык' : 'Primary'} value={member.skills?.primary || 0} /><Skill label={isRu ? 'Вторичный навык' : 'Secondary'} value={member.skills?.secondary || 0} /></div>}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!selectedRole} onOpenChange={(open) => !open && !busy && setSelectedRole(null)}>
        <DialogContent className="max-w-md bg-card border-white/10">
          <DialogTitle className="text-xl font-headline uppercase">{selectedRole ? roleMeta[selectedRole].label : ''}</DialogTitle>
          <DialogDescription className="text-[10px] uppercase tracking-widest">{isRu ? 'Кадровик предлагает не более одной кандидатуры на это место в день.' : 'The recruiter offers at most one candidate for this position per day.'}</DialogDescription>
          {candidate && <div className="space-y-4 mt-3">
            <div className="flex items-center gap-4 p-4 rounded-xl bg-secondary/20 border border-white/5"><img src={candidate.image} alt="" className="w-20 h-20 rounded-xl object-cover border border-white/10" /><div><h3 className="font-bold uppercase">{candidate.firstName} {candidate.lastName}</h3><p className="text-[9px] text-muted-foreground uppercase mt-1">{isRu ? 'Возраст' : 'Age'}: {candidate.baseAge}</p><p className="text-[9px] text-muted-foreground uppercase">{isRu ? 'Зарплата' : 'Salary'}: €{Number(candidate.salary || 0).toLocaleString('ru-RU')}</p></div></div>
            <div className="grid grid-cols-2 gap-3"><Skill label={isRu ? 'Основной' : 'Primary'} value={candidate.skills?.primary || 0} /><Skill label={isRu ? 'Вторичный' : 'Secondary'} value={candidate.skills?.secondary || 0} /></div>
            <div className="text-[9px] text-muted-foreground uppercase text-center">{isRu ? 'Стоимость найма: €50 000' : 'Hiring cost: €50,000'}</div>
            <Button className="w-full h-11 font-black" disabled={busy || Number(credits || 0) < 50000} onClick={() => void hire()}>{busy ? '...' : isRu ? 'НАНЯТЬ' : 'HIRE'}</Button>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Skill({ label, value }: { label: string; value: number }) {
  return <div className="p-3 rounded-xl bg-background/40 border border-white/5"><div className="flex justify-between mb-2"><span className="text-[8px] text-muted-foreground uppercase font-black">{label}</span><span className="text-xs font-black">{value}</span></div><Progress value={(Number(value) / 99) * 100} className="h-1" /></div>;
}

function translateStaffError(error: string | undefined, ru: boolean) {
  const map: Record<string, string> = {
    RECRUITER_REQUIRED: ru ? 'Сначала наймите кадровика.' : 'Hire a recruiter first.',
    REQUIRED_BUILDING_MISSING: ru ? 'Для этой должности отсутствует необходимая постройка.' : 'The required building is missing.',
    HR_CAPACITY_REACHED: ru ? 'Лимит отдела кадров исчерпан. Расширьте отдел кадров.' : 'HR capacity reached. Expand the HR department.',
    STAFF_ROLE_OCCUPIED: ru ? 'Это место уже занято.' : 'This position is already occupied.',
    CANDIDATE_NOT_FOUND: ru ? 'Кандидат на сегодня не найден.' : 'Today\'s candidate was not found.',
    INSUFFICIENT_FUNDS: ru ? 'Недостаточно евро.' : 'Not enough euros.',
  };
  return map[error || ''] || error || (ru ? 'Ошибка найма.' : 'Hiring failed.');
}
