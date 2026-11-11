'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { TEAMS_PER_GROUP, TOTAL_GROUPS, getBotId, getBotName, getTableId, generateSeasonCalendar } from '@/app/lib/leagues-data';
import { requireServerActor } from '@/lib/server-auth';
import { acquireSeasonCalendarBuildLock, commitSeasonCalendarWrites, releaseSeasonCalendarBuildLock } from './season-rollover-lock';
import { inspectGroupReconciliation } from './season-rollover-standings';
import { runTwoPhaseSeasonOrchestration } from './season-orchestration';

const LEAGUE_ID = 'ALPHA';
const VERSION = 140;
const CALENDAR_REVISION = 3;
const FIRST_SEASON_START = '2026-09-21T15:00:00.000Z';

function coords(index:number) {
  let level=1, rest=index;
  while (rest > Math.pow(2, level-1)) { rest -= Math.pow(2, level-1); level++; }
  return { level, group:rest };
}
function calendar(teams:any[], season:number, level:number, group:number, seasonStart:Date) {
  return generateSeasonCalendar(teams, season, LEAGUE_ID, seasonStart).map((match:any) => ({
    ...match,
    level,
    groupId:group,
    calendarRevision:CALENDAR_REVISION,
  }));
}

async function preflightRepairGroup(db:any, season:number, level:number, group:number) {
  const [tableSnap, matchesSnap, slotsSnap] = await Promise.all([
    db.collection('league_tables_v2').doc(getTableId(season,LEAGUE_ID,level,group)).get(),
    db.collection('matches_v2').where('season','==',season).where('leagueId','==',LEAGUE_ID).where('level','==',level).where('groupId','==',group).get(),
    db.collection('league_slots_v1').where('season','==',season).where('leagueId','==',LEAGUE_ID).where('division','==',level).where('group','==',group).get(),
  ]);
  const inspection=inspectGroupReconciliation(
    tableSnap.exists ? (tableSnap.data()?.stats || {}) : {},
    matchesSnap.docs.map((d:any)=>d.data()||{}),
    slotsSnap.docs.map((d:any)=>d.data()||{}),
    TEAMS_PER_GROUP,
  );
  return {
    ready: tableSnap.exists && inspection.ready && inspection.reasons.length === 0,
    diagnostics: {
      group:`D${level}-G${group}`,
      reasons: tableSnap.exists ? inspection.reasons : ['TABLE_MISSING'],
      slotConflicts: inspection.slotConflicts,
    },
  };
}

async function repairGroup(db:any, season:number, level:number, group:number, seasonStart:Date, lease:any) {
  const tableRef=db.collection('league_tables_v2').doc(getTableId(season,LEAGUE_ID,level,group));
  const snap=await tableRef.get();
  const stats:any=snap.exists ? (snap.data()?.stats || {}) : {};
  const existing=await db.collection('matches_v2').where('season','==',season).where('leagueId','==',LEAGUE_ID).where('level','==',level).where('groupId','==',group).get();
  const slotId=`S${season}_L${LEAGUE_ID}_D${level}_G${group}`;
  const slotsSnap=await db.collection('league_slots_v1').where('season','==',season).where('leagueId','==',LEAGUE_ID).where('division','==',level).where('group','==',group).get();
  const inspection=inspectGroupReconciliation(stats, existing.docs.map((d:any)=>d.data()||{}), slotsSnap.docs.map((d:any)=>d.data()||{}), TEAMS_PER_GROUP);
  if (!inspection.ready) {
    throw new Error(`SEASON_CALENDAR_REPAIR_PREFLIGHT_FAILED:${JSON.stringify({group:`D${level}-G${group}`,slotPath:slotId,reasons:inspection.reasons,slotConflicts:inspection.slotConflicts})}`);
  }
  const byRank=new Map<number,any>();
  for(const v of Object.values(stats)) { const r=Number((v as any)?.rank); if(r>=1&&r<=TEAMS_PER_GROUP&&!byRank.has(r)) byRank.set(r,v); }
  const teams=Array.from({length:TEAMS_PER_GROUP},(_,i)=>{
    const rank=i+1, existing=byRank.get(rank);
    return existing ? {id:existing.id,name:existing.name||getBotName(level,group,rank),rank} : {id:getBotId(LEAGUE_ID,level,group,rank),name:getBotName(level,group,rank),rank};
  });
  const fullStats:any={};
  for(const t of teams) fullStats[t.id]={id:t.id,name:t.name,rank:t.rank,matchesPlayed:Number(byRank.get(t.rank)?.matchesPlayed||0),wins:Number(byRank.get(t.rank)?.wins||0),draws:Number(byRank.get(t.rank)?.draws||0),losses:Number(byRank.get(t.rank)?.losses||0),points:Number(byRank.get(t.rank)?.points||0),diff:Number(byRank.get(t.rank)?.diff||0),isBot:byRank.get(t.rank)?.isBot !== false};
  const writes:any[]=[];
  writes.push({ref:tableRef,data:{id:getTableId(season,LEAGUE_ID,level,group),leagueId:LEAGUE_ID,level,group,season,stats:fullStats,version:VERSION,scheduleRevision:CALENDAR_REVISION,updatedAt:FieldValue.serverTimestamp()},options:{merge:true}});
  const ids=new Set(existing.docs.map((d:any)=>d.id));
  let created=0;
  for(const m of calendar(teams,season,level,group,seasonStart)) {
    const id=`match_v140_S${season}_L${LEAGUE_ID}_V${level}_G${group}_T${m.tour}_R${m.homeRank}_vs_R${m.awayRank}`;
    if(!ids.has(id)) { writes.push({ref:db.collection('matches_v2').doc(id),data:{...m,id},options:{merge:true}}); created++; }
  }
  await lease.commit(writes);
  return {level,group,created};
}

export async function repairCurrentLeagueCalendar(idToken:string) {
  const {uid}=await requireServerActor(idToken);
  const db=getAdminDb();
  const readState = async () => {
    const playerSnap=await db.collection('players_v14').doc(uid).get();
    if(!playerSnap.exists) throw new Error('PLAYER_NOT_FOUND');
    const p=playerSnap.data()||{};
    const configSnap=await db.collection('system_v1').doc('season_config').get();
    const config=configSnap.exists?configSnap.data()||{}:{};
    const season=Number(p.lastProcessedSeason||config.activeSeasonNumber||1);
    const level=Number(p.leagueLevel||4);
    const group=Number(p.groupId||1);
    const seasonStart=config.seasonStart ? new Date(config.seasonStart) : new Date(FIRST_SEASON_START);
    if(Number.isNaN(seasonStart.getTime())) throw new Error('SEASON_START_INVALID');
    const preflight=await preflightRepairGroup(db,season,level,group);
    return { season, level, group, seasonStart, preflight };
  };
  return await runTwoPhaseSeasonOrchestration<any, any, any>({
    readState,
    preflight: state => ({ ready: state.preflight.ready, diagnostics: state.preflight.diagnostics }),
    onPreflightFailure: (state, _phase, result) => ({success:false,action:'SEASON_CALENDAR_PREFLIGHT_FAILED',season:state.season,diagnostics:[result.diagnostics],writesStarted:false}),
    acquireLock: async (state) => {
      return { ...(await acquireSeasonCalendarBuildLock(db,state.season,state.season)), state };
    },
    onLockUnavailable: (lock: any) => ({success:false,action:'SEASON_CALENDAR_BUILD_LOCKED',lockExpiresAtMs:lock.expiresAtMs}),
    releaseLock: lock => releaseSeasonCalendarBuildLock(db,lock.ownerId,lock.token),
    commit: async (state, lock) => {
      const lease={commit:(writes:any[])=>commitSeasonCalendarWrites(db,lock.ownerId,lock.token,writes)};
      const result=await repairGroup(db,state.season,state.level,state.group,state.seasonStart,lease);
      await lease.commit([{ref:db.collection('system_v1').doc('season_config'),data:{activeSeasonNumber:state.season,phase:'REGULAR_SEASON',worldReady:true,seasonStart:state.seasonStart.toISOString(),nextSeasonStart:new Date(state.seasonStart.getTime()+17*86400000).toISOString(),calendarRevision:CALENDAR_REVISION,updatedAt:FieldValue.serverTimestamp()},options:{merge:true}}]);
      return {success:true,season:state.season,...result};
    },
  });
}

export async function repairAllLeagueCalendar(idToken:string) {
  await requireServerActor(idToken);
  const db=getAdminDb();
  const readState = async () => {
    const configSnap=await db.collection('system_v1').doc('season_config').get();
    const config=configSnap.exists?configSnap.data()||{}:{};
    const season=Number(config.activeSeasonNumber||1);
    const seasonStart=config.seasonStart?new Date(config.seasonStart):new Date(FIRST_SEASON_START);
    const diagnostics:any[]=[];
    for(let i=1;i<=TOTAL_GROUPS;i++){
      const {level,group}=coords(i);
      const result=await preflightRepairGroup(db,season,level,group);
      if(!result.ready) diagnostics.push(result.diagnostics);
    }
    return { season, seasonStart, diagnostics };
  };
  return await runTwoPhaseSeasonOrchestration<any, any, any>({
    readState,
    preflight: state => ({ ready: state.diagnostics.length === 0, diagnostics: state.diagnostics }),
    onPreflightFailure: (state, _phase, result) => ({success:false,action:'SEASON_CALENDAR_PREFLIGHT_FAILED',season:state.season,diagnostics:result.diagnostics,writesStarted:false}),
    acquireLock: async (state) => {
      return { ...(await acquireSeasonCalendarBuildLock(db,state.season,state.season)), state };
    },
    onLockUnavailable: (lock: any) => ({success:false,action:'SEASON_CALENDAR_BUILD_LOCKED',lockExpiresAtMs:lock.expiresAtMs}),
    releaseLock: lock => releaseSeasonCalendarBuildLock(db,lock.ownerId,lock.token),
    commit: async (state, lock) => {
      const lease={commit:(writes:any[])=>commitSeasonCalendarWrites(db,lock.ownerId,lock.token,writes)};
      const results=[];
      for(let i=1;i<=TOTAL_GROUPS;i++){ const {level,group}=coords(i); results.push(await repairGroup(db,state.season,level,group,state.seasonStart,lease)); }
      return {success:true,season:state.season,results};
    },
  });
}
