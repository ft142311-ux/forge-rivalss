'use client';

import { useGameState } from '@/app/lib/store';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Check } from "lucide-react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { language, setLanguage } = useGameState();

  const labels = {
    en: { subtitle: "COMMAND CENTER ACCESS", langName: "English" },
    ru: { subtitle: "ДОСТУП К КОМАНДНОМУ ЦЕНТРУ", langName: "Русский" }
  };

  const t = labels[language as keyof typeof labels] || labels.ru;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute inset-0 pointer-events-none opacity-20 bg-[radial-gradient(circle_at_50%_50%,_hsl(var(--primary)/0.15),_transparent_70%)]" />
      <div className="absolute inset-0 pointer-events-none opacity-5 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:30px_30px]" />

      {/* Extreme Top Right Language Switcher */}
      <div className="fixed top-4 right-4 z-[9999]">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="outline" 
              size="sm" 
              className="w-10 h-10 p-0 rounded-full text-xl bg-card/80 backdrop-blur-xl border-white/10 shadow-2xl hover:bg-card transition-all active:scale-95"
            >
              {language === 'en' ? '🇺🇸' : '🇷🇺'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-card/95 backdrop-blur-2xl border-white/10 z-[10000] min-w-[140px] p-1 shadow-2xl">
            <DropdownMenuItem 
              onClick={() => setLanguage('en')}
              className={cn(
                "flex items-center justify-between gap-4 cursor-pointer py-3 px-4 rounded-lg transition-colors",
                language === 'en' ? "bg-primary/10 text-primary" : "hover:bg-white/5"
              )}
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">🇺🇸</span>
                <span className="font-bold text-xs uppercase tracking-wider">English</span>
              </div>
              {language === 'en' && <Check className="w-4 h-4" />}
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={() => setLanguage('ru')}
              className={cn(
                "flex items-center justify-between gap-4 cursor-pointer py-3 px-4 rounded-lg transition-colors",
                language === 'ru' ? "bg-primary/10 text-primary" : "hover:bg-white/5"
              )}
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">🇷🇺</span>
                <span className="font-bold text-xs uppercase tracking-wider">Русский</span>
              </div>
              {language === 'ru' && <Check className="w-4 h-4" />}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="w-full max-w-sm space-y-8 relative z-10">
        <div className="text-center">
          <div className="mx-auto w-32 h-32 mb-6 relative">
            <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full" />
            <img src="https://i.ibb.co/tpcQnnj1/1000078926-no-bg-preview-carve-photos.png" alt="Logo" className="w-full h-full object-contain relative z-10" />
          </div>
          <h1 className="text-3xl font-headline font-bold tracking-tighter text-primary">LINES OF ENMITY</h1>
          <p className="text-muted-foreground mt-2 text-[10px] uppercase tracking-[0.3em] font-black">{t.subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
