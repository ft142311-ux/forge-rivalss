// Shared tournament bracket helpers. Kept outside app/page modules because Next.js
// page modules may only export route configuration and the default page component.
const MAX_PARTICIPANTS = 16;

type TournamentTeam = { id: string; name: string; isPlayer: boolean };
type TournamentStanding = TournamentTeam & { wins: number; losses: number; played: number; pts: number };

export function getDeterministicTournament(
  dateStr: string, 
  participants: any[], 
  userId: string, 
  mskNow: Date, 
  startTimeStr: string
): { groups: TournamentStanding[][]; qualifiers: TournamentStanding[]; myOpponent: TournamentTeam | null; isPlayoffsVisible: boolean } {
  const realPlayers: TournamentTeam[] = participants?.map((p: any) => ({ id: String(p.id), name: p.displayName || "Manager", isPlayer: true })) || [];
  const botNeeded = Math.max(0, MAX_PARTICIPANTS - realPlayers.length);
  const dateSeed = dateStr.split('-').reduce((acc, v) => acc + parseInt(v), 0);
  const bots: TournamentTeam[] = Array.from({ length: botNeeded }).map((_, i) => {
    const botIdNum = 4000 + (dateSeed % 500) + (i * 31);
    return { id: `bot${botIdNum}`, name: `bot${botIdNum}`, isPlayer: false };
  });
  const allTeams: TournamentTeam[] = [...realPlayers, ...bots].sort((a, b) => a.id.localeCompare(b.id));
  const seed = dateSeed;
  const shuffled = [...allTeams];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = (seed + i) % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const groups = [ shuffled.slice(0, 4), shuffled.slice(4, 8), shuffled.slice(8, 12), shuffled.slice(12, 16) ];
  const [sh, sm] = startTimeStr.split(':').map(Number);
  const startDate = new Date(mskNow);
  startDate.setHours(sh, sm, 0, 0);
  const diffMs = mskNow.getTime() - startDate.getTime();
  const elapsedMins = Math.floor(diffMs / 60000);
  const completedGroupRounds = Math.min(3, Math.max(0, Math.floor(elapsedMins / 5)));
  const isPlayoffsVisible = elapsedMins >= 15;

  const processedGroups = groups.map((group) => {
    return group.map((t): TournamentStanding => {
      let wins = 0;
      let losses = 0;
      for (let r = 1; r <= completedGroupRounds; r++) {
        const roundSeed = (t.id.split('').reduce((a, b) => a + b.charCodeAt(0), 0) + seed + r) % 10;
        if (roundSeed < 5) wins++; else losses++;
      }
      return { ...t, wins, losses, played: completedGroupRounds, pts: wins * 3 };
    }).sort((a, b) => b.pts - a.pts || a.id.localeCompare(b.id));
  });

  let myOpponent = null;
  const myGroupIdx = groups.findIndex(g => g.some(t => t.id === userId));
  if (myGroupIdx !== -1) {
    const myGroup = groups[myGroupIdx];
    const myIdx = myGroup.findIndex(t => t.id === userId);
    myOpponent = myGroup[(myIdx + 1) % 4];
  }
  return { groups: processedGroups, qualifiers: processedGroups.flatMap(g => [g[0], g[1]]), myOpponent, isPlayoffsVisible };
}

