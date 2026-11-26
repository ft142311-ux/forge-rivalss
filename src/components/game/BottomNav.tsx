'use client';

import { useState, useEffect } from 'react';
import { useGameState } from '@/app/lib/store';
import { getMoscowTime } from '@/app/lib/time-utils';
import { ChevronLeft, CheckCircle2 } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const { language } = useGameState();
  
  const [now, setNow] = useState(getMoscowTime());

  useEffect(() => {
    const timer = setInterval(() => setNow(getMoscowTime()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatDate = (date: Date) => {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return { date: `${day}.${month}`, time: `${hours}:${minutes}:${seconds}` };
  };

  if (pathname?.startsWith('/auth') || pathname === '/setup') return null;

  const current = formatDate(now);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[#0a0d14]/80 backdrop-blur-xl border-t border-white/5 h-14 flex items-center shadow-[0_-15px_40px_rgba(0,0,0,0.8)]">
      <div className="w-full max-w-md mx-auto px-6 flex items-center justify-between">
        
        {/* LEFT: ACCEPT */}
        <Button 
          variant="ghost" 
          className="flex flex-col items-center gap-0.5 h-auto p-0 hover:bg-transparent group"
        >
          <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-primary/10 border border-primary/20 group-hover:bg-primary/20 transition-all">
            <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
          </div>
          <span className="text-[6px] font-black text-muted-foreground uppercase tracking-widest">
            {language === 'ru' ? 'ПРИНЯТЬ' : 'ACCEPT'}
          </span>
        </Button>

        {/* CENTER: TIME */}
        <div className="flex flex-col items-center">
          <p className="text-base font-headline font-black text-primary italic tracking-widest text-glow-blue tabular-nums leading-none">
            <span className="opacity-70 text-[10px] mr-1">{current.date}</span>
            {current.time}
          </p>
        </div>

        {/* RIGHT: BACK */}
        <Button 
          variant="ghost" 
          onClick={() => router.back()}
          className="flex flex-col items-center gap-0.5 h-auto p-0 hover:bg-transparent group"
        >
          <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-secondary/40 border border-white/10 group-hover:bg-white/10 transition-all">
            <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground group-hover:-translate-x-0.5 transition-transform" />
          </div>
          <span className="text-[6px] font-black text-muted-foreground uppercase tracking-widest">
            {language === 'ru' ? 'НАЗАД' : 'BACK'}
          </span>
        </Button>

      </div>
    </nav>
  );
}
