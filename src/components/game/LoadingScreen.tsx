'use client';

import { useEffect, useState } from 'react';

/**
 * Минималистичный экран загрузки v2.2.
 * Фон синхронизирован с глобальным макетом (layout.tsx).
 */
export function LoadingScreen() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Базовый фон до монтирования для предотвращения вспышек
  const bgStyle = {
    backgroundImage: `linear-gradient(to bottom, rgba(10, 13, 20, 0.02), rgba(10, 13, 20, 0.15)), url('https://i.ibb.co/GQ39Zhc9/1787834437641.png')`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat'
  };

  if (!mounted) {
    return (
      <div className="fixed inset-0 z-[9999] bg-[#0a0d14] flex flex-col items-center justify-center p-6 overflow-hidden" style={bgStyle} />
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-[#0a0d14] flex flex-col items-center justify-center p-6 overflow-hidden">
      {/* Global Background Layer for Preloader */}
      <div 
        className="absolute inset-0 z-0 pointer-events-none"
        style={bgStyle}
      />
      
      {/* Фоновое свечение */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,_hsl(var(--primary)/0.15),_transparent_70%)] z-0"></div>

      <div className="relative flex flex-col items-center gap-8 z-10">
        {/* Логотип */}
        <div className="relative">
          <div className="absolute -inset-8 bg-primary/10 rounded-full blur-2xl animate-pulse"></div>
          <img 
            src="https://i.ibb.co/tpcQnnj1/1000078926-no-bg-preview-carve-photos.png" 
            alt="Logo" 
            className="w-48 h-48 object-contain animate-pulse" 
          />
        </div>

        {/* Статус передачи данных */}
        <div className="text-center space-y-2">
          <p className="text-[11px] font-headline font-bold text-primary uppercase tracking-[0.4em] animate-pulse opacity-80">
            Идет передача данных...
          </p>
          <div className="w-24 h-0.5 bg-primary/20 mx-auto overflow-hidden rounded-full">
            <div className="w-full h-full bg-primary animate-shimmer origin-left"></div>
          </div>
        </div>
      </div>

      {/* Футер */}
      <div className="absolute bottom-12 text-center opacity-30 z-10">
        <p className="text-[8px] font-black uppercase tracking-[0.2em] text-muted-foreground">
          ENMITY LEAGUE OPERATIONS © 2026
        </p>
      </div>
    </div>
  );
}
