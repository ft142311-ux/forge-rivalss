'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useUser, useFirestore, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { useGameState, Gift } from '@/app/lib/store';
import { collection, query, where, doc, getDocs, writeBatch } from 'firebase/firestore';
import { 
  ChevronLeft, UserCheck, Shield, User,
  Mail, MessageSquare, ChevronRight, Loader2,
  UserMinus, History, Search, Filter, Gift as GiftIcon, X, Lock
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { cn } from '@/lib/utils';
import { getMoscowTime } from '@/app/lib/time-utils';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";

export default function FriendsListPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const db = useFirestore();
  const { toast } = useToast();
  const { language, isLoaded, activeLicenseTier, availableGiftsToSend = [], sendGift } = useGameState();
  const [selectedFriend, setSelectedFriend] = useState<{id: string, name: string} | null>(null);
  const [showGiftModal, setShowGiftModal] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isActionProcessing, setIsActionProcessing] = useState(false);

  const isSTier = activeLicenseTier === 1;

  // Query for accepted requests - protected from null db
  const outgoingQuery = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return query(
      collection(db, 'friend_requests_v4'),
      where('fromId', '==', user.uid),
      where('status', '==', 'accepted')
    );
  }, [db, user?.uid]);

  const incomingQuery = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return query(
      collection(db, 'friend_requests_v4'),
      where('toId', '==', user.uid),
      where('status', '==', 'accepted')
    );
  }, [db, user?.uid]);

  const { data: outgoingFriends, isLoading: isOutLoading } = useCollection(outgoingQuery);
  const { data: incomingFriends, isLoading: isInLoading } = useCollection(incomingQuery);

  const friends = useMemo(() => {
    const list: any[] = [];
    if (outgoingFriends) {
      outgoingFriends.forEach(f => list.push({ id: f.toId, name: f.toName }));
    }
    if (incomingFriends) {
      incomingFriends.forEach(f => list.push({ id: f.fromId, name: f.fromName }));
    }
    return list;
  }, [outgoingFriends, incomingFriends]);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/auth/login');
    }
  }, [user, isUserLoading, router]);

  const t = {
    en: {
      title: "MY FRIENDS",
      subtitle: "Trusted Alliance Network",
      noFriends: "No friends in network",
      noFriendsDesc: "Search for managers in the 'All Managers' terminal to establish contact.",
      findFriends: "FIND MANAGERS",
      userMenuDesc: "Direct command options for",
      pm: "Private Messages",
      pmDesc: "Direct encrypted transmission",
      gift: "Send Gift",
      giftDesc: "S-Tier exclusive diplomat cargo",
      remove: "Remove Friend",
      removeDesc: "Terminate tactical alliance",
      profile: "Manager Profile",
      profileDesc: "Operational statistics",
      close: "CLOSE",
      giftTitle: "DIPLOMATIC CARGO",
      giftSub: "Select a gift to send to",
      noGifts: "No gifts available today",
      noGiftsDesc: "Gifts reset every 24 hours at 00:00 MSK.",
      offline: "OFFLINE: Alliance node unavailable."
    },
    ru: {
      title: "МОИ ДРУЗЬЯ",
      subtitle: "Доверенная сеть альянса",
      noFriends: "Друзей пока нет",
      noFriendsDesc: "Используйте поиск в терминале «Все менеджеры», чтобы найти союзников.",
      findFriends: "НАЙТИ МЕНЕДЖЕРОВ",
      userMenuDesc: "Команды взаимодействия с",
      pm: "Личные сообщения",
      pmDesc: "Прямая зашифрованная связь",
      gift: "Отправить подарок",
      giftDesc: "Дипломатический груз S-Tier",
      remove: "Удалить из друзей",
      removeDesc: "Разорвать тактический альянс",
      profile: "Профиль менеджера",
      profileDesc: "Оперативная статистика",
      close: "ЗАКРЫТЬ",
      giftTitle: "ДИПЛОМАТИЧЕСКИЙ ГРУЗ",
      giftSub: "Выберите подарок для",
      noGifts: "На сегодня подарков нет",
      noGiftsDesc: "Подарки выдаются каждые 24 часа в 00:00 МСК.",
      offline: "ОФЛАЙН: Узел альянса недоступен."
    }
  }[language as 'en' | 'ru'];

  if (isUserLoading || !isLoaded || !user) {
    return <LoadingScreen />;
  }

  if (!db) {
    return (
      <div className="max-w-md mx-auto px-4 pt-8 text-center">
        <header className="mb-6 flex items-center gap-4">
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

  const handleSendGiftToFriend = async (gift: Gift) => {
    if (!selectedFriend || isSending) return;
    setIsSending(true);
    try {
      const success = await sendGift(gift, selectedFriend.id, selectedFriend.name);
      if (success) {
        toast({ title: language === 'ru' ? "Подарок отправлен!" : "Gift Sent!" });
        setShowGiftModal(false);
        setSelectedFriend(null);
      } else {
        toast({ variant: "destructive", title: language === 'ru' ? "Ошибка отправки" : "Sending Failed" });
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleRemoveFriend = async () => {
    if (!db || !selectedFriend || !user || isActionProcessing) return;
    
    setIsActionProcessing(true);
    try {
      const q1 = query(collection(db, 'friend_requests_v4'), where('fromId', '==', user.uid), where('toId', '==', selectedFriend.id));
      const q2 = query(collection(db, 'friend_requests_v4'), where('fromId', '==', selectedFriend.id), where('toId', '==', user.uid));
      
      const [s1, s2] = await Promise.all([getDocs(q1), getDocs(q2)]);
      const batch = writeBatch(db);
      s1.docs.forEach(d => batch.delete(d.ref));
      s2.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();

      toast({ 
        title: language === 'ru' ? "Удален из друзей" : "Friend Removed",
        description: language === 'ru' ? `${selectedFriend.name} удален из списка.` : `${selectedFriend.name} removed from your list.`
      });
      setSelectedFriend(null);
    } catch (e: any) {
      console.error("Failed to remove friend:", e);
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setIsActionProcessing(false);
    }
  };

  const handlePrivateMessage = () => {
    if (selectedFriend) {
      router.push(`/chats/private?uid=${selectedFriend.id}&name=${encodeURIComponent(selectedFriend.name)}`);
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

      <div className="space-y-2">
        {(isOutLoading || isInLoading) ? (
          <div className="py-20 flex flex-col items-center justify-center space-y-4 opacity-50">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-[10px] uppercase font-black tracking-widest">Scanning alliance node...</p>
          </div>
        ) : friends.length > 0 ? (
          friends.map((friend) => (
            <Card 
              key={friend.id} 
              className="glass-card border-white/5 hover:bg-white/5 cursor-pointer transition-all active:scale-95 duration-75"
              onClick={() => setSelectedFriend({ id: friend.id, name: friend.name })}
            >
              <CardContent className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-secondary/50 flex items-center justify-center border border-white/10">
                    <User className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold uppercase text-white">{friend.name}</h3>
                    <p className="text-[8px] text-muted-foreground font-black uppercase tracking-widest mt-0.5">Confirmed Ally</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[7px] border-green-500/20 text-green-400 uppercase">Friend</Badge>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <div className="py-20 flex flex-col items-center justify-center text-center animate-in fade-in duration-700">
            <div className="w-20 h-20 rounded-full bg-secondary/10 border-2 border-dashed border-white/5 flex items-center justify-center mb-6">
              <UserCheck className="w-10 h-10 text-muted-foreground opacity-20" />
            </div>
            <h2 className="text-xl font-headline font-bold uppercase text-white tracking-tight">{t.noFriends}</h2>
            <p className="text-xs text-muted-foreground mt-2 max-w-[250px] leading-relaxed italic">
              {t.noFriendsDesc}
            </p>
            <Link href="/managers/all" className="mt-8">
              <Button className="h-12 px-8 hero-gradient font-black text-[10px] uppercase tracking-widest shadow-xl">
                <Search className="w-4 h-4 mr-2" /> {t.findFriends}
              </Button>
            </Link>
          </div>
        )}
      </div>

      <Dialog open={!!selectedFriend && !showGiftModal} onOpenChange={(open) => { if (!open) setSelectedFriend(null); }}>
        <DialogContent className="max-w-md bg-background border-white/10 p-0 overflow-hidden shadow-2xl">
          <div className="p-6 bg-gradient-to-br from-primary/10 to-transparent border-b border-white/5">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-secondary/50 flex items-center justify-center border border-white/10">
                <User className="w-8 h-8 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-xl font-headline font-bold uppercase tracking-tight text-primary">
                  {selectedFriend?.name}
                </DialogTitle>
                <DialogDescription className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">
                  {t.userMenuDesc} {selectedFriend?.name}
                </DialogDescription>
              </div>
            </div>
          </div>

          <div className="p-4 space-y-2">
            {isSTier && (
              <Card 
                className="glass-card border-accent/20 bg-accent/5 hover:bg-accent/10 cursor-pointer transition-all active:scale-95 duration-75"
                onClick={() => setShowGiftModal(true)}
              >
                <CardContent className="p-3 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-lg bg-accent/20">
                      <GiftIcon className="w-5 h-5 text-accent" />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold uppercase text-accent">{t.gift}</h3>
                      <p className="text-[9px] text-muted-foreground leading-tight">{t.giftDesc}</p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </CardContent>
              </Card>
            )}

            <Card 
              className="glass-card border-white/5 hover:bg-white/5 cursor-pointer transition-all active:scale-95 duration-75"
              onClick={handlePrivateMessage}
            >
              <CardContent className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-2 rounded-lg bg-secondary/50">
                    <Mail className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold uppercase text-white">{t.pm}</h3>
                    <p className="text-[9px] text-muted-foreground leading-tight">{t.pmDesc}</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </CardContent>
            </Card>

            <Card 
              className="glass-card border-white/5 hover:bg-white/5 cursor-pointer transition-all active:scale-95 duration-75"
              onClick={handleRemoveFriend}
            >
              <CardContent className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-2 rounded-lg bg-secondary/50">
                    {isActionProcessing ? <Loader2 className="w-5 h-5 animate-spin text-destructive" /> : <UserMinus className="w-5 h-5 text-destructive" />}
                  </div>
                  <div>
                    <h3 className="text-xs font-bold uppercase text-destructive">{t.remove}</h3>
                    <p className="text-[9px] text-muted-foreground leading-tight">{t.removeDesc}</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </CardContent>
            </Card>
          </div>

          <div className="p-4 bg-secondary/20 border-t border-white/5">
            <Button 
              variant="outline" 
              className="w-full h-10 text-[10px] font-bold uppercase border-white/10"
              onClick={() => setSelectedFriend(null)}
            >
              {t.close}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showGiftModal} onOpenChange={setShowGiftModal}>
        <DialogContent className="max-w-md bg-background border-white/10 p-0 overflow-hidden shadow-2xl flex flex-col h-[70vh]">
          <div className="p-6 text-center bg-gradient-to-br from-accent/20 via-background to-transparent border-b border-white/5 flex-shrink-0">
             <div className="mx-auto w-12 h-12 rounded-full bg-secondary/50 flex items-center justify-center mb-4 border border-accent/40 shadow-[0_0_15px_rgba(var(--accent),0.2)]">
               <GiftIcon className="w-6 h-6 text-accent animate-bounce" />
             </div>
             <DialogTitle className="text-xl font-headline font-bold uppercase tracking-tight text-white">{t.giftTitle}</DialogTitle>
             <DialogDescription className="text-[10px] text-muted-foreground mt-2 uppercase font-black tracking-widest">{t.giftSub} {selectedFriend?.name}</DialogDescription>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-hide">
            {(availableGiftsToSend?.length || 0) > 0 ? availableGiftsToSend.map((gift) => (
              <Card 
                key={gift.id} 
                className="glass-card border-white/5 hover:bg-white/5 cursor-pointer transition-all active:scale-95 duration-75"
                onClick={() => handleSendGiftToFriend(gift)}
              >
                <CardContent className="p-4 flex items-center justify-between">
                   <div className="flex items-center gap-4">
                      <div className="p-2 rounded-lg bg-accent/10">
                        <GiftIcon className="w-5 h-5 text-accent" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold uppercase text-white">{gift.label}</h4>
                        <p className="text-[8px] text-muted-foreground uppercase font-black mt-1">READY FOR SHIPMENT</p>
                      </div>
                   </div>
                   {isSending ? <Loader2 className="w-4 h-4 animate-spin text-accent" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                </CardContent>
              </Card>
            )) : (
              <div className="py-12 text-center opacity-30 border border-dashed border-white/10 rounded-2xl flex flex-col items-center gap-4 px-6">
                 <History className="w-10 h-10" />
                 <div>
                   <p className="text-sm font-bold uppercase text-white">{t.noGifts}</p>
                   <p className="text-[9px] font-black uppercase mt-1 leading-relaxed">{t.noGiftsDesc}</p>
                 </div>
              </div>
            )}
          </div>

          <div className="p-4 bg-secondary/20 border-t border-white/5 flex-shrink-0">
             <Button 
               variant="ghost" 
               className="w-full text-[10px] uppercase font-bold text-muted-foreground"
               onClick={() => setShowGiftModal(false)}
             >
               {language === 'ru' ? 'ОТМЕНА' : 'CANCEL'}
             </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}