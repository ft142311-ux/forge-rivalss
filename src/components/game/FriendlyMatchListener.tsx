'use client';

import { useEffect, useMemo, useState } from 'react';
import { useUser, useAuth, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { signOut } from 'firebase/auth';
import { doc, collection, query, where, getDocs, getDoc } from 'firebase/firestore';
import { respondFriendlyChallengeAction, resolveDueFriendlyMatchesForUserAction, ensureFriendlyMatchReportAction } from '@/app/actions/friendly-matchmaking';
import { useGameState } from '@/app/lib/store';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Swords, Shield, X, Check } from 'lucide-react';

/** Global friendly-match challenge dialog. Mounted in root layout so it is visible on every game tab. */
export function FriendlyMatchListener() {
  const { user } = useUser();
  const auth = useAuth();
  const db = useFirestore();
  const { language } = useGameState();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const lobbyRef = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return doc(db, 'friendly_lobbies_v3', user.uid);
  }, [db, user?.uid]);

  const { data: lobby } = useDoc(lobbyRef);

  useEffect(() => {
    setOpen(lobby?.status === 'challenged' && !!lobby?.challengerId);
  }, [lobby?.status, lobby?.challengerId]);

  // The scheduled friendly match must not depend exclusively on an external cron.
  // The emulator normally has no scheduler, so each online participant performs
  // an idempotent due-match check. The server checks both host and challenger.
  useEffect(() => {
    if (!user || !db) return;

    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const token = await user.getIdToken(true);
        const resolution = await resolveDueFriendlyMatchesForUserAction(token);
        if (resolution?.error === 'AUTH_SESSION_EXPIRED') {
          // A revoked Firebase session cannot be repaired by refreshing its ID
          // token. Sign out cleanly so the normal auth guard can request login.
          if (auth) await signOut(auth);
          return;
        }

        // Hard guarantee: after the scheduled time, explicitly ensure every
        // participant's friendly report exists in matches_v2. This is the
        // authoritative queue consumed by Match Overview.
        const [hosted, challenged] = await Promise.all([
          getDocs(query(collection(db, 'friendly_matches_v1'), where('hostId', '==', user.uid))),
          getDocs(query(collection(db, 'friendly_matches_v1'), where('challengerId', '==', user.uid))),
        ]);
        const ids = new Set<string>();
        [...hosted.docs, ...challenged.docs].forEach((snap: any) => ids.add(snap.id));
        for (const matchId of ids) {
          const matchSnap = await getDoc(doc(db, 'friendly_matches_v1', matchId));
          const data: any = matchSnap.data();
          const due = data?.scheduledStartAt?.toMillis?.() <= Date.now();
          if (data?.status === 'finished' || (data?.status === 'scheduled' && due)) {
            await ensureFriendlyMatchReportAction(token, matchId);
          }
        }
      } catch (error) {
        console.error('[friendly] scheduled match resolve check failed', error);
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), 15000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [user, db, auth]);

  const respond = async (decision: 'accept' | 'reject') => {
    if (!user || !lobby?.challengerId || busy) return;
    setBusy(true);
    try {
      await respondFriendlyChallengeAction(await user.getIdToken(true), decision);
      setOpen(false);
    } catch (error) {
      console.error('[friendly] response failed', error);
    } finally {
      setBusy(false);
    }
  };

  const ru = language === 'ru';
  const challengerName = lobby?.challengerName || (ru ? 'Команда соперника' : 'Opponent team');

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) setOpen(false); }}>
      <DialogContent className="max-w-md bg-card border-white/10 p-0 overflow-hidden shadow-2xl">
        <div className="p-6 text-center bg-gradient-to-br from-primary/20 via-background to-accent/10 border-b border-white/5">
          <DialogHeader>
            <div className="mx-auto mb-3 w-12 h-12 rounded-2xl bg-secondary/40 border border-white/10 flex items-center justify-center">
              <Swords className="w-6 h-6 text-primary" />
            </div>
            <DialogTitle className="text-xl font-headline font-bold uppercase tracking-tight text-primary">
              {ru ? 'Новый запрос на матч' : 'New match challenge'}
            </DialogTitle>
            <DialogDescription className="text-center text-xs mt-3 italic text-muted-foreground leading-relaxed bg-secondary/20 p-4 rounded-xl border border-white/5">
              {ru ? `${challengerName} хочет сыграть с вашей командой товарищеский матч.` : `${challengerName} wants to play a friendly match against your team.`}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="p-6 space-y-3">
          <div className="bg-secondary/30 p-4 rounded-2xl text-center border border-white/5 shadow-inner">
            <div className="flex items-center justify-center gap-3">
              <Shield className="w-5 h-5 text-primary" />
              <span className="text-sm font-black uppercase truncate">{challengerName}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="p-4 bg-secondary/20 border-t border-white/5 grid grid-cols-2 gap-3 sm:flex sm:justify-end">
          <Button variant="outline" disabled={busy} onClick={() => respond('reject')} className="h-11 border-white/10 text-[9px] font-black uppercase tracking-widest">
            <X className="w-4 h-4 mr-2" /> {ru ? 'ОТКЛОНИТЬ' : 'REJECT'}
          </Button>
          <Button disabled={busy} onClick={() => respond('accept')} className="h-11 hero-gradient text-[9px] font-black uppercase tracking-widest">
            <Check className="w-4 h-4 mr-2" /> {ru ? 'ПРИНЯТЬ' : 'ACCEPT'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
