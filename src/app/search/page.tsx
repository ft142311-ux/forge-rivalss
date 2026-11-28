'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useGameState } from '../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, Search, History, Users, UserRound, GraduationCap, X } from 'lucide-react';

type SearchScope = 'all' | 'senior' | 'youth' | 'staff';

export default function GlobalSearchPage() {
  const { language, ownedPlayers = [], youthAcademyPlayers = [], staff = {}, clubName, displayName } = useGameState();
  const [term, setTerm] = useState('');
  const [scope, setScope] = useState<SearchScope>('all');
  const [recent, setRecent] = useState<string[]>([]);
  const ru = language === 'ru';

  const entries = useMemo(() => {
    const players = (ownedPlayers || []).map((p: any) => ({
      id: String(p.id), name: String(p.name || p.nickname || '—'), detail: p.heroName || p.role || (ru ? 'Игрок основы' : 'Senior player'),
      kind: 'senior' as const, href: '/roster/squad', power: Number(p.power || p.rating || p.proStats?.total || 0)
    }));
    const youth = (youthAcademyPlayers || []).map((p: any) => ({
      id: String(p.id), name: String(p.name || p.nickname || '—'), detail: p.heroName || p.role || (ru ? 'Игрок академии' : 'Academy player'),
      kind: 'youth' as const, href: '/youth-academy/squad', power: Number(p.power || p.rating || p.proStats?.total || 0)
    }));
    const staffEntries = Object.entries(staff || {}).filter(([, value]) => Boolean(value)).map(([role, value]: [string, any]) => ({
      id: String(value.id || role), name: String(value.name || value.fullName || role), detail: ru ? 'Персонал клуба' : 'Club staff',
      kind: 'staff' as const, href: '/staff', power: Number(value.level || 0)
    }));
    return [...players, ...youth, ...staffEntries];
  }, [ownedPlayers, youthAcademyPlayers, staff, ru]);

  const filtered = useMemo(() => {
    const q = term.trim().toLocaleLowerCase();
    return entries.filter(item => (scope === 'all' || item.kind === scope) &&
      (!q || [item.name, item.detail, item.id, item.kind].some(v => String(v).toLocaleLowerCase().includes(q))))
      .slice(0, 40);
  }, [entries, term, scope]);

  const submitSearch = (value = term) => {
    const normalized = value.trim();
    if (!normalized) return;
    setRecent(prev => [normalized, ...prev.filter(x => x.toLowerCase() !== normalized.toLowerCase())].slice(0, 6));
  };

  const scopes: { id: SearchScope; label: string }[] = [
    { id: 'all', label: ru ? 'Все' : 'All' },
    { id: 'senior', label: ru ? 'Основа' : 'Senior' },
    { id: 'youth', label: ru ? 'Академия' : 'Academy' },
    { id: 'staff', label: ru ? 'Персонал' : 'Staff' }
  ];

  return (
    <main className="max-w-2xl mx-auto px-4 pt-8 pb-28 space-y-5">
      <header className="flex items-center gap-4">
        <Link href="/"><Button variant="ghost" size="icon" className="rounded-full"><ChevronLeft className="w-6 h-6" /></Button></Link>
        <div>
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tight flex items-center gap-2"><Search className="w-6 h-6 text-primary" />{ru ? 'ПОИСК' : 'SEARCH'}</h1>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{ru ? 'Поиск по составу и персоналу клуба' : 'Search your club roster and staff'}</p>
        </div>
      </header>

      <form className="relative" onSubmit={e => { e.preventDefault(); submitSearch(); }}>
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input value={term} onChange={e => setTerm(e.target.value)} placeholder={ru ? 'Имя, герой, роль или ID игрока...' : 'Name, hero, role or player ID...'} className="h-14 pl-12 pr-12 bg-secondary/30 border-white/10 rounded-2xl text-sm font-bold" />
        {term && <button type="button" onClick={() => setTerm('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground" aria-label={ru ? 'Очистить' : 'Clear'}><X className="w-4 h-4" /></button>}
      </form>

      <div className="flex gap-2 flex-wrap">
        {scopes.map(item => <Button key={item.id} type="button" size="sm" variant={scope === item.id ? 'default' : 'outline'} onClick={() => setScope(item.id)}>{item.label}</Button>)}
      </div>

      {term.trim() ? (
        <section className="space-y-3">
          <div className="flex justify-between items-center"><h2 className="text-xs font-black uppercase tracking-widest">{ru ? 'РЕЗУЛЬТАТЫ' : 'RESULTS'}</h2><Badge variant="secondary">{filtered.length}</Badge></div>
          {filtered.length ? filtered.map(item => (
            <Link href={item.href} key={item.kind + item.id}>
              <Card className="mb-2 hover:border-primary/40 transition-colors"><CardContent className="p-3 flex items-center gap-3">
                <div className="rounded-xl bg-secondary/60 p-2">{item.kind === 'youth' ? <GraduationCap className="w-5 h-5 text-primary" /> : item.kind === 'staff' ? <Users className="w-5 h-5 text-primary" /> : <UserRound className="w-5 h-5 text-primary" />}</div>
                <div className="min-w-0 flex-1"><p className="font-bold text-sm truncate">{item.name}</p><p className="text-[10px] text-muted-foreground">{item.detail} · ID {item.id}</p></div>
                {item.power > 0 && <Badge variant="outline">{Math.round(item.power)}</Badge>}
              </CardContent></Card>
            </Link>
          )) : <Card><CardContent className="p-8 text-center text-xs text-muted-foreground">{ru ? 'Совпадений в составе вашего клуба нет.' : 'No matches in your club data.'}</CardContent></Card>}
        </section>
      ) : (
        <Card><CardContent className="p-6 text-center space-y-2">
          <Search className="w-9 h-9 mx-auto text-primary/60" />
          <p className="font-bold text-sm">{ru ? 'Начните вводить запрос' : 'Start typing to search'}</p>
          <p className="text-xs text-muted-foreground">{ru ? 'Поиск охватывает основной состав, академию и персонал. Для поиска других клубов потребуется отдельный серверный каталог.' : 'Search covers your senior squad, academy and staff. Searching other clubs requires a separate server catalogue.'}</p>
        </CardContent></Card>
      )}

      {recent.length > 0 && <section className="space-y-2"><h2 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2"><History className="w-4 h-4" />{ru ? 'НЕДАВНИЕ ЗАПРОСЫ' : 'RECENT SEARCHES'}</h2><div className="flex flex-wrap gap-2">{recent.map(item => <Button key={item} size="sm" variant="outline" onClick={() => setTerm(item)}>{item}</Button>)}</div></section>}
      <p className="text-[10px] text-muted-foreground text-center">{clubName || displayName || (ru ? 'Ваш клуб' : 'Your club')}</p>
    </main>
  );
}
