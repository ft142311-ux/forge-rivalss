'use client';

import { useGameState } from '../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronLeft, Newspaper, Radio } from 'lucide-react';
import Link from 'next/link';

export default function NewsPage() {
  const { language } = useGameState();

  const t = {
    ru: { title: "НОВОСТИ ПРОЕКТА", subtitle: "Оперативные сводки штаба" },
    en: { title: "PROJECT NEWS", subtitle: "Operational headquarters briefings" }
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
            <Newspaper className="w-6 h-6 text-primary" />
            {t.title}
          </h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-black opacity-50">{t.subtitle}</p>
        </div>
      </header>

      <div className="relative overflow-hidden rounded-2xl border border-cyan-300/20 bg-gradient-to-br from-[#0c1b2b] via-[#0a1422] to-[#10102a] p-6 text-center shadow-[0_16px_48px_rgba(0,0,0,.35)]">
        <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="relative mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10">
          <Radio className="h-8 w-8 text-cyan-200" />
        </div>
        <h2 className="relative text-sm font-black uppercase tracking-wide text-white">
          {language === 'ru' ? 'Пока нет новых новостей' : 'No new updates yet'}
        </h2>
        <p className="relative mx-auto mt-2 max-w-xs text-xs leading-relaxed text-slate-400">
          {language === 'ru'
            ? 'Здесь будут появляться официальные объявления и важные сообщения о развитии Forge-Rivals.'
            : 'Official announcements and important Forge-Rivals updates will appear here.'}
        </p>
        <div className="relative mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[.16em] text-slate-500">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-300/70" />
          {language === 'ru' ? 'КАНАЛ НОВОСТЕЙ' : 'NEWS CHANNEL'}
        </div>
      </div>
    </div>
  );
}
