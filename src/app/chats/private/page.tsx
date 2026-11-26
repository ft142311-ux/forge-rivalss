
'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUser, useFirestore, useCollection, useMemoFirebase, useDoc, updateDocumentNonBlocking, addDocumentNonBlocking } from '@/firebase';
import { useGameState } from '@/app/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  ChevronLeft, Send, Loader2, Mail, 
  User, ChevronRight, Crown, Lock
} from 'lucide-react';
import Link from 'next/link';
import { collection, query, serverTimestamp, doc, where, limit } from 'firebase/firestore';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Message {
  id: string;
  senderId: string;
  senderName: string;
  senderClubName?: string;
  senderClubLogo?: string;
  senderIsPremium?: boolean;
  receiverId: string;
  receiverName: string;
  participants: string[];
  text: string;
  createdAt: any;
  read: boolean;
}

export default function PrivateMessagesPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const db = useFirestore();
  const { language, isLoaded, clubName, clubLogo, isPremium } = useGameState();
  
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [selectedChatName, setSelectedChatName] = useState<string>('');
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Strictly use players_v14 for active profile
  const userRef = useMemoFirebase(() => {
    if (!db || !user) return null;
    return doc(db, 'players_v14', user.uid);
  }, [db, user]);
  
  const { data: profile } = useDoc(userRef);

  const messagesQuery = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return query(
      collection(db, 'private_messages_v3'),
      where('participants', 'array-contains', user.uid),
      limit(500)
    );
  }, [db, user?.uid]);

  const { data: rawMessages, isLoading: isMessagesLoading } = useCollection<Message>(messagesQuery);

  const allMessages = useMemo(() => {
    if (!rawMessages) return [];
    return [...rawMessages].sort((a, b) => {
      const timeA = a.createdAt?.toMillis?.() || 0;
      const timeB = b.createdAt?.toMillis?.() || 0;
      return timeA - timeB;
    });
  }, [rawMessages]);

  const conversations = useMemo(() => {
    if (!allMessages || !user) return [];
    const groups: Record<string, { id: string, name: string, clubLogo?: string, lastMessage: string, lastTime: any, unread: number }> = {};
    
    allMessages.forEach(msg => {
      const isSenderMe = msg.senderId === user.uid;
      const otherId = isSenderMe ? msg.receiverId : msg.senderId;
      const otherName = isSenderMe ? msg.receiverName : (msg.senderClubName || msg.senderName);
      const otherLogo = isSenderMe ? undefined : msg.senderClubLogo;
      
      if (!groups[otherId]) {
        groups[otherId] = { id: otherId, name: otherName, clubLogo: otherLogo, lastMessage: '', lastTime: null, unread: 0 };
      }
      
      groups[otherId].lastMessage = msg.text;
      groups[otherId].lastTime = msg.createdAt;
      if (msg.receiverId === user.uid && !msg.read) {
        groups[otherId].unread += 1;
      }
    });
    
    return Object.values(groups).sort((a, b) => (b.lastTime?.toMillis?.() || 0) - (a.lastTime?.toMillis?.() || 0));
  }, [allMessages, user]);

  useEffect(() => {
    const targetUid = searchParams.get('uid');
    const targetName = searchParams.get('name');
    if (targetUid && targetName && user && targetUid !== user.uid) {
      setSelectedChatId(targetUid);
      setSelectedChatName(targetName);
    }
  }, [searchParams, user]);

  useEffect(() => {
    if (db && selectedChatId && allMessages && user) {
      const unreadFromTarget = allMessages.filter(
        msg => msg.senderId === selectedChatId && msg.receiverId === user.uid && !msg.read
      );

      unreadFromTarget.forEach((msg) => {
        const msgRef = doc(db, 'private_messages_v3', msg.id);
        updateDocumentNonBlocking(msgRef, { read: true });
      });
    }
  }, [selectedChatId, allMessages, user, db]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [selectedChatId, allMessages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !message.trim() || !user || !profile || !selectedChatId || isSending) return;

    setIsSending(true);
    try {
      addDocumentNonBlocking(collection(db, 'private_messages_v3'), {
        senderId: user.uid,
        senderName: profile.displayName || "Manager",
        senderClubName: clubName || profile.displayName || "Manager",
        senderClubLogo: clubLogo || "",
        senderIsPremium: Boolean(isPremium),
        receiverId: selectedChatId,
        receiverName: selectedChatName,
        participants: [user.uid, selectedChatId],
        text: message.trim(),
        createdAt: serverTimestamp(),
        read: false
      });
      setMessage('');
    } finally {
      setIsSending(false);
    }
  };

  const translations = {
    en: {
      title: "PRIVATE MESSAGES",
      subtitle: "Secure End-to-End Frequency",
      noChats: "No active transmissions.",
      noChatsDesc: "Start a conversation from the Global Chat dossier.",
      placeholder: "Type message...",
      unread: "NEW",
      you: "YOU",
      connecting: "Syncing data...",
      offline: "OFFLINE: Encryption node unavailable."
    },
    ru: {
      title: "ЛИЧНЫЕ СООБЩЕНИЯ",
      subtitle: "Зашифрованный канал связи",
      noChats: "Нет активных переписок.",
      noChatsDesc: "Начните общение через досье игрока в общем чате.",
      placeholder: "Введите сообщение...",
      unread: "НОВОЕ",
      you: "ВЫ",
      connecting: "Синхронизация...",
      offline: "ОФЛАЙН: Узел шифрования недоступен."
    }
  };

  const t = translations[language as keyof typeof translations] || translations.ru;

  if (isUserLoading || !isLoaded || !user) {
    return <LoadingScreen />;
  }

  if (!db) {
    return (
      <div className="max-w-md mx-auto h-[calc(100dvh-3.5rem-4rem)] flex flex-col overflow-hidden relative">
        <header className="px-4 py-3 flex items-center gap-4 border-b border-white/5 bg-background/50 backdrop-blur-sm sticky top-0 z-10 flex-shrink-0">
          <Button variant="ghost" size="icon" className="rounded-full h-8 w-8" onClick={() => router.push('/chats')}><ChevronLeft className="w-5 h-5" /></Button>
          <div><h1 className="text-lg font-headline font-bold uppercase tracking-tighter leading-none">{t.title}</h1></div>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center opacity-30 gap-6">
           <Lock className="w-16 h-16" />
           <p className="text-xs font-black uppercase tracking-widest">{t.offline}</p>
        </div>
      </div>
    );
  }

  const currentChatMessages = allMessages.filter(msg => 
    (msg.senderId === user.uid && msg.receiverId === selectedChatId) ||
    (msg.senderId === selectedChatId && msg.receiverId === user.uid)
  );

  return (
    <div className="max-w-md mx-auto h-[calc(100dvh-3.5rem-4rem)] flex flex-col overflow-hidden relative">
      <header className="px-4 py-3 flex items-center gap-4 border-b border-white/5 bg-background/50 backdrop-blur-sm sticky top-0 z-10 flex-shrink-0">
        <Button variant="ghost" size="icon" className="rounded-full h-8 w-8" onClick={() => selectedChatId ? setSelectedChatId(null) : router.push('/chats')}>
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-lg font-headline font-bold uppercase tracking-tighter leading-none">
            {t.title}
          </h1>
          <p className="text-muted-foreground text-[8px] uppercase tracking-widest mt-1">
            {selectedChatId ? `ID: ${selectedChatId.slice(0, 8)}` : t.subtitle}
          </p>
        </div>
      </header>

      {!selectedChatId && (
        <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-hide">
          {isMessagesLoading ? (
            <div className="h-full flex flex-col items-center justify-center space-y-4 opacity-50">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-[10px] uppercase font-bold tracking-widest">{t.connecting}</p>
            </div>
          ) : conversations.length > 0 ? (
            conversations.map((chat) => (
              <Card 
                key={chat.id} 
                className={cn(
                  "glass-card border-white/5 hover:bg-white/5 cursor-pointer active:scale-[0.98] transition-all",
                  chat.unread > 0 && "border-accent/30 bg-accent/5"
                )}
                onClick={() => {
                  setSelectedChatId(chat.id);
                  setSelectedChatName(chat.name);
                }}
              >
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-secondary/50 flex items-center justify-center border border-white/10 shrink-0 overflow-hidden">
                      {chat.clubLogo ? (
                        <img src={chat.clubLogo} alt="" className="w-full h-full object-contain p-2" />
                      ) : (
                        <User className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <h3 className="text-sm font-bold uppercase tracking-tight truncate">{chat.name}</h3>
                        <span className="text-[8px] text-muted-foreground font-mono">
                          {chat.lastTime ? new Date(chat.lastTime.toMillis?.() || 0).toLocaleDateString() : ''}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate leading-none">
                        {chat.lastMessage}
                      </p>
                    </div>
                  </div>
                  {chat.unread > 0 ? (
                    <Badge className="bg-accent text-accent-foreground text-[8px] h-5 px-1.5 font-black animate-pulse">
                      {chat.unread} {t.unread}
                    </Badge>
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  )}
                </CardContent>
              </Card>
            ))
          ) : (
            <div className="h-full flex flex-col items-center justify-center opacity-20 text-center px-10 pt-20">
              <Mail className="w-16 h-16 mb-4 mx-auto" />
              <h2 className="text-lg font-headline font-bold uppercase">{t.noChats}</h2>
              <p className="text-[10px] uppercase font-bold tracking-widest mt-2">{t.noChatsDesc}</p>
            </div>
          )}
        </div>
      )}

      {selectedChatId && (
        <>
          <div className="flex-1 overflow-y-auto px-4 space-y-4 scrollbar-hide pt-4 pb-20" ref={scrollRef}>
            {currentChatMessages.map((msg) => {
              const isMe = msg.senderId === user.uid;
              const displayName = isMe ? (clubName || msg.senderClubName || t.you) : (msg.senderClubName || msg.senderName);
              const displayLogo = isMe ? clubLogo : msg.senderClubLogo;
              const displayPremium = isMe ? isPremium : msg.senderIsPremium;

              return (
                <div key={msg.id} className={cn(
                  "flex flex-col max-w-[85%]",
                  isMe ? "ml-auto items-end" : "mr-auto items-start"
                )}>
                  <div className="flex items-center gap-2 mb-1 px-1">
                    {displayLogo && (
                      <img src={displayLogo} alt="" className="w-3.5 h-3.5 object-contain" />
                    )}
                    <span className={cn(
                      "text-[10px] font-black uppercase tracking-tight flex items-center gap-1",
                      displayPremium ? "text-yellow-500" : (isMe ? "text-accent" : "text-primary")
                    )}>
                      {displayName}
                      {displayPremium && <Crown className="w-2.5 h-2.5" />}
                    </span>
                    <span className="text-[8px] text-muted-foreground font-mono opacity-50">
                      {msg.createdAt ? new Date(msg.createdAt.toMillis?.() || 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                    </span>
                  </div>
                  <div className={cn(
                    "px-4 py-2 rounded-2xl text-sm leading-relaxed border shadow-sm",
                    isMe 
                      ? "bg-accent/10 border-accent/20 rounded-tr-none text-right" 
                      : "bg-secondary/50 border-white/5 rounded-tl-none text-left"
                  )}>
                    {msg.text}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="fixed bottom-20 left-0 right-0 z-30 flex justify-center px-0 pointer-events-none">
            <div className="w-full max-w-md pointer-events-auto bg-background/95 backdrop-blur-xl border-t border-white/10 p-2 pb-1.5 shadow-[0_-10px_20px_rgba(0,0,0,0.4)]">
              <form onSubmit={handleSendMessage} className="flex gap-2">
                <Input 
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={t.placeholder}
                  className="bg-secondary/50 border-white/10 h-11 text-sm focus-visible:ring-accent rounded-xl"
                  autoComplete="off"
                />
                <Button 
                  type="submit" 
                  disabled={!message.trim() || isSending}
                  className="h-11 w-11 rounded-xl bg-accent text-accent-foreground hover:bg-accent/90 p-0 flex items-center justify-center shrink-0 shadow-lg shadow-accent/20"
                >
                  {isSending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                </Button>
              </form>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
