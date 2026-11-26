
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useGameState } from '@/app/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { 
  ChevronLeft, Search, Loader2, Filter, Lock,
  ChevronsLeft, ChevronsRight, ChevronLeft as ChevronLeftIcon, 
  ChevronRight as ChevronRightIcon, SlidersHorizontal, X
} from 'lucide-react';
import Link from 'next/link';
import { useUser, useFirestore, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { collection, query, doc } from 'firebase/firestore';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { placePlayerBidAction } from '@/app/actions/gameplay';
import { TransferPlayerCard } from '@/components/game/TransferPlayerCard';
import { COUNTRIES } from '@/app/lib/countries-data';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from '@/components/ui/badge';
import { calculateLiveAge, getMoscowTime } from '@/app/lib/time-utils';
import { useToast } from '@/hooks/use-toast';

const ITEMS_PER_PAGE = 10;

export default function AdvancedSearchPage() {
  const { language, isLoaded: isStoreLoaded } = useGameState();
  const { user, isUserLoading } = useUser();
  const db = useFirestore();
  const { toast } = useToast();
  
  const [now, setNow] = useState(Date.now());
  const [page, setPage] = useState(0);
  
  // Filters
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [minAge, setMinAge] = useState<string>('');
  const [maxAge, setMaxAge] = useState<string>('');
  const [minTalent, setMinTalent] = useState<string>('0');
  const [minOvr, setMinOvr] = useState<string>('');
  const [countryFilter, setCountryFilter] = useState<string>('all');

  useEffect(() => {
    const timer = setInterval(() => setNow(getMoscowTime().getTime()), 1000);
    return () => clearInterval(timer);
  }, []);

  const marketQuery = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return query(collection(db, 'market_v7'));
  }, [db, user?.uid]);

  const { data: agents, isLoading: isMarketLoading } = useCollection(marketQuery);
  const userDocRef = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return doc(db, 'players_v14', user.uid);
  }, [db, user?.uid]);
  
  const { data: profile } = useDoc(userDocRef);

  const filteredAgents = useMemo(() => {
    if (!agents) return [];
    
    return agents.filter(a => {
      if (a.isSystem && !a.id.includes('v900')) return false;

      const expiry = new Date(a.expiresAt).getTime();
      if (expiry <= now) return false;

      const liveAge = calculateLiveAge(a.heroData.baseAge, a.heroData.hiredAt);
      if (a.isYouth || liveAge.numeric < 18.0) return false;

      if (roleFilter !== 'all' && a.heroData.role !== roleFilter) return false;
      if (minAge && liveAge.numeric < parseFloat(minAge)) return false;
      if (maxAge && liveAge.numeric > parseFloat(maxAge)) return false;

      const talentValues = Object.values(a.heroData.proTalents || {}).map(v => Number(v));
      const maxTalent = talentValues.length > 0 ? Math.max(...talentValues) : 0;
      const normalizedMaxTalent = maxTalent < 10 ? maxTalent * 10 : maxTalent;
      
      if (parseFloat(minTalent) > 0 && normalizedMaxTalent < parseFloat(minTalent) * 10) return false;

      if (minOvr && a.heroData.overallRating < parseInt(minOvr)) return false;
      if (countryFilter !== 'all' && a.heroData.country?.name !== countryFilter) return false;

      return true;
    }).sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());
  }, [agents, now, roleFilter, minAge, maxAge, minTalent, minOvr, countryFilter]);

  const paginatedAgents = useMemo(() => {
    const start = page * ITEMS_PER_PAGE;
    return filteredAgents.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredAgents, page]);

  const totalPages = Math.ceil(filteredAgents.length / ITEMS_PER_PAGE);

  const handleGlobalBid = useCallback(async (agent: any, amount: number) => {
    if (!user) return;
    try {
      const idToken = await user.getIdToken(true);
      const result: any = await placePlayerBidAction(idToken, String(agent.id), Math.floor(amount));
      if (!result.success) {
        const code = String(result.error || 'BID_FAILED');
        const description = code.startsWith('MIN_BID_')
          ? (language === 'ru' ? `Минимальная ставка: €${Number(code.slice(8)).toLocaleString('ru-RU')}` : `Minimum bid: €${Number(code.slice(8)).toLocaleString('en-US')}`)
          : code.startsWith('MAX_BID_')
            ? (language === 'ru' ? `Максимальная ставка: €${Number(code.slice(8)).toLocaleString('ru-RU')}` : `Maximum bid: €${Number(code.slice(8)).toLocaleString('en-US')}`)
            : code === 'INSUFFICIENT_FUNDS'
              ? (language === 'ru' ? 'Недостаточно средств' : 'Insufficient funds')
              : code === 'AUCTION_EXPIRED'
                ? (language === 'ru' ? 'Аукцион уже завершён' : 'Auction already ended')
                : code === 'CANNOT_BID_OWN_PLAYER'
                  ? (language === 'ru' ? 'Нельзя делать ставку на своего игрока' : 'You cannot bid on your own player')
                  : code;
        toast({ title: language === 'ru' ? 'Ставка отклонена' : 'Bid rejected', description, variant: 'destructive' });
        return;
      }
      toast({
        title: language === 'ru' ? 'Ставка принята!' : 'Bid confirmed!',
        description: result.extended
          ? (language === 'ru' ? 'Окончание аукциона перенесено на 10 минут от момента ставки.' : 'Auction end moved to 10 minutes after your bid.')
          : undefined,
      });
    } catch (e: any) {
      toast({ title: language === 'ru' ? 'Ошибка ставки' : 'Bid error', description: e?.message || 'BID_FAILED', variant: 'destructive' });
    }
  }, [user, language, toast]);

  const resetFilters = () => {
    setRoleFilter('all');
    setMinAge('');
    setMaxAge('');
    setMinTalent('0');
    setMinOvr('');
    setCountryFilter('all');
    setPage(0);
  };

  if (isUserLoading || !isStoreLoaded) return <LoadingScreen />;

  const t = {
    title: language === 'ru' ? 'РАСШИРЕННЫЙ ПОИСК' : 'ADVANCED SEARCH',
    offline: language === 'ru' ? "ОФЛАЙН: Глобальный рынок недоступен." : "OFFLINE: Global market restricted."
  };

  if (!db) {
    return (
      <div className="max-w-md mx-auto px-4 pt-8 text-center">
        <header className="mb-6 flex items-center gap-4 text-left">
          <Link href="/transfers"><Button variant="ghost" size="icon" className="rounded-full"><ChevronLeft className="w-6 h-6" /></Button></Link>
          <div><h1 className="text-2xl font-headline font-bold uppercase">{t.title}</h1></div>
        </header>
        <div className="py-20 opacity-30 flex flex-col items-center gap-6">
           <Lock className="w-16 h-16" />
           <p className="text-xs font-black uppercase tracking-widest">{t.offline}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-32">
      <header className="mb-6 flex items-center gap-4">
        <Link href="/transfers">
          <Button variant="ghost" size="icon" className="rounded-full"><ChevronLeft className="w-6 h-6" /></Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter text-white">
            {t.title}
          </h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-black opacity-60">Global Roster Scouting</p>
        </div>
        <Button variant="ghost" size="icon" onClick={resetFilters} className="text-muted-foreground"><X className="w-5 h-5" /></Button>
      </header>

      <div className="space-y-4 mb-8">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[8px] font-black uppercase text-muted-foreground ml-1">{language === 'ru' ? 'СПЕЦИАЛИЗАЦИЯ' : 'ROLE'}</label>
            <Select value={roleFilter} onValueChange={(v) => { setRoleFilter(v); setPage(0); }}>
              <SelectTrigger className="h-10 bg-secondary/50 border-white/10 text-[10px] font-bold uppercase">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-white/10">
                <SelectItem value="all" className="text-[10px] uppercase font-bold">ВСЕ РОЛИ</SelectItem>
                <SelectItem value="Carry" className="text-[10px] uppercase font-bold">Керри</SelectItem>
                <SelectItem value="Midlaner" className="text-[10px] uppercase font-bold">Мидер</SelectItem>
                <SelectItem value="Tank" className="text-[10px] uppercase font-bold">Танк</SelectItem>
                <SelectItem value="Jungler" className="text-[10px] uppercase font-bold">Лес</SelectItem>
                <SelectItem value="Support" className="text-[10px] uppercase font-bold">Саппорт</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[8px] font-black uppercase text-muted-foreground ml-1">{language === 'ru' ? 'СТРАНА' : 'NATIONALITY'}</label>
            <Select value={countryFilter} onValueChange={(v) => { setCountryFilter(v); setPage(0); }}>
              <SelectTrigger className="h-10 bg-secondary/50 border-white/10 text-[10px] font-bold uppercase">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-white/10 h-64">
                <SelectItem value="all" className="text-[10px] uppercase font-bold">ЛЮБОЙ ФЛАГ</SelectItem>
                {COUNTRIES.map(c => (
                  <SelectItem key={c.code} value={c.name} className="text-[10px] uppercase font-bold">{c.flag} {c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <label className="text-[8px] font-black uppercase text-muted-foreground ml-1">{language === 'ru' ? 'МИН. ВОЗРАСТ' : 'MIN AGE'}</label>
            <Input type="number" placeholder="18" value={minAge} onChange={e => { setMinAge(e.target.value); setPage(0); }} className="h-10 bg-secondary/50 border-white/10 text-[10px] font-bold" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[8px] font-black uppercase text-muted-foreground ml-1">{language === 'ru' ? 'МИН. ТАЛАНТ' : 'MIN TALENT'}</label>
            <Select value={minTalent} onValueChange={(v) => { setMinTalent(v); setPage(0); }}>
              <SelectTrigger className="h-10 bg-secondary/50 border-white/10 text-[10px] font-bold uppercase">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-white/10">
                <SelectItem value="0" className="text-[10px] uppercase font-bold">ЛЮБОЙ ★</SelectItem>
                <SelectItem value="3.5" className="text-[10px] uppercase font-bold">3.5★ +</SelectItem>
                <SelectItem value="4.0" className="text-[10px] uppercase font-bold">4.0★ +</SelectItem>
                <SelectItem value="4.5" className="text-[10px] uppercase font-bold">4.5★ +</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[8px] font-black uppercase text-muted-foreground ml-1">{language === 'ru' ? 'МИН. OVR' : 'MIN OVR'}</label>
            <Input type="number" placeholder="40" value={minOvr} onChange={e => { setMinOvr(e.target.value); setPage(0); }} className="h-10 bg-secondary/50 border-white/10 text-[10px] font-bold" />
          </div>
        </div>
      </div>

      <div className="space-y-3 animate-in fade-in duration-500">
        <div className="flex items-center justify-between px-1 mb-2">
           <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-accent flex items-center gap-2 px-1">
             <Search className="w-3" /> {language === 'ru' ? 'РЕЗУЛЬТАТЫ ПОИСКА' : 'SEARCH RESULTS'}
           </h2>
           <Badge variant="outline" className="text-[8px] border-white/10 opacity-60 uppercase">{filteredAgents.length} UNITS FOUND</Badge>
        </div>

        {paginatedAgents.length > 0 ? (
          <>
            {paginatedAgents.map((agent) => (
              <TransferPlayerCard key={agent.id} agent={agent} user={user} profile={profile} onBid={handleGlobalBid} now={now} language={language} />
            ))}

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-6">
                <Button variant="ghost" size="icon" disabled={page === 0} onClick={() => setPage(0)} className="h-8 w-8"><ChevronsLeft className="w-4 h-4" /></Button>
                <Button variant="ghost" size="icon" disabled={page === 0} onClick={() => setPage(p => p - 1)} className="h-8 w-8"><ChevronLeftIcon className="h-4 w-4" /></Button>
                <span className="text-[10px] font-black text-muted-foreground uppercase px-4">{language === 'ru' ? 'Стр' : 'Page'} {page + 1} / {totalPages}</span>
                <Button variant="ghost" size="icon" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} className="h-8 w-8"><ChevronRightIcon className="h-4 w-4" /></Button>
              </div>
            )}
          </>
        ) : (
          <div className="py-20 text-center opacity-30 border border-dashed border-white/10 rounded-2xl flex flex-col items-center gap-4 p-10">
            <SlidersHorizontal className="w-12 h-12" />
            <p className="text-[10px] uppercase font-black">{language === 'ru' ? 'Игроки не найдены' : 'No matching units'}</p>
          </div>
        )}
      </div>
    </div>
  );
}
