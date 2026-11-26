'use server';

import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';

const YEAR_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = YEAR_MS / 12;

export async function repairCurrentPlayerAges(idToken:string) {
  const {uid}=await requireServerActor(idToken);
  const db=getAdminDb();
  const ref=db.collection('players_v14').doc(uid);
  const snap=await ref.get();
  if(!snap.exists) return {success:true,changed:false};
  const player=snap.data()||{};
  const owned=Array.isArray(player.ownedPlayers) ? player.ownedPlayers : [];
  if(!owned.length) return {success:true,changed:false};

  let changed=false;
  const now=Date.now();
  const repaired=owned.map((p:any,index:number)=>{
    const validBirth=typeof p.birthDate==='string' && !Number.isNaN(new Date(p.birthDate).getTime());
    const numericAge=Number(p.age);
    const legacy18=!validBirth && numericAge>=17.9 && numericAge<=18.1;
    const invalidAge=!validBirth && (!Number.isFinite(numericAge) || numericAge<=0);
    if(validBirth && p.ageSystemVersion>=5) return p;
    if(!legacy18 && !invalidAge && validBirth) return p;

    const youth=Boolean(p.isYouth);
    const min=youth?14:18;
    const max=youth?16:30;
    const years=min+Math.floor(Math.random()*(max-min+1));
    const month=Math.floor(Math.random()*13);
    const age=years+month/12;
    changed=true;
    return {...p,age,baseAge:age,ageDisplay:`${years}.${month}`,birthDate:new Date(now-(years*YEAR_MS+month*MONTH_MS)).toISOString(),ageSystemVersion:5};
  });

  if(changed) await ref.set({ownedPlayers:repaired,ageSystemVersion:5,updatedAt:new Date()},{merge:true});
  return {success:true,changed};
}
