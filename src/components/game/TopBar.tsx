'use client';

import { useGameState } from '@/app/lib/store';
import { Coins, Gem, Mail, Settings, Shield, Plus } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { cn, formatCurrency } from '@/lib/utils';
import Link from 'next/link';

export function TopBar() {
  const pathname = usePathname();
  const { credits, crystals, language, managerLevel, experiencePoints, displayName, clubName, clubLogo, rank, leagueLevel, groupId } = useGameState();
  if (pathname === '/') {
    return (
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/10 bg-[#030811]/95 shadow-[0_8px_28px_rgba(0,0,0,.35)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center gap-2 px-3 sm:h-[76px] sm:gap-3 sm:px-5">
          <Link href="/" className="shrink-0 leading-[.78]">
            <span className="block text-[17px] font-black italic tracking-[-.08em] text-white sm:text-[22px]">FORGE</span>
            <span className="block pl-2 text-[17px] font-black italic tracking-[-.07em] text-cyan-300 sm:text-[22px]">RIVALS</span>
          </Link>
          <Link href="/profile" className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-1.5 py-1 transition hover:bg-white/5">
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-cyan-200/25 bg-slate-900">
              {clubLogo ? <img src={clubLogo} alt="" className="h-full w-full object-contain" /> : <Shield className="h-6 w-6 text-slate-300" />}
              <span className="absolute -bottom-0.5 right-0 rounded bg-slate-950 px-1 text-[9px] font-black text-white">{managerLevel || 1}</span>
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-black text-white sm:text-sm">{clubName || displayName || 'Manager'}</p>
              <p className="truncate text-[10px] font-semibold text-slate-400">{rank ? (language === 'ru' ? `Дивизион ${leagueLevel} · Группа ${groupId} · #${rank}` : `Division ${leagueLevel} · Group ${groupId} · #${rank}`) : (language === 'ru' ? 'Менеджер клуба' : 'Club manager')}</p>
              <p className="text-[9px] text-slate-500">{Number(experiencePoints || 0).toLocaleString()} XP</p>
            </div>
          </Link>
          <div className="flex shrink-0 flex-col gap-1">
            <Link href="/shop" className="flex h-7 min-w-[76px] items-center justify-between gap-1 rounded-lg border border-amber-300/20 bg-amber-300/5 px-2 text-[11px] font-bold text-amber-200 sm:min-w-[92px]">
              <span className="flex items-center gap-1"><Coins className="h-4 w-4" />{formatCurrency(credits)}</span><Plus className="h-3 w-3 text-cyan-300" />
            </Link>
            <Link href="/shop" className="flex h-7 min-w-[76px] items-center justify-between gap-1 rounded-lg border border-violet-300/20 bg-violet-300/5 px-2 text-[11px] font-bold text-violet-200 sm:min-w-[92px]">
              <span className="flex items-center gap-1"><Gem className="h-4 w-4" />{formatCurrency(crystals || 0)}</span><Plus className="h-3 w-3 text-cyan-300" />
            </Link>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Link href="/reports" aria-label={language === 'ru' ? 'Отчёты' : 'Reports'} className={cn("relative flex h-9 w-9 items-center justify-center rounded-xl text-white transition hover:bg-white/10", pathname === '/reports' && "text-cyan-300")}>
              <Mail className="h-6 w-6" />
            </Link>
            <Link href="/system" aria-label={language === 'ru' ? 'Настройки' : 'Settings'} className={cn("flex h-9 w-9 items-center justify-center rounded-xl text-slate-300 transition hover:bg-white/10 hover:text-white", pathname?.startsWith('/system') && "text-cyan-300")}>
              <Settings className="h-6 w-6" />
            </Link>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-16 border-b border-white/5 bg-[#0a0d14]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-full w-full max-w-md items-center justify-between px-4">
        <Link href="/" className="text-sm font-black italic tracking-tight text-white">FORGE <span className="text-cyan-300">RIVALS</span></Link>
        <div className="flex items-center gap-2 text-xs font-bold">
          <span className="flex items-center gap-1 rounded-lg border border-amber-300/20 bg-amber-300/5 px-2 py-1 text-amber-200"><Coins className="h-3.5 w-3.5" />{formatCurrency(credits)}</span>
          <span className="flex items-center gap-1 rounded-lg border border-violet-300/20 bg-violet-300/5 px-2 py-1 text-violet-200"><Gem className="h-3.5 w-3.5" />{formatCurrency(crystals || 0)}</span>
          <Link href="/reports" className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10"><Mail className="h-5 w-5" /></Link>
        </div>
      </div>
    </header>
  );
}
