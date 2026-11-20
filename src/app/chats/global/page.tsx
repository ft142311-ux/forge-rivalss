
'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useUser, useFirestore, useCollection, useMemoFirebase, useDoc, setDocumentNonBlocking } from '@/firebase';
import { useGameState } from '@/app/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  ChevronLeft, Send, Loader2, MessageSquare, 
  User, Mail, Shield, History, AlertTriangle, 
  CornerUpLeft, ChevronRight, UserPlus, Crown, UserMinus, Lock
} from 'lucide-react';
import Link from 'next/link';
import { collection, query, orderBy, limit, doc, where, getDocs, writeBatch, addDoc } from 'firebase/firestore';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';

export default function GlobalChatPage() {
  const { user, isUserLoading: userIsLoading } = useUser();
  const router = useRouter();
  const db = useFirestore();
  const { toast } = useToast();
  const { language, isLoaded, clubName, clubLogo, isPremium } = useGameState();
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isActionProcessing, setIsActionProcessing] = useState(false);
  const [selectedUser, setSelectedUser] = useState<{id: string, name: string, clubName?: string, clubLogo?: string} | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const userRef = useMemoFirebase(() => {
    if (!db || !user) return null;
    return doc(db, 'players_v14', user.uid);
  }, [db, user]);
  
  const { data: profile } = useDoc(userRef);

  const chatQuery = useMemoFirebase(() => {
    if (!db) return null;
    return query(
      collection(db, 'global_chat_v2'),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
  }, [db]);

  const { data: messages, isLoading: isChatLoading, error: chatError } = useCollection(chatQuery);

  const outgoingFriendsQuery = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return query(
      collection(db, 'friend_requests_v4'),
      where('fromId', '==', user.uid),
      where('status', '==', 'accepted')
    );
  }, [db, user?.uid]);

  const incomingFriendsQuery = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return query(
      collection(db, 'friend_requests_v4'),
      where('toId', '==', user.uid),
      where('status', '==', 'accepted')
    );
  }, [db, user?.uid]);

  const { data: outFriends } = useCollection(outgoingFriendsQuery);
  const { data: inFriends } = useCollection(incomingFriendsQuery);

  const friendsIds = useMemo(() => {
    const ids = new Set<string>();
    outFriends?.forEach(f => ids.add(f.toId));
    inFriends?.forEach(f => ids.add(f.fromId));
    return ids;
  }, [outFriends, inFriends]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !message.trim() || !user || !profile || isSending) return;

    setIsSending(true);
    try {
      const now = new Date().toISOString();
      await addDoc(collection(db, 'global_chat_v2'), {
        userId: String(user.uid),
        userName: String(profile.displayName || "Manager"),
        clubName: String(clubName || profile.displayName || "Manager"),
        clubLogo: String(clubLogo || ""),
        isPremium: Boolean(isPremium),
        text: String(message.trim()),
        createdAt: now
      });
      setMessage('');
    } catch (e) {
      console.error("Failed to send message", e);
      toast({
        title: language === 'ru' ? 'Не удалось отправить сообщение' : 'Message could not be sent',
        description: language === 'ru' ? 'Проверьте подключение и попробуйте снова.' : 'Check your connection and try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleReply = () => {
    if (selectedUser) {
      setMessage(`${selectedUser.clubName || selectedUser.name}, `);
      setSelectedUser(null);
    }
  };

  const handlePrivateMessage = () => {
    if (selectedUser) {
      router.push(`/chats/private?uid=${selectedUser.id}&name=${encodeURIComponent(selectedUser.clubName || selectedUser.name)}`);
    }
  };

  const handleAddFriend = async () => {
    if (!db || !selectedUser || !user || !profile || isActionProcessing) return;
    
    setIsActionProcessing(true);
    try {
      const requestId = `req_${user.uid}_${selectedUser.id}`;
      const requestRef = doc(db, 'friend_requests_v4', requestId);
      const now = new Date().toISOString();

      const requestData = {
        fromId: String(user.uid),
        fromName: String(clubName || profile.displayName || "Manager"),
        toId: String(selectedUser.id),
        toName: String(selectedUser.clubName || selectedUser.name),
        status: 'pending',
        createdAt: now,
        updatedAt: now
      };

      await setDocumentNonBlocking(requestRef, requestData);

      toast({ 
        title: language === 'ru' ? "Заявка отправлена!" : "Request Sent!",
        description: language === 'ru' ? `Вы предложили дружбу ${selectedUser.clubName || selectedUser.name}` : `Friendship proposed to ${selectedUser.clubName || selectedUser.name}`
      });
      setSelectedUser(null);
    } catch (e: any) {
      console.error("Failed to add friend from chat:", e);
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setIsActionProcessing(false);
    }
  };

  const handleRemoveFriend = async () => {
    if (!db || !selectedUser || !user || isActionProcessing) return;
    
    setIsActionProcessing(true);
    try {
      const q1 = query(collection(db, 'friend_requests_v4'), where('fromId', '==', user.uid), where('toId', '==', selectedUser.id));
      const q2 = query(collection(db, 'friend_requests_v4'), where('fromId', '==', selectedUser.id), where('toId', '==', user.uid));
      
      const [s1, s2] = await Promise.all([getDocs(q1), getDocs(q2)]);
      const batch = writeBatch(db);
      s1.docs.forEach(d => batch.delete(d.ref));
      s2.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();

      toast({ 
        title: language === 'ru' ? "Удален из друзей" : "Friend Removed",
        description: language === 'ru' ? `${selectedUser.clubName || selectedUser.name} удален из списка.` : `${selectedUser.clubName || selectedUser.name} removed from your list.`
      });
      setSelectedUser(null);
    } catch (e: any) {
      console.error("Failed to remove friend from chat:", e);
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setIsActionProcessing(false);
    }
  };

  const translations = {
    en: {
      title: "GLOBAL CHAT",
      subtitle: "Unencrypted Public Frequency",
      placeholder: "Type message...",
      send: "SEND",
      connecting: "Establishing connection...",
      loadError: "Could not load global chat. Check Firestore access and connection, then reload.",
      noTransmissions: "No transmissions detected on this frequency.",
      userMenu: "Operational Dossier",
      userMenuDesc: "Direct command options for",
      addFriend: "Add Friend",
      addFriendDesc: "Send friendship request",
      removeFriend: "Remove Friend",
      removeFriendDesc: "Terminate tactical alliance",
      reply: "Reply",
      replyDesc: "Direct mention in public chat",
      pm: "Private Messages",
      pmDesc: "Direct encrypted transmission",
      offline: "OFFLINE: Global communication network restricted."
    },
    ru: {
      title: "ОБЩИЙ ЧАТ",
      subtitle: "Незашифрованная открытая частота",
      placeholder: "Введите сообщение...",
      send: "ОТПР",
      connecting: "Установка связи...",
      loadError: "Не удалось загрузить общий чат. Проверьте подключение и права Firestore, затем обновите страницу.",
      noTransmissions: "Сигналов на данной частоте не обнаружено.",
      userMenu: "Оперативное досье",
      userMenuDesc: "Команды взаимодействия с",
      addFriend: "Добавить в друзья",
      addFriendDesc: "Отправить запрос на дружбу",
      removeFriend: "Удалить из друзей",
      removeFriendDesc: "Разорвать тактический альянс",
      reply: "Ответить",
      replyDesc: "Упомянуть в общем канале",
      pm: "Личные сообщения",
      pmDesc: "Прямая зашифрованная связь",
      offline: "ОФЛАЙН: Сеть общей связи недоступна."
    }
  };

  const t = translations[language as keyof typeof translations] || translations.ru;

  if (userIsLoading || !isLoaded || !user) {
    return <LoadingScreen />;
  }

  if (!db) {
    return (
      <div className="max-w-md mx-auto h-[calc(100dvh-3.5rem-4rem)] flex flex-col overflow-hidden relative">
        <header className="px-4 py-3 flex items-center gap-4 border-b border-white/5 bg-background/50 backdrop-blur-sm sticky top-0 z-10 flex-shrink-0">
          <Link href="/chats"><Button variant="ghost" size="icon" className="rounded-full h-8 w-8"><ChevronLeft className="w-5 h-5" /></Button></Link>
          <div><h1 className="text-lg font-headline font-bold uppercase tracking-tighter leading-none">{t.title}</h1></div>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center opacity-30 gap-6">
           <Lock className="w-16 h-16" />
           <p className="text-xs font-black uppercase tracking-widest">{t.offline}</p>
        </div>
      </div>
    );
  }

  const sortedMessages = messages ? [...messages].sort((a, b) => {
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeA - timeB;
  }) : [];

  const isSelectedFriend = friendsIds.has(selectedUser?.id || '');

  const actions = [
    { 
      label: isSelectedFriend ? t.removeFriend : t.addFriend, 
      desc: isSelectedFriend ? t.removeFriendDesc : t.addFriendDesc, 
      icon: isSelectedFriend ? UserMinus : UserPlus, 
      action: isSelectedFriend ? handleRemoveFriend : handleAddFriend, 
      color: isSelectedFriend ? 'text-destructive' : 'text-green-400' 
    },
    { label: t.reply, desc: t.replyDesc, icon: CornerUpLeft, action: handleReply },
    { label: t.pm, desc: t.pmDesc, icon: Mail, action: handlePrivateMessage },
    { label: language === 'ru' ? 'Страница игрока' : 'Player Page', desc: 'Detailed manager statistics', icon: User, disabled: true },
    { label: language === 'ru' ? 'Страница клуба' : 'Club Page', desc: 'Team history and roster', icon: Shield, disabled: true },
    { label: language === 'ru' ? 'История банов' : 'Ban History', desc: 'Operational conduct record', icon: History, disabled: true },
    { label: language === 'ru' ? 'Репорт' : 'Report', desc: 'Notify HQ of misconduct', icon: AlertTriangle, disabled: true, color: 'text-red-400' },
  ];

  return (
    <div className="max-w-md mx-auto h-[calc(100dvh-3.5rem-4rem)] flex flex-col overflow-hidden relative">
      <header className="px-4 py-3 flex items-center gap-4 border-b border-white/5 bg-background/50 backdrop-blur-sm sticky top-0 z-10 flex-shrink-0">
        <Link href="/chats">
          <Button variant="ghost" size="icon" className="rounded-full h-8 w-8">
            <ChevronLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-lg font-headline font-bold uppercase tracking-tighter leading-none">{t.title}</h1>
          <p className="text-muted-foreground text-[8px] uppercase tracking-widest mt-1">{t.subtitle}</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto space-y-1 scrollbar-hide pt-4 pb-24" ref={scrollRef}>
        {chatError ? (
          <div role="alert" className="mx-4 my-6 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-center">
            <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-destructive" />
            <p className="text-xs font-bold">{t.loadError}</p>
            <p className="mt-2 break-words text-[10px] text-muted-foreground">{chatError.message}</p>
          </div>
        ) : isChatLoading ? (
          <div className="h-full flex flex-col items-center justify-center space-y-4 opacity-50">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-[10px] uppercase font-bold tracking-widest">{t.connecting}</p>
          </div>
        ) : sortedMessages.length > 0 ? (
          sortedMessages.map((msg) => {
            const isMe = msg.userId === user.uid;
            return (
              <div 
                key={msg.id} 
                onClick={() => setSelectedUser({ id: msg.userId, name: msg.userName, clubName: msg.clubName, clubLogo: msg.clubLogo })}
                className={cn(
                  "flex flex-col px-4 py-2 hover:bg-white/5 transition-colors cursor-pointer group active:bg-white/10",
                  isMe ? "items-end" : "items-start"
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  {msg.clubLogo && (
                    <img src={msg.clubLogo} alt="" className="w-3.5 h-3.5 object-contain" />
                  )}
                  <span className={cn(
                    "text-[10px] font-black uppercase tracking-tight flex items-center gap-1",
                    msg.isPremium ? "text-yellow-500" : (isMe ? "text-accent" : "text-primary")
                  )}>
                    {msg.clubName || msg.userName}
                    {msg.isPremium && <Crown className="w-2.5 h-2.5" />}
                  </span>
                  <span className="text-[8px] text-muted-foreground font-mono opacity-50">
                    {msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                  </span>
                </div>
                <div className={cn(
                  "px-4 py-2 rounded-2xl text-sm leading-relaxed border shadow-sm max-w-[90%]",
                  isMe 
                    ? "bg-primary/10 border-primary/20 rounded-tr-none text-right" 
                    : "bg-secondary/50 border-white/5 rounded-tl-none text-left"
                )}>
                  {msg.text}
                </div>
              </div>
            );
          })
        ) : (
          <div className="h-full flex flex-col items-center justify-center opacity-20 text-center px-10 py-20">
            <MessageSquare className="w-12 h-12 mb-4 mx-auto" />
            <p className="text-xs uppercase font-bold tracking-widest">{t.noTransmissions}</p>
          </div>
        )}
      </div>

      <div className="fixed bottom-20 left-0 right-0 z-30 flex justify-center px-0 pointer-events-none">
        <div className="w-full max-w-md pointer-events-auto bg-background/95 backdrop-blur-xl border-t border-white/10 p-2 pb-1.5 shadow-[0_-10px_20px_rgba(0,0,0,0.4)]">
          <form onSubmit={handleSendMessage} className="flex gap-2">
            <Input 
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t.placeholder}
              className="bg-secondary/50 border-white/10 h-11 text-sm focus-visible:ring-primary rounded-xl"
              autoComplete="off"
            />
            <Button 
              type="submit" 
              disabled={!message.trim() || isSending}
              className="h-11 w-11 rounded-xl hero-gradient p-0 flex items-center justify-center shrink-0 shadow-lg shadow-primary/20"
            >
              {isSending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </Button>
          </form>
        </div>
      </div>

      <Dialog open={!!selectedUser} onOpenChange={() => setSelectedUser(null)}>
        <DialogContent className="max-w-md bg-background border-white/10 p-0 overflow-hidden shadow-2xl">
          <DialogHeader className="p-6 bg-gradient-to-br from-primary/10 to-transparent border-b border-white/5">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-secondary/50 flex items-center justify-center border border-white/10 overflow-hidden">
                {selectedUser?.clubLogo ? (
                  <img src={selectedUser.clubLogo} alt="" className="w-full h-full object-contain p-2" />
                ) : (
                  <User className="w-6 h-6 text-primary" />
                )}
              </div>
              <div>
                <DialogTitle className="text-xl font-headline font-bold uppercase tracking-tight text-primary">
                  {selectedUser?.clubName || selectedUser?.name}
                </DialogTitle>
                <DialogDescription className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">
                  {t.userMenuDesc} {selectedUser?.clubName || selectedUser?.name}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="p-4 space-y-2 max-h-[60vh] overflow-y-auto scrollbar-hide">
            {actions.map((item, idx) => (
              <Card 
                key={idx}
                className={cn(
                  "glass-card border-white/5 transition-all",
                  item.disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-white/5 cursor-pointer active:scale-[0.98]"
                )}
                onClick={() => !item.disabled && item.action && item.action()}
              >
                <CardContent className="p-3 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-lg bg-secondary/50">
                      {isActionProcessing && (item.label === t.addFriend || item.label === t.removeFriend) ? (
                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                      ) : (
                        <item.icon className={cn("w-5 h-5", item.color || "text-primary")} />
                      )}
                    </div>
                    <div>
                      <h3 className={cn("text-xs font-bold uppercase", item.color)}>{item.label}</h3>
                      <p className="text-[9px] text-muted-foreground leading-tight">{item.desc}</p>
                    </div>
                  </div>
                  {!item.disabled && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="p-4 bg-secondary/20 border-t border-white/5">
            <Button 
              variant="outline" 
              className="w-full h-10 text-[10px] font-bold uppercase border-white/10"
              onClick={() => setSelectedUser(null)}
            >
              {language === 'ru' ? 'ЗАКРЫТЬ' : 'CLOSE'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
