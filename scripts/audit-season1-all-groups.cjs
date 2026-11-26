/* Read-only full Season 1 league audit for Firebase Emulator. No Firestore writes. */
const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'demo-forge-rivals';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIRESTORE_EMULATOR_HOST = emulatorHost;
if (!admin.apps.length) admin.initializeApp({ projectId });
const db = admin.firestore();
const SEASON = 1, LEAGUE = 'ALPHA', TEAMS = 8;
const groups = [];
for (let level = 1; level <= 4; level++) for (let group = 1; group <= 2 ** (level - 1); group++) groups.push({ level, group, key: `D${level}-G${group}` });
function normalize(v) { if (v === undefined) return null; if (v === null || typeof v !== 'object') return v; if (v instanceof Date) return v.toISOString(); if (typeof v.toDate === 'function') return v.toDate().toISOString(); if (Array.isArray(v)) return v.map(normalize); const o={}; for (const [k,x] of Object.entries(v)) o[k]=normalize(x); return o; }
function finished(m) { return m.isFinished === true && (m.status === undefined || String(m.status).toLowerCase() === 'finished'); }
function score(m) { const h=Number(m.score?.home ?? m.seriesScore?.home ?? m.scoreA), a=Number(m.score?.away ?? m.seriesScore?.away ?? m.scoreB); return Number.isInteger(h)&&Number.isInteger(a)&&h>=0&&a>=0&&h<=2&&a<=2&&(h!==0||a!==0) ? [h,a] : null; }
function compare(a,b) { return b.points-a.points || b.diff-a.diff || b.wins-a.wins || String(a.name||a.id).localeCompare(String(b.name||b.id)) || a.id.localeCompare(b.id); }
async function main() {
 const [cfg, tablesSnap, matchesSnap, slotsSnap] = await Promise.all([
   db.collection('system_v1').doc('season_config').get(),
   db.collection('league_tables_v2').where('season','==',SEASON).get(),
   db.collection('matches_v2').where('season','==',SEASON).get(),
   db.collection('league_slots_v1').where('season','==',SEASON).get()
 ]);
 const tables=tablesSnap.docs.map(d=>({docId:d.id,...normalize(d.data()||{})})).filter(t=>Number(t.version||0)===140 && String(t.leagueId||LEAGUE)===LEAGUE);
 const matches=matchesSnap.docs.map(d=>({docId:d.id,...normalize(d.data()||{})})).filter(m=>{
   const type=String(m.type||m.matchType||m.competitionType||'').toLowerCase();
   if (/(cup|tournament|friendly|scrim|pyramid)/.test(type)||m.isCup===true||m.isFriendly===true||m.tournamentId||m.cupId) return false;
   const level=Number(m.level||m.division||0), group=Number(m.groupId||m.group||0), hr=Number(m.homeRank||0), ar=Number(m.awayRank||0);
   return level>=1&&level<=4&&group>=1&&group<=2**(level-1)&&hr>=1&&hr<=TEAMS&&ar>=1&&ar<=TEAMS&&hr!==ar&&(!m.leagueId||String(m.leagueId)===LEAGUE)&&(!m.version||Number(m.version)===140);
 });
 const slots=slotsSnap.docs.map(d=>({docId:d.id,...normalize(d.data()||{})})).filter(s=>String(s.leagueId||LEAGUE)===LEAGUE && Number(s.version||140)===140);
 const reports=[];
 for (const g of groups) {
   const groupTables=tables.filter(t=>Number(t.level||0)===g.level&&Number(t.group||0)===g.group);
   const groupMatches=matches.filter(m=>Number(m.level||m.division||0)===g.level&&Number(m.groupId||m.group||0)===g.group);
   const groupSlots=slots.filter(s=>Number(s.division||s.level||0)===g.level&&Number(s.group||0)===g.group);
   const t=groupTables[0], stats=t?.stats&&typeof t.stats==='object'?t.stats:{};
   const byRank=new Map(), idRank=new Map(), coordinates=new Set(), rankConflicts=[];
   for(const m of groupMatches){
     for(const [id,rank] of [[String(m.homeId||''),Number(m.homeRank)],[String(m.awayId||''),Number(m.awayRank)]]){
       if(!id||!Number.isInteger(rank)) continue;
       if(!byRank.has(rank)) byRank.set(rank,new Set()); byRank.get(rank).add(id);
       if(idRank.has(id)&&idRank.get(id)!==rank) rankConflicts.push({id,previousRank:idRank.get(id),rank}); else idRank.set(id,rank);
     }
     coordinates.add(`${Number(m.homeRank)}>${Number(m.awayRank)}`);
   }
   const participantIds=new Set(idRank.keys());
   const slotsByRank=new Map(); for(const s of groupSlots){const r=Number(s.rank); if(!slotsByRank.has(r))slotsByRank.set(r,[]);slotsByRank.get(r).push(s);}
   const slotIssues=[];
   for(let r=1;r<=TEAMS;r++){
     const ids=[...(byRank.get(r)||[])]; const ss=slotsByRank.get(r)||[];
     if(ids.length!==1) slotIssues.push({rank:r,issue:ids.length===0?'NO_FIXTURE_PARTICIPANT':'MULTIPLE_FIXTURE_PARTICIPANTS',fixtureIds:ids});
     if(ss.length!==1) slotIssues.push({rank:r,issue:ss.length===0?'MISSING_SLOT':'DUPLICATE_SLOT',slotCount:ss.length});
     if(ids.length===1&&ss.length===1){const fid=ids[0], sid=String(ss[0].occupantId||''); if(fid.startsWith('BOT_') ? !!sid : sid!==fid) slotIssues.push({rank:r,issue:'SLOT_FIXTURE_MISMATCH',fixtureId:fid,slotId:sid,status:ss[0].status||null});}
   }
   const finishedCount=groupMatches.filter(finished).length;
   const validScores=groupMatches.filter(m=>score(m)!==null).length;
   const expected=TEAMS*(TEAMS-1);
   const canonicalShape=groupMatches.length===expected&&coordinates.size===expected&&participantIds.size===TEAMS&&rankConflicts.length===0&&[...byRank.values()].every(ids=>ids.size===1)&&[...idRank.values()].every(r=>r>=1&&r<=TEAMS);
   const complete=canonicalShape&&finishedCount===expected&&validScores===expected&&groupMatches.every(m=>finished(m)&&score(m)!==null);
   const sourceRows=Object.entries(stats).map(([id,row])=>({id:String(row?.id||id),rank:Number(row?.rank),matchesPlayed:Number(row?.matchesPlayed||0),wins:Number(row?.wins||0),draws:Number(row?.draws||0),losses:Number(row?.losses||0),points:Number(row?.points||0),diff:Number(row?.diff||0)}));
   const staleRows=sourceRows.filter(r=>canonicalShape&&!participantIds.has(r.id)).map(r=>r.id);
   const rankDuplicates={}; for(const r of sourceRows){if(Number.isInteger(r.rank)){(rankDuplicates[r.rank] ||= []).push(r.id);}}
   const duplicateRanks=Object.entries(rankDuplicates).filter(([,ids])=>ids.length>1).map(([rank,ids])=>({rank:Number(rank),ids}));
   const computed=new Map();
   for(const m of groupMatches){const pair=score(m); if(!pair)continue; for(const [id,name] of [[String(m.homeId),String(m.homeName||m.homeId)],[String(m.awayId),String(m.awayName||m.awayId)]]) if(!computed.has(id)) computed.set(id,{id,name,matchesPlayed:0,wins:0,draws:0,losses:0,points:0,diff:0}); const h=computed.get(String(m.homeId)),a=computed.get(String(m.awayId)); h.matchesPlayed++;a.matchesPlayed++;h.diff+=pair[0]-pair[1];a.diff+=pair[1]-pair[0]; if(pair[0]>pair[1]){h.wins++;h.points+=3;a.losses++;}else if(pair[1]>pair[0]){a.wins++;a.points+=3;h.losses++;}else{h.draws++;a.draws++;h.points++;a.points++;}}
   const standings=complete?[...computed.values()].sort(compare).map((r,i)=>({...r,finalRank:i+1})):[];
   const statsMismatch=[];
   if(complete) for(const r of standings){const src=sourceRows.find(s=>s.id===r.id);if(!src||['matchesPlayed','wins','draws','losses','points','diff'].some(k=>src[k]!==r[k]))statsMismatch.push({id:r.id,source:src||null,fromMatches:Object.fromEntries(['matchesPlayed','wins','draws','losses','points','diff'].map(k=>[k,r[k]])),finalRank:r.finalRank});}
   const reasons=[]; if(groupTables.length!==1)reasons.push(groupTables.length===0?'TABLE_MISSING':'DUPLICATE_TABLES');if(groupSlots.length!==TEAMS)reasons.push('SLOT_COUNT_NOT_8');if(groupMatches.length!==expected)reasons.push('MATCH_COUNT_NOT_56');if(!canonicalShape)reasons.push('FIXTURE_SHAPE_INVALID');if(finishedCount!==expected)reasons.push('UNFINISHED_MATCHES');if(validScores!==expected)reasons.push('MISSING_OR_INVALID_SCORES');if(slotIssues.length)reasons.push('SLOT_FIXTURE_CONFLICT');if(staleRows.length)reasons.push('STALE_STANDINGS_ROWS');if(duplicateRanks.length)reasons.push('DUPLICATE_STANDINGS_RANKS');if(statsMismatch.length)reasons.push('STANDINGS_STATS_MISMATCH');
   reports.push({group:g.key,tableCount:groupTables.length,tableDocumentId:t?.docId||null,slots:groupSlots.length,matches:groupMatches.length,finishedMatches:finishedCount,matchesWithValidScores:validScores,participants:participantIds.size,canonicalShape,complete,slotIssues,staleRows,duplicateRanks,rankConflicts,statsMismatch,reasons,computedStandings:complete?standings:undefined,tableRows:sourceRows});
 }
 const report={generatedAt:new Date().toISOString(),readOnly:true,projectId,emulatorHost,season:SEASON,leagueId:LEAGUE,config:cfg.exists?normalize(cfg.data()||{}):null,totals:{groups:reports.length,tables:tables.length,matches:matches.length,slots:slots.length,completeGroups:reports.filter(r=>r.complete&&r.reasons.length===0).length,groupsWithIssues:reports.filter(r=>r.reasons.length>0).length},groups:reports,warning:'READ-ONLY AUDIT. No Firestore documents were changed. Do not start rollover or manually edit data based on this report alone.'};
 const outDir=path.resolve(process.cwd(),'recovery-snapshots');fs.mkdirSync(outDir,{recursive:true});const out=path.join(outDir,`season1-all-groups-audit-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);fs.writeFileSync(out,JSON.stringify(report,null,2),'utf8');
 console.log(JSON.stringify({success:true,readOnly:true,snapshotFile:out,config:report.config?{phase:report.config.phase,activeSeasonNumber:report.config.activeSeasonNumber,nextSeasonNumber:report.config.nextSeasonNumber,nextSeasonStart:report.config.nextSeasonStart,rebuildStatus:report.config.rebuildStatus,rebuildError:report.config.rebuildError}:null,totals:report.totals,groups:reports.map(r=>({group:r.group,tableCount:r.tableCount,slots:r.slots,matches:r.matches,finishedMatches:r.finishedMatches,matchesWithValidScores:r.matchesWithValidScores,participants:r.participants,complete:r.complete,reasons:r.reasons,slotIssues:r.slotIssues.length,staleRows:r.staleRows.length,duplicateRanks:r.duplicateRanks.length,statsMismatch:r.statsMismatch.length}))},null,2));
 await admin.app().delete();
}
main().catch(async e=>{console.error(JSON.stringify({success:false,readOnly:true,error:String(e&&e.stack||e)},null,2));try{await admin.app().delete()}catch{}process.exitCode=1;});
