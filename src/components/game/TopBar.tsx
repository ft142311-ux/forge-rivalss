'use client';

import { useGameState } from '@/app/lib/store';
import { useUser } from '@/firebase';
import { useEffect, useState } from 'react';
import { getMyLeagueMatchReportsAction } from '@/app/actions/match-report';
import { Gem, Mail, Home, Bell, Rocket } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { cn, formatCurrency } from '@/lib/utils';
import Link from 'next/link';

export function TopBar() {
  const pathname = usePathname();
  const { credits, crystals, language, isPremium, clubName, displayName, clubLogo, matchHistory, allSeasonMatches } = useGameState();
  const { user } = useUser();
  const [serverUnreadReports, setServerUnreadReports] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (!user) { setServerUnreadReports(0); return; }
    user.getIdToken().then(getMyLeagueMatchReportsAction).then((result) => {
      if (!cancelled) setServerUnreadReports(result?.success ? Number(result.count || 0) : 0);
    }).catch(() => { if (!cancelled) setServerUnreadReports(0); });
    return () => { cancelled = true; };
  }, [user, matchHistory, allSeasonMatches]);
  const localUnreadReports = [...(matchHistory || []), ...(allSeasonMatches || [])].filter((m: any) => m?.isFinished !== false && m?.seen !== true && m?.reportStatus !== 'viewed').length;
  const unreadReportsCount = Math.max(serverUnreadReports, localUnreadReports);

  const navBtnClass = "w-9 h-9 rounded-full flex items-center justify-center bg-secondary/40 border border-white/5 hover:bg-white/10 transition-all shadow-lg";

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-[#0a0d14]/60 backdrop-blur-md h-16 flex items-center border-b border-white/5">
      <div className="w-full max-w-md mx-auto px-4 flex items-center justify-between">
        
        {/* LEFT: COMMANDER BOX */}
        <div className="flex items-center gap-2">
          <div className="h-10 px-2.5 flex items-center gap-2 rounded-lg bg-secondary/30 border border-primary/20 shadow-[inset_0_0_10px_rgba(56,189,248,0.1)]">
            {clubLogo ? (
              <div className="w-6 h-6 rounded bg-black/20 p-0.5 border border-white/5 flex items-center justify-center overflow-hidden">
                <img src={clubLogo} alt="" className="w-full h-full object-contain" />
              </div>
            ) : (
              <Rocket className="w-4 h-4 text-primary" />
            )}
            <span className="text-[10px] font-black uppercase tracking-widest text-white/90 truncate max-w-[80px]">
              {clubName || displayName || 'COMMANDER'}
            </span>
          </div>
        </div>

        {/* CENTER: NAV ICONS */}
        <div className="flex items-center gap-1.5">
          <Link href="/">
            <div className={cn(navBtnClass, pathname === '/' && "border-primary/40 bg-primary/10 text-primary")}>
              <Home className="w-4 h-4" />
            </div>
          </Link>
          <Link href="/chats/private">
            <div className={navBtnClass}>
              <Mail className="w-4 h-4 text-muted-foreground" />
            </div>
          </Link>
          <Link href="/notifications">
            <div className={cn(navBtnClass, "relative")}>
              <Bell className="w-4 h-4 text-muted-foreground" />
              {unreadReportsCount > 0 && <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center">{unreadReportsCount > 99 ? '99+' : unreadReportsCount}</span>}
            </div>
          </Link>
        </div>

        {/* RIGHT: CURRENCIES */}
        <div className="flex items-center gap-1.5">
          <div className="h-8 px-2 rounded-full bg-yellow-500/10 border border-yellow-500/20 flex items-center gap-1.5 shadow-[0_0_15px_rgba(234,179,8,0.1)]">
            <div className="w-4 h-4 rounded-full bg-yellow-500/20 flex items-center justify-center">
              <span className="text-yellow-500 text-[8px] font-black italic">€</span>
            </div>
            <span className="text-[10px] font-headline font-bold text-yellow-500">{formatCurrency(credits)}</span>
          </div>
          <div className="h-8 px-2 rounded-full bg-accent/10 border border-accent/20 flex items-center gap-1.5 shadow-[0_0_15px_rgba(var(--accent),0.1)]">
            <Gem className="w-4 h-4 text-accent" />
            <span className="text-[10px] font-headline font-bold text-accent">{formatCurrency(crystals || 0)}</span>
          </div>
        </div>

      </div>
    </header>
  );
}
