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

      <div className="space-y-4">
        <Card className="glass-card border-primary/20 bg-primary/5">
          <CardContent className="p-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-secondary/50 border border-white/5 flex items-center justify-center mx-auto">
              <Radio className="w-8 h-8 text-primary animate-pulse" />
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-bold uppercase text-white">Version 1.1.0 Deployed</h3>
              <p className="text-[10px] text-muted-foreground leading-relaxed italic">
                "Global synchronization protocols updated. Current cycle stability confirmed. Ready for new season deployment."
              </p>
            </div>
            <p className="text-[8px] font-black text-primary/40 uppercase tracking-widest">Received: February 24, 2025</p>
          </CardContent>
        </Card>

        <div className="py-20 text-center opacity-20">
          <Newspaper className="w-12 h-12 mx-auto mb-4" />
          <p className="text-[10px] uppercase font-black tracking-widest">End of Transmission</p>
        </div>
      </div>
    </div>
  );
}
