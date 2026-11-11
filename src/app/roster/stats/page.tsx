
'use client';

import { useMemo, useEffect } from 'react';
import { useGameState } from '../../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  ChevronLeft, BarChart3, User, Trophy, 
  Skull, Crosshair, Swords, Star, Activity,
  Info, ShieldAlert
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { Badge } from '@/components/ui/badge';
import { useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import { aggregatePlayerCombatStats } from '../../lib/player-combat-stats';

export default function PlayerStatsPage() {
  const { user, isUserLoading } = useUser();
  const db = useFirestore();
  const { ownedPlayers, matchHistory, language, isLoaded } = useGameState();

  // Use players_v14 for active profile
  const userRef = useMemoFirebase(() => user && db ? doc(db, 'players_v14', user.uid) : null, [db, user]);
  const { data: profile } = useDoc(userRef);

  const playerStats = useMemo(() => {
    if (!profile) return [];

    const regDate = profile.createdAt ? new Date(profile.createdAt).getTime() : 0;

    return ownedPlayers.map(player => {
      let matches = 0;
      let kills = 0;
      let deaths = 0;
      let assists = 0;

      matchHistory.forEach(match => {
        const isOfficial = match.type === 'league' || match.type === 'tournament';
        const playedDate = match.playedAt ? new Date(match.playedAt).getTime() : 0;
        
        if (isOfficial && playedDate >= regDate) {
          const performance = match.simulation?.games?.[0]?.scoreboard?.find((p: any) => p.name === player.name);
          if (performance) {
            matches++;
            const combatStats = aggregatePlayerCombatStats([performance], {
              initial: { kills, deaths, assists },
            });
            kills = combatStats.kills;
            deaths = combatStats.deaths;
            assists = combatStats.assists;
          }
        }
      });

      const kda = deaths === 0 ? (kills + assists) : (kills + assists) / deaths;

      return {
        ...player,
        stats: {
          matches,
          wins: Number((player as any).seasonStats?.wins || 0),
          kills,
          deaths,
          assists,
          kda: kda.toFixed(2)
        }
      };
    });
  }, [ownedPlayers, matchHistory, profile]);

  if (!isLoaded || isUserLoading) return <LoadingScreen />;

  const t = {
    title: language === 'ru' ? "СТАТИСТИКА ИГРОКОВ" : "PLAYER STATISTICS",
    subtitle: language === 'ru' ? "Официальный отчет эффективности" : "Official performance report",
    matches: language === 'ru' ? "Матчи" : "Matches",
    kills: language === 'ru' ? "Убийства" : "Kills",
    deaths: language === 'ru' ? "Смерти" : "Deaths",
    assists: language === 'ru' ? "Ассисты" : "Assists",
    kda: language === 'ru' ? "СР. KDA" : "AVG KDA",
    overall: language === 'ru' ? "ОБЩ" : "OVR",
    noData: language === 'ru' ? "Нет официальных данных" : "No official data yet",
    desc: language === 'ru' 
      ? "Учитываются только игры Лиги и Кубка после регистрации клуба."
      : "Only League and Cup games post-registration are considered."
  };

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-32">
      <header className="mb-6 flex items-center gap-4">
        <Link href="/roster">
          <Button variant="ghost" size="icon" className="rounded-full">
            <ChevronLeft className="w-6 h-6" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-primary" />
            {t.title}
          </h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest">{t.subtitle}</p>
        </div>
      </header>

      <div className="space-y-4">
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-4 flex gap-3">
            <Info className="w-4 h-4 text-primary shrink-0" />
            <p className="text-[10px] text-muted-foreground italic leading-relaxed">
              {t.desc}
            </p>
          </CardContent>
        </Card>

        {playerStats.map((player) => (
          <Card key={player.id} className="glass-card border-white/5 overflow-hidden">
            <CardContent className="p-0">
              <div className="p-4 border-b border-white/5 flex items-center justify-between bg-primary/5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl overflow-hidden border border-white/10 bg-secondary/50">
                    <img src={player.image} alt={player.name} className="w-full h-full object-cover" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-tight truncate max-w-[140px]">{player.name}</h3>
                    <Badge variant="outline" className="text-[7px] h-3 px-1 border-white/10 uppercase opacity-60">{player.role}</Badge>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[7px] font-black text-accent uppercase tracking-widest leading-none mb-1">{t.overall}</p>
                  <p className="text-xl font-headline font-bold text-accent italic leading-none">{player.overallRating}</p>
                </div>
              </div>

              <div className="p-4 grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-bold text-muted-foreground uppercase flex items-center gap-1.5">
                      <Swords className="w-3 h-3 text-primary" /> {t.matches}
                    </span>
                    <span className="text-xs font-mono font-bold">{player.stats.matches}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-bold text-muted-foreground uppercase flex items-center gap-1.5">
                      <Skull className="w-3 h-3 text-red-400" /> {t.deaths}
                    </span>
                    <span className="text-xs font-mono font-bold">{player.stats.deaths}</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-bold text-muted-foreground uppercase flex items-center gap-1.5">
                      <Trophy className="w-3 h-3 text-yellow-500" /> {t.kills}
                    </span>
                    <span className="text-xs font-mono font-bold text-primary">{player.stats.kills}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-bold text-muted-foreground uppercase flex items-center gap-1.5">
                      <Activity className="w-3 h-3 text-green-400" /> {t.assists}
                    </span>
                    <span className="text-xs font-mono font-bold">{player.stats.assists}</span>
                  </div>
                </div>
              </div>

              <div className="px-4 py-2 bg-secondary/30 border-t border-white/5 flex items-center justify-between">
                <span className="text-[8px] font-black text-muted-foreground uppercase tracking-widest">{t.kda}</span>
                <Badge className={cn(
                  "font-black italic text-[10px] px-3",
                  Number(player.stats.kda) >= 4 ? "bg-green-500/20 text-green-400" : (Number(player.stats.kda) >= 2 ? "bg-primary/20 text-primary" : "bg-red-500/20 text-red-400")
                )}>
                  {player.stats.matches > 0 ? player.stats.kda : "0.00"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}

        {playerStats.length === 0 || playerStats.every(h => h.stats.matches === 0) ? (
          <div className="py-20 text-center opacity-30 flex flex-col items-center gap-4">
            <ShieldAlert className="w-16 h-16" />
            <p className="text-xs font-bold uppercase tracking-widest">{t.noData}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
