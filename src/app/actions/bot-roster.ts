const BOT_ROLES = [
  ['Carry', 'carry'], ['Midlaner', 'mid'], ['Tank', 'offlane'],
  ['Jungler', 'support'], ['Support', 'full_support'],
] as const;

function stableBotOvr(botId: string, role: string) {
  let h = 2166136261;
  const seed = `${botId}|${role}`;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 23 + (Math.abs(h) % 5);
}

export function buildBotClub(botId: string, name: string) {
  const ownedPlayers = BOT_ROLES.map(([role]) => {
    const ovr = stableBotOvr(botId, role);
    const playerId = `${botId}_${role.toLowerCase()}`;
    const stats: Record<string, number> = {
      lastHitting: ovr, positioning: ovr, reflexes: ovr,
      versatility: ovr, mapAwareness: ovr, tiltResistance: ovr,
      ganking: ovr, objectiveControl: ovr, communication: ovr,
      manaManagement: ovr,
    };
    return { id: playerId, name: `${role} ${botId.slice(-5)}`, role, overallRating: ovr, ovr, proStats: stats, form: 100, fatigue: 100, salary: 100 + ovr * 5, isBot: true };
  });
  const lineup: Record<string, string> = {};
  BOT_ROLES.forEach(([role, key], i) => {
    const playerId = ownedPlayers[i].id;
    lineup[key] = playerId;
    if (role === 'Tank') lineup.tank = playerId;
    if (role === 'Jungler') lineup.jungler = playerId;
    if (role === 'Support') lineup.fullSupport = playerId;
  });
  return { id: botId, clubName: name, name, isBot: true, ownedPlayers, lineup, botRosterVersion: 2, credits: 0 };
}
