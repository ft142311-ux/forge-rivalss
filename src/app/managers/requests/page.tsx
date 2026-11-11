'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser, useAuth, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { acceptFriendRequestAction } from '@/app/actions/social';
import { runWithFreshIdToken } from '@/lib/client-auth-action';
import { useGameState } from '@/app/lib/store';
import { collection, query, where, doc, deleteDoc } from 'firebase/firestore';
import { 
  ChevronLeft, UserPlus, Shield, User,
  Check, X, Loader2, Lock
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export default function FriendRequestsPage() {
  const { user, isUserLoading } = useUser();
  const auth = useAuth();
  const router = useRouter();
  const db = useFirestore();
  const { toast } = useToast();
  const { language, isLoaded } = useGameState();
  const [isProcessing, setIsProcessing] = useState<string | null>(null);

  const requestsQuery = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return query(
      collection(db, 'friend_requests_v4'),
      where('toId', '==', user.uid),
      where('status', '==', 'pending')
    );
  }, [db, user?.uid]);

  const { data: requests, isLoading: isRequestsLoading } = useCollection(requestsQuery);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/auth/login');
    }
  }, [user, isUserLoading, router]);

  const translations = {
    en: {
      title: "FRIEND REQUESTS",
      subtitle: "Pending Alliance Proposals",
      accept: "Accept",
      reject: "Decline",
      noRequests: "No pending requests",
      noRequestsDesc: "Managers will appear here when they send you a friendship proposal.",
      success: "Friend request accepted",
      rejected: "Request declined",
      offline: "OFFLINE: Friendship terminal restricted."
    },
    ru: {
      title: "ХОТЯТ ДРУЖИТЬ",
      subtitle: "Ожидающие запросы на альянс",
      accept: "Принять",
      reject: "Отклонить",
      noRequests: "Нет активных запросов",
      noRequestsDesc: "Здесь появятся менеджеры, которые предложат вам дружбу.",
      success: "Запрос в друзья принят",
      rejected: "Запрос отклонен",
      offline: "ОФЛАЙН: Терминал дружбы недоступен."
    }
  };

  const t = translations[language as keyof typeof translations] || translations.ru;

  if (isUserLoading || !isLoaded || !user) {
    return <LoadingScreen />;
  }

  if (!db) {
    return (
      <div className="max-w-md mx-auto px-4 pt-8 text-center">
        <header className="mb-6 flex items-center gap-4 text-left">
          <Link href="/managers"><Button variant="ghost" size="icon" className="rounded-full"><ChevronLeft className="w-6 h-6" /></Button></Link>
          <div><h1 className="text-2xl font-headline font-bold uppercase">{t.title}</h1></div>
        </header>
        <div className="py-20 opacity-30 flex flex-col items-center gap-6">
           <Lock className="w-16 h-16" />
           <p className="text-xs font-black uppercase tracking-widest">{t.offline}</p>
        </div>
      </div>
    );
  }

  const handleRequest = async (request: any, accept: boolean) => {
    if (!db) return;
    setIsProcessing(request.id);
    try {
      const requestRef = doc(db, 'friend_requests_v4', request.id);
      if (accept) {
        if (!user) throw new Error('AUTHENTICATION_REQUIRED');
        const result = await runWithFreshIdToken(auth, user, (idToken) =>
          acceptFriendRequestAction(idToken, request.id, language === 'ru' ? 'ru' : 'en')
        );
        if (!result.success) throw new Error(result.error || 'FRIEND_REQUEST_ACCEPT_FAILED');
        toast({ title: t.success });
      } else {
        await deleteDoc(requestRef);
        toast({ title: t.rejected });
      }
    } catch (e: any) {
      console.error("Failed to process request:", e);
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setIsProcessing(null);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-20">
      <header className="mb-6 flex items-center gap-4">
        <Link href="/managers">
          <Button variant="ghost" size="icon" className="rounded-full">
            <ChevronLeft className="w-6 h-6" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter">{t.title}</h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest">{t.subtitle}</p>
        </div>
      </header>

      <div className="space-y-3">
        {isRequestsLoading ? (
          <div className="py-20 flex flex-col items-center justify-center space-y-4 opacity-50">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-[10px] uppercase font-black tracking-widest">Scanning network...</p>
          </div>
        ) : requests && requests.length > 0 ? (
          requests.map((request) => (
            <Card key={request.id} className="glass-card border-white/5 bg-secondary/10 overflow-hidden animate-in fade-in slide-in-from-bottom-2">
              <CardContent className="p-4">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-full bg-secondary/50 flex items-center justify-center border border-white/10 shrink-0">
                    <User className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold uppercase tracking-tight truncate">{request.fromName}</h3>
                    <p className="text-[8px] text-muted-foreground font-black uppercase tracking-widest mt-0.5">
                      Proposal Sent
                    </p>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-2">
                  <Button 
                    size="sm" 
                    className="h-10 hero-gradient font-black text-[10px] uppercase"
                    disabled={!!isProcessing}
                    onClick={() => handleRequest(request, true)}
                  >
                    {isProcessing === request.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3 mr-2" />}
                    {t.accept}
                  </Button>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    className="h-10 border-white/10 font-black text-[10px] uppercase text-muted-foreground"
                    disabled={!!isProcessing}
                    onClick={() => handleRequest(request, false)}
                  >
                    <X className="w-3 h-3 mr-2" />
                    {t.reject}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <div className="py-20 flex flex-col items-center justify-center text-center opacity-30">
            <UserPlus className="w-16 h-16 mb-4" />
            <h2 className="text-xl font-headline font-bold uppercase">{t.noRequests}</h2>
            <p className="text-[10px] uppercase font-bold tracking-[0.2em] mt-2 max-w-[250px]">
              {t.noRequestsDesc}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}