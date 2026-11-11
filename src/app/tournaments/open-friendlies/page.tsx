'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useUser, useFirestore, useCollection, useMemoFirebase, useAuth } from '@/firebase';
import { useGameState } from '@/app/lib/store';
import { 
  ChevronLeft, Swords, Search, ShieldAlert, 
  User, Zap, Loader2, Target, Clock, Lock
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { query, collection, where, doc } from 'firebase/firestore';
import { challengeFriendlyLobbyAction } from '@/app/actions/friendly-matchmaking';
import { runWithFreshIdToken } from '@/lib/client-auth-action';
import { useToast } from '@/hooks/use-toast';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { cn } from '@/lib/utils';

export default function OpenFriendliesPage() {
  const { user, isUserLoading } = useUser();
  const auth = useAuth();
  const router = useRouter();
  const db = useFirestore();
  const { toast } = useToast();
  const { language, isLoaded } = useGameState();
  const [isChallenging, setIsChallenging] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  const lobbiesQuery = useMemoFirebase(() => {
    if (!db) return null;
    return query(collection(db, 'friendly_lobbies_v3'), where('status', '==', 'searching'));
  }, [db]);

  const { data: rawLobbies, isLoading: isLobbiesLoading } = useCollection(lobbiesQuery);
  

  const lobbies = useMemo(() => {
    if (!rawLobbies) return [];
    return rawLobbies.filter(lobby => {
      // The request lifetime is exactly 5 minutes from creation.
      // Never keep a lobby visible merely because updatedAt changed or is missing.
      const createdAtMs = lobby.createdAt?.toMillis?.() || 0;
      const expiresAtMs = lobby.expiresAt?.toMillis?.() || (createdAtMs ? createdAtMs + 5 * 60 * 1000 : 0);
      return !!expiresAtMs && expiresAtMs > now;
    });
  }, [rawLobbies, now]);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/auth/register');
    }
  }, [user, isUserLoading, router]);

  if (isUserLoading || !isLoaded || !user) {
    return <LoadingScreen />;
  }

  const translations = {
    en: {
      title: "OPEN FRIENDLIES",
      subtitle: "Tactical match-making hub",
      noLobbies: "No Active Requests",
      challenge: "CHALLENGE",
      selfRequest: "This is your request",
      toastSent: "Challenge Sent",
      busy: "Operational Conflict",
      offline: "OFFLINE: Matchmaking terminal restricted."
    },
    ru: {
      title: "ОТКРЫТЫЕ МАТЧИ",
      subtitle: "Хаб тактического подбора игроков",
      noLobbies: "Нет активных заявок",
      challenge: "ВЫЗВАТЬ",
      selfRequest: "Это ваша заявка",
      toastSent: "Вызов отправлен",
      busy: "Оперативный конфликт",
      offline: "ОФЛАЙН: Терминал подбора матчей недоступен."
    }
  };

  const t = translations[language as keyof typeof translations] || translations.ru;

  if (!db) {
    return (
      <div className="max-w-md mx-auto px-4 pt-8 text-center">
        <header className="mb-6 flex items-center gap-4">
          <Link href="/tournaments"><Button variant="ghost" size="icon" className="rounded-full"><ChevronLeft className="w-6 h-6" /></Button></Link>
          <div><h1 className="text-2xl font-headline font-bold uppercase">{t.title}</h1></div>
        </header>
        <div className="py-20 opacity-30 flex flex-col items-center gap-6">
           <Lock className="w-16 h-16" />
           <p className="text-xs font-black uppercase tracking-widest">{t.offline}</p>
        </div>
      </div>
    );
  }

  const handleChallenge = async (lobbyId: string) => {
    if (!user || isChallenging) return;
    setIsChallenging(lobbyId);
    try {
      await runWithFreshIdToken(auth, user, (token) => challengeFriendlyLobbyAction(token, lobbyId));
      toast({ title: t.toastSent });
    } catch (error: any) {
      console.error('[friendly] challenge failed', error);
      const code = String(error?.message || 'UNKNOWN_ERROR');
      const descriptions: Record<string, string> = {
        FRIENDLY_LOBBY_NOT_FOUND: 'Заявка больше недоступна.',
        FRIENDLY_LOBBY_EXPIRED: 'Срок заявки 5 минут уже истёк.',
        FRIENDLY_LOBBY_BUSY: 'Эта заявка уже получила запрос от другой команды.',
        FRIENDLY_CHALLENGE_REJECTED: 'Вы уже получали отказ по этой заявке.',
        OWN_FRIENDLY_LOBBY: 'Нельзя отправить запрос самому себе.',
      };
      toast({
        title: language === 'ru' ? 'Не удалось отправить запрос' : 'Challenge failed',
        description: descriptions[code] || code,
        variant: 'destructive',
      });
    } finally {
      setIsChallenging(null);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-20">
      <header className="mb-6 flex items-center gap-4">
        <Link href="/tournaments"><Button variant="ghost" size="icon" className="rounded-full"><ChevronLeft className="w-6 h-6" /></Button></Link>
        <div><h1 className="text-2xl font-headline font-bold uppercase">{t.title}</h1><p className="text-muted-foreground text-[10px] uppercase">{t.subtitle}</p></div>
      </header>
      {isLobbiesLoading ? (
        <div className="py-20 text-center opacity-50"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></div>
      ) : lobbies.length > 0 ? (
        <div className="space-y-3">
          {lobbies.map((lobby) => (
            <Card key={lobby.id} className="glass-card">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <User className="w-10 h-10 text-muted-foreground" />
                  <div><h3 className="text-sm font-bold uppercase">{lobby.hostName}</h3></div>
                </div>
                {lobby.hostId === user.uid ? <span className="text-[8px] uppercase">{t.selfRequest}</span> : <Button size="sm" className="hero-gradient" onClick={() => handleChallenge(lobby.id)} disabled={!!isChallenging}>{t.challenge}</Button>}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="py-20 text-center opacity-30"><ShieldAlert className="w-16 h-16 mx-auto mb-4" /><p>{t.noLobbies}</p></div>
      )}
    </div>
  );
}
