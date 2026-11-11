import { clampNumber } from './numeric-utils';
import { hash32 } from './hash-utils';
/**
 * Forge-Rivals hero pools, mastery, lightweight talent specializations and deterministic pre-match draft.
 * Pure functions only: no Firestore reads/writes and no random global state.
 */
export type DraftRole = 'Carry' | 'Midlaner' | 'Tank' | 'Jungler' | 'Support';
export interface HeroDefinition {
  id: string; name: string; roles: DraftRole[]; tags: string[]; counters: string[]; difficulty: 1 | 2 | 3;
}
export interface DraftPickSummary { playerId: string; playerName: string; role: DraftRole; heroId: string; heroName: string; mastery: number; counterBonus: number; }
export interface MatchDraftSummary {
  version: 'forge-draft-v1';
  bans: { home: string[]; away: string[] };
  picks: { home: DraftPickSummary[]; away: DraftPickSummary[] };
  notes: string[];
}

// The starter catalogue is deliberately role/tag based. It does not overwrite any existing player stats.
export const HERO_CATALOG: HeroDefinition[] = [
  {id:'blade-dancer',name:'Blade Dancer',roles:['Carry','Midlaner'],tags:['burst','physical','mobile'],counters:['sniper','artillery'],difficulty:2},
  {id:'iron-vanguard',name:'Iron Vanguard',roles:['Tank'],tags:['frontline','control','durable'],counters:['assassin','diver'],difficulty:1},
  {id:'rune-sage',name:'Rune Sage',roles:['Midlaner','Support'],tags:['magic','control','poke'],counters:['frontline','bruiser'],difficulty:2},
  {id:'night-stalker',name:'Night Stalker',roles:['Jungler','Midlaner'],tags:['assassin','mobile','burst'],counters:['sniper','mage'],difficulty:3},
  {id:'field-medic',name:'Field Medic',roles:['Support'],tags:['healing','utility','protect'],counters:['poke','attrition'],difficulty:1},
  {id:'storm-archer',name:'Storm Archer',roles:['Carry'],tags:['sniper','physical','range'],counters:['frontline','mage'],difficulty:2},
  {id:'stonebreaker',name:'Stonebreaker',roles:['Tank','Jungler'],tags:['bruiser','frontline','diver'],counters:['sniper','artillery'],difficulty:1},
  {id:'ember-witch',name:'Ember Witch',roles:['Midlaner'],tags:['mage','burst','magic'],counters:['frontline','healing'],difficulty:3},
  {id:'grove-keeper',name:'Grove Keeper',roles:['Support','Tank'],tags:['utility','protect','control'],counters:['assassin','diver'],difficulty:2},
  {id:'rift-hunter',name:'Rift Hunter',roles:['Jungler'],tags:['diver','bruiser','mobile'],counters:['sniper','mage'],difficulty:2},
  {id:'siege-engineer',name:'Siege Engineer',roles:['Carry','Midlaner'],tags:['artillery','poke','range'],counters:['frontline','healing'],difficulty:2},
  {id:'duelist',name:'Duelist',roles:['Carry','Jungler'],tags:['physical','assassin','mobile'],counters:['mage','sniper'],difficulty:3},
  {id:'tide-warden',name:'Tide Warden',roles:['Tank','Support'],tags:['frontline','protect','durable'],counters:['burst','assassin'],difficulty:1},
  {id:'hex-weaver',name:'Hex Weaver',roles:['Midlaner','Support'],tags:['control','magic','poke'],counters:['mobile','diver'],difficulty:3},
  {id:'war-drummer',name:'War Drummer',roles:['Support'],tags:['utility','engage','teamfight'],counters:['poke','artillery'],difficulty:1},
  {id:'plague-alchemist',name:'Plague Alchemist',roles:['Midlaner','Jungler'],tags:['attrition','magic','bruiser'],counters:['healing','durable'],difficulty:2},
  {id:'sky-lancer',name:'Sky Lancer',roles:['Carry','Jungler'],tags:['diver','mobile','physical'],counters:['artillery','mage'],difficulty:2},
  {id:'mirror-guard',name:'Mirror Guard',roles:['Tank'],tags:['durable','control','counter-engage'],counters:['burst','diver'],difficulty:2},
  {id:'frost-oracle',name:'Frost Oracle',roles:['Midlaner','Support'],tags:['control','poke','utility'],counters:['mobile','diver'],difficulty:2},
  {id:'siegebreaker',name:'Siegebreaker',roles:['Carry','Tank'],tags:['frontline','physical','teamfight'],counters:['durable','control'],difficulty:1},
];

const ROLE_ALIASES: Record<string, DraftRole> = {
  carry:'Carry', adc:'Carry', mid:'Midlaner', midlaner:'Midlaner', offlane:'Tank', offlaner:'Tank', tank:'Tank',
  jungle:'Jungler', jungler:'Jungler', supportjungle:'Jungler', junglesupport:'Jungler', support:'Support', fullsupport:'Support',
};
const norm=(v: unknown)=>String(v ?? '').trim().toLowerCase().replace(/[\s_-]+/g,'');

const num=(v:unknown, fallback=0)=>{const n=Number(v);return Number.isFinite(n)?n:fallback;};
function canonicalRole(p:any,index:number):DraftRole {return ROLE_ALIASES[norm(p?.currentRole)]||ROLE_ALIASES[norm(p?.role)]||(['Carry','Midlaner','Tank','Jungler','Support'][index] as DraftRole);}
function heroById(id:string){return HERO_CATALOG.find(h=>norm(h.id)===norm(id)||norm(h.name)===norm(id));}
function playerPool(p:any,role:DraftRole):HeroDefinition[] {
  const raw=Array.isArray(p?.heroPool)?p.heroPool:Array.isArray(p?.availableHeroes)?p.availableHeroes:[];
  const supplied=raw.map((v:any)=>typeof v==='string'?heroById(v):heroById(String(v?.id||v?.heroId||v?.name||''))).filter(Boolean) as HeroDefinition[];
  // Existing players without hero data receive a deterministic role-compatible pool without a migration.
  const masterySource=p?.heroMasteries&&typeof p.heroMasteries==='object'?p.heroMasteries:p?.heroMastery&&typeof p.heroMastery==='object'?p.heroMastery:{};
  const exp=Math.max(0,num(p?.experience??p?.xp??p?.totalMatchesPlayed,0));
  const count=clampNumber(1+Math.floor(exp/12),1,8);
  const defaults=HERO_CATALOG.filter(h=>h.roles.includes(role)).sort((a,b)=>hash32(`${p?.id||p?.name}:${a.id}`)-hash32(`${p?.id||p?.name}:${b.id}`)).slice(0,count);
  const merged=[...supplied,...defaults].filter((h,i,arr)=>arr.findIndex(x=>x.id===h.id)===i);
  return merged.length?merged: HERO_CATALOG.filter(h=>h.roles.includes(role)).slice(0,3);
}
function masteryFor(p:any,hero:HeroDefinition):number {
  const maps=[p?.heroMasteries,p?.heroMasteryByHero,p?.masteryByHero].filter(v=>v&&typeof v==='object');
  for(const map of maps){const value=map[hero.id]??map[hero.name];if(value!==undefined)return clampNumber(num(typeof value==='object'?value?.level??value?.mastery:value),0,100);}
  const raw=Array.isArray(p?.heroPool)?p.heroPool.find((x:any)=>norm(typeof x==='string'?x:x?.id||x?.heroId||x?.name)===norm(hero.id)):null;
  if(raw&&typeof raw==='object')return clampNumber(num(raw.mastery??raw.level,0),0,100);
  return 0;
}
function talentFit(p:any,role:DraftRole):number {
  const talents=p?.proTalents&&typeof p.proTalents==='object'?p.proTalents:{};
  const keys:Record<DraftRole,string[]>={Carry:['lastHitting','positioning','reflexes'],Midlaner:['reflexes','ganking','mapAwareness'],Tank:['objectiveControl','positioning','tiltResistance'],Jungler:['ganking','objectiveControl','mapAwareness'],Support:['communication','mapAwareness','positioning']};
  const vals=keys[role].map(k=>num(talents[k],0)).filter(v=>v>0);
  // proTalents are existing growth caps/talent values, not rewritten into a new schema.
  if(!vals.length)return 1;
  const avg=vals.reduce((a,b)=>a+b,0)/vals.length;
  return clampNumber(0.985+avg/3000,0.985,1.025);
}
function prefs(team:any){return team?.draftPreferences&&typeof team.draftPreferences==='object'?team.draftPreferences:team?.tactics?.draftPreferences&&typeof team.tactics.draftPreferences==='object'?team.tactics.draftPreferences:{};}
function banList(team:any):string[]{const p=prefs(team);const raw=Array.isArray(p.bannedHeroes)?p.bannedHeroes:[];return raw.map((x:any)=>heroById(String(x))?.id).filter(Boolean) as string[];}
function preferredList(team:any):string[]{const p=prefs(team);const raw=Array.isArray(p.preferredHeroes)?p.preferredHeroes:[];return raw.map((x:any)=>heroById(String(x))?.id).filter(Boolean) as string[];}
function counterScore(hero:HeroDefinition,enemyHeroes:HeroDefinition[]):number {
  let score=0;for(const enemy of enemyHeroes){if(hero.counters.some(t=>enemy.tags.includes(t)))score+=0.012;}
  return clampNumber(score,0,0.036);
}

export function resolveMatchDraft(home:any,away:any,seed:string):{homePlayers:any[];awayPlayers:any[];summary:MatchDraftSummary} {
  const homeBanIds=banList(home),awayBanIds=banList(away);
  const homePlayers=(Array.isArray(home?.players)?home.players:[]).filter(Boolean).slice(0,5);
  const awayPlayers=(Array.isArray(away?.players)?away.players:[]).filter(Boolean).slice(0,5);
  const bannedHome=new Set([...homeBanIds,...awayBanIds]);
  // Deterministic alternating bans: manager preferences are respected; remaining bans are filled from the most common preferred/default pool.
  const allHeroes=HERO_CATALOG.map(h=>h.id);
  const fillBans=(team:any,existing:string[],salt:string)=>{const result=[...new Set(existing)].slice(0,2);for(const id of allHeroes.slice().sort((a,b)=>hash32(`${seed}:${salt}:${a}`)-hash32(`${seed}:${salt}:${b}`))){if(result.length>=2)break;if(!result.includes(id))result.push(id);}return result;};
  const bansHome=fillBans(home,homeBanIds,'home-ban'),bansAway=fillBans(away,awayBanIds,'away-ban');
  const allBanned=new Set([...bansHome,...bansAway]);
  const picksHome:any[]=[],picksAway:any[]=[];
  const pickFor=(player:any,index:number,side:'home'|'away',enemyPicked:HeroDefinition[],used:Set<string>,team:any):any=>{
    const role=canonicalRole(player,index);const pool=playerPool(player,role).filter(h=>!allBanned.has(h.id));
    const candidates=pool.length?pool:HERO_CATALOG.filter(h=>h.roles.includes(role)&&!allBanned.has(h.id));
    const preferred=preferredList(team);const hero=[...candidates].sort((a,b)=>{
      const rank=(h:HeroDefinition)=> (preferred.includes(h.id)?100:0)+masteryFor(player,h)*0.30+counterScore(h,enemyPicked)*100+(h.roles.includes(role)?10:0)-h.difficulty*1.5+(hash32(`${seed}:${side}:${index}:${h.id}`)%100)/10000;
      return rank(b)-rank(a);
    }).find(h=>!used.has(h.id))||[...candidates].sort((a,b)=>hash32(`${seed}:${side}:${index}:${a.id}`)-hash32(`${seed}:${side}:${index}:${b.id}`))[0]||HERO_CATALOG.find(h=>h.roles.includes(role))||HERO_CATALOG[0];
    used.add(hero.id);
    const mastery=masteryFor(player,hero),counter=counterScore(hero,enemyPicked);
    const familiarity=clampNumber(0.985+mastery/100*0.055,0.985,1.04);
    const heroRoleFit=hero.roles.includes(role)?1.015:0.99;
    const counterFactor=1+counter;
    return {...player,selectedHero:{id:hero.id,name:hero.name,mastery,roles:hero.roles,tags:hero.tags},heroDraftMultiplier:clampNumber(familiarity*heroRoleFit*counterFactor,.94,1.07),roleTalentMultiplier:talentFit(player,role),_draftRole:role,_draftCounterBonus:counter};
  };
  const usedHome=new Set<string>(),usedAway=new Set<string>();
  // Alternate selections so each side's later picks can react to visible earlier picks.
  const max=Math.max(homePlayers.length,awayPlayers.length);
  for(let i=0;i<max;i++){
    if(i<homePlayers.length){const enemy=picksAway.map(p=>heroById(p.selectedHero.id)).filter(Boolean) as HeroDefinition[];picksHome.push(pickFor(homePlayers[i],i,'home',enemy,usedHome,home));}
    if(i<awayPlayers.length){const enemy=picksHome.map(p=>heroById(p.selectedHero.id)).filter(Boolean) as HeroDefinition[];picksAway.push(pickFor(awayPlayers[i],i,'away',enemy,usedAway,away));}
  }
  const toSummary=(p:any):DraftPickSummary=>({playerId:String(p?.id??p?.name??''),playerName:String(p?.name||'Игрок'),role:p._draftRole,heroId:p.selectedHero.id,heroName:p.selectedHero.name,mastery:p.selectedHero.mastery,counterBonus:Number(num(p._draftCounterBonus).toFixed(3))});
  const notes:string[]=[];
  for(const p of [...picksHome,...picksAway]){if(p._draftCounterBonus>=0.02)notes.push(`${p.name||p._draftRole}: ${p.selectedHero.name} получает преимущество контрпика.`);if(p.selectedHero.mastery>=60)notes.push(`${p.name||p._draftRole} хорошо освоил героя ${p.selectedHero.name}.`);}
  const summary:MatchDraftSummary={version:'forge-draft-v1',bans:{home:bansHome,away:bansAway},picks:{home:picksHome.map(toSummary),away:picksAway.map(toSummary)},notes:notes.slice(0,8)};
  return {homePlayers:picksHome.map(({_draftRole,_draftCounterBonus,...p})=>p),awayPlayers:picksAway.map(({_draftRole,_draftCounterBonus,...p})=>p),summary};
}

export function getHeroPoolPreview(player:any, role?:string):Array<{hero:HeroDefinition;mastery:number}> {
  const r=ROLE_ALIASES[norm(role||player?.currentRole||player?.role)]||'Carry';
  return playerPool(player,r).map(hero=>({hero,mastery:masteryFor(player,hero)}));
}
