'use client';

import { useGameState } from '../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, Search, Filter, History, Globe } from 'lucide-react';
import Link from 'next/link';

export default function GlobalSearchPage() {
  const { language } = useGameState();

  const t = {
    ru: { title: "ПОИСК", subtitle: "Глобальная индексация данных" },
    en: { title: "SEARCH", subtitle: "Global data indexing terminal" }
  }[language === 'ru' ? 'ru' : 'en'];

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-32">
      <header className="mb-8 flex items-center gap-4">
        <Link href="/">
          <Button variant="ghost" size="icon" className="rounded-full bg-secondary/50 border border-white/5">
            <ChevronLeft className="w-6 h-6" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter text-white flex items-center gap-2">
            <Search className="w-6 h-6 text-primary" />
            {t.title}
          </h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-black opacity-50">{t.subtitle}</p>
        </div>
      </header>

      <div className="space-y-6">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input 
            placeholder="Search teams, players, associations..." 
            className="h-14 pl-12 bg-secondary/30 border-white/10 rounded-2xl text-lg font-bold"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
          {['All', 'Managers', 'Clubs', 'Alliances', 'Leagues'].map(tag => (
            <Badge key={tag} variant="outline" className="px-4 py-1.5 text-[8px] font-black uppercase tracking-widest border-white/5 bg-secondary/20">
              {tag}
            </Badge>
          ))}
        </div>

        <div className="py-20 text-center opacity-30 flex flex-col items-center gap-4 border-2 border-dashed border-white/5 rounded-3xl p-10">
          <Globe className="w-12 h-12 text-primary" />
          <div className="space-y-1">
            <p className="text-sm font-bold uppercase text-white">Awaiting input</p>
            <p className="text-[10px] uppercase font-black tracking-widest">Enter callsign or identification ID</p>
          </div>
        </div>

        <section className="space-y-3">
          <h2 className="text-[10px] font-black uppercase tracking-widest text-accent flex items-center gap-2 px-1">
            <History className="w-4 h-4" /> Recent Searches
          </h2>
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="p-3 bg-secondary/10 rounded-xl border border-white/5 flex items-center justify-between opacity-50">
                 <span className="text-[10px] font-bold uppercase text-muted-foreground">Manager_0492</span>
                 <Search className="w-3 h-3" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
