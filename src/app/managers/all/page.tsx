
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useUser, useFirestore, useCollection, useMemoFirebase, useDoc, setDocumentNonBlocking } from '@/firebase';
import { listPublicManagersAction } from '@/app/actions/public-managers';
import { useGameState } from '@/app/lib/store';
import { collection, query, orderBy, limit, where, doc, onSnapshot, getDocs, writeBatch } from 'firebase/firestore';
import { 
  ChevronLeft, Users, Search, Shield, Calendar,
  Loader2, UserPlus, User, Mail, ChevronRight, Info,
  SlidersHorizontal, ArrowUpDown, Filter, UserMinus, Lock
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from '@/lib/utils';
import { getMoscowTime } from '@/app/lib/time-utils';

type MembershipFilter = 'all' | 'in_assoc' | 'free';
type SortField = 'level' | 'date';
type SortOrder = 'desc' | 'asc';

export default function AllManagersPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const db = useFirestore();
  const { toast } = useToast();
  const { language, isLoaded } = useGameState();
  
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<MembershipFilter>('all');
  const [sortField, setSortField] = useState<SortField>('level');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  
  const [isActionProcessing, setIsActionProcessing] = useState(false);
  const [managers, setManagers] = useState<any[]>([]);
  const [isManagersLoading, setIsManagersLoading] = useState(true);
  const [isLoadingMoreManagers, setIsLoadingMoreManagers] = useState(false);
  const [managerCursor, setManagerCursor] = useState<string | null>(null);
  const [managerDirectoryError, setManagerDirectoryError] = useState<string | null>(null);
  const [selectedManager, setSelectedManager] = useState<{id: string, name: string} | null>(null);

  const userRef = useMemoFirebase(() => {
    if (!db || !user) return null;
    return doc(db, 'players_v14', user.uid);
  }, [db, user]);
  
  const { data: profile } = useDoc(userRef);

  useEffect(() => {
    let cancelled = false;
    async function loadFirstPage() {
      if (!user) return;
      setIsManagersLoading(true);
      setManagerDirectoryError(null);
      try {
        const token = await user.getIdToken();
        const result = await listPublicManagersAction(token);
        if (cancelled) return;
        if (!result.success) throw new Error(result.error);
        setManagers(result.managers);
        setManagerCursor(result.nextCursor);
      } catch (error: any) {
        if (cancelled) return;
        setManagerDirectoryError(error?.message || 'MANAGER_DIRECTORY_UNAVAILABLE');
      } finally {
        if (!cancelled) setIsManagersLoading(false);
      }
    }
    void loadFirstPage();
    return () => { cancelled = true; };
  }, [user]);

  const loadMoreManagers = async () => {
    if (!user || !managerCursor || isLoadingMoreManagers) return;
    setIsLoadingMoreManagers(true);
    setManagerDirectoryError(null);
    try {
      const token = await user.getIdToken();
      const result = await listPublicManagersAction(token, managerCursor);
      if (!result.success) throw new Error(result.error);
      setManagers((current) => {
        const seen = new Set(current.map((manager) => manager.id));
        return [...current, ...result.managers.filter((manager) => !seen.has(manager.id))];
      });
      setManagerCursor(result.nextCursor);
    } catch (error: any) {
      setManagerDirectoryError(error?.message || 'MANAGER_DIRECTORY_UNAVAILABLE');
    } finally {
      setIsLoadingMoreManagers(false);
    }
  };

  const assocsQuery = useMemoFirebase(() => {
    if (!db) return null;
    return query(collection(db, 'associations_v4'));
  }, [db]);
  
  const { data: allAssocs } = useCollection(assocsQuery);

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

  const assocMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (allAssocs) {
      allAssocs.forEach(a => {
        map[a.id] = a.name;
      });
    }
    return map;
  }, [allAssocs]);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/auth/login');
    }
  }, [user, isUserLoading, router]);

  const handleAddFriend = async () => {
    if (!db || !selectedManager || !user || !profile || isActionProcessing) return;
    
    setIsActionProcessing(true);
    try {
      const requestId = `req_${user.uid}_${selectedManager.id}`;
      const requestRef = doc(db, 'friend_requests_v4', requestId);
      const now = new Date().toISOString();

      const requestData = {
        fromId: String(user.uid),
        fromName: String(profile.clubName || profile.displayName || "Manager"),
        toId: String(selectedManager.id),
        toName: String(selectedManager.name),
        status: 'pending',
        createdAt: now,
        updatedAt: now
      };

      await setDocumentNonBlocking(requestRef, requestData);

      toast({ 
        title: language === 'ru' ? "Заявка отправлена!" : "Request Sent!",
        description: language === 'ru' ? `Вы предложили дружбу ${selectedManager.name}` : `Friendship proposed to ${selectedManager.name}`
      });
      setSelectedManager(null);
    } catch (e: any) {
      console.error("Failed to add friend:", e);
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setIsActionProcessing(false);
    }
  };

  const handleRemoveFriend = async () => {
    if (!db || !selectedManager || !user || isActionProcessing) return;
    
    setIsActionProcessing(true);
    try {
      const q1 = query(collection(db, 'friend_requests_v4'), where('fromId', '==', user.uid), where('toId', '==', selectedManager.id));
      const q2 = query(collection(db, 'friend_requests_v4'), where('fromId', '==', selectedManager.id), where('toId', '==', user.uid));
      
      const [s1, s2] = await Promise.all([getDocs(q1), getDocs(q2)]);
      const batch = writeBatch(db);
      s1.docs.forEach(d => batch.delete(d.ref));
      s2.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();

      toast({ 
        title: language === 'ru' ? "Удален из друзей" : "Friend Removed",
        description: language === 'ru' ? `${selectedManager.name} больше не в вашем списке друзей.` : `${selectedManager.name} is no longer in your friends list.`
      });
      setSelectedManager(null);
    } catch (e: any) {
      console.error("Failed to remove friend:", e);
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setIsActionProcessing(false);
    }
  };

  const handlePrivateMessage = () => {
    if (selectedManager) {
      router.push(`/chats/private?uid=${selectedManager.id}&name=${encodeURIComponent(selectedManager.name)}`);
    }
  };

  const translations = {
    en: {
      title: "ALL MANAGERS",
      subtitle: "Global Personnel Database",
      search: "Search manager name...",
      filters: "Filters",
      statusAll: "All Statuses",
      statusIn: "In Alliance",
      statusFree: "Free Agents",
      sortLevel: "By Level",
      sortDate: "By Date",
      orderDesc: "High First",
      orderAsc: "Low First",
      orderNew: "Newest First",
      orderOld: "Oldest First",
      noAssoc: "Not in association",
      noResults: "No managers found matching filters.",
      userMenuDesc: "Direct command options for",
      addFriend: "Add Friend",
      addFriendDesc: "Send friendship request",
      removeFriend: "Remove Friend",
      removeFriendDesc: "Terminate tactical alliance",
      pm: "Private Messages",
      pmDesc: "Direct encrypted transmission",
      close: "CLOSE",
      lvl: "Ур",
      offline: "OFFLINE: Database access restricted."
    },
    ru: {
      title: "ВСЕ МЕНЕДЖЕРЫ",
      subtitle: "Глобальная база данных персонала",
      search: "Поиск по названию...",
      filters: "Фильтры",
      statusAll: "Любой статус",
      statusIn: "В альянсе",
      statusFree: "Свободные",
      sortLevel: "По уровню",
      sortDate: "По дате рег.",
      orderDesc: "Сначала высшие",
      orderAsc: "Сначала низшие",
      orderNew: "Сначала новые",
      orderOld: "Сначала старые",
      noAssoc: "Не сост. в ассоциации",
      noResults: "Менеджеры не найдены.",
      userMenuDesc: "Команды взаимодействия с",
      addFriend: "Добавить в друзья",
      addFriendDesc: "Отправить запрос на дружбу",
      removeFriend: "Удалить из друзей",
      removeFriendDesc: "Разорвать тактический альянс",
      pm: "Личные сообщения",
      pmDesc: "Прямая зашифрованная связь",
      close: "ЗАКРЫТЬ",
      lvl: "Ур",
      offline: "ОФЛАЙН: Доступ к базе ограничен."
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

  const filteredAndSortedManagers = useMemo(() => {
    if (!managers) return [];

    let list = [...managers].filter(m => 
      m.displayName && 
      m.displayName.trim().length >= 2 && 
      m.displayName !== "Unknown Commander"
    );

    if (search) {
      list = list.filter(m => m.displayName?.toLowerCase().includes(search.toLowerCase()));
    }

    if (statusFilter === 'in_assoc') {
      list = list.filter(m => !!m.associationId);
    } else if (statusFilter === 'free') {
      list = list.filter(m => !m.associationId);
    }

    list.sort((a, b) => {
      let valA: any;
      let valB: any;

      if (sortField === 'level') {
        valA = a.managerLevel || 1;
        valB = b.managerLevel || 1;
      } else {
        valA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        valB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      }

      if (sortOrder === 'desc') {
        return valB - valA;
      } else {
        return valA - valB;
      }
    });

    return list;
  }, [managers, search, statusFilter, sortField, sortOrder]);

  const isSelectedFriend = friendsIds.has(selectedManager?.id || '');

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-6">
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

      <div className="space-y-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder={t.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-secondary/50 border-white/10 h-11 text-sm focus-visible:ring-primary"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <label className="text-[8px] font-black uppercase text-muted-foreground ml-1 tracking-widest flex items-center gap-1">
              <Filter className="w-2.5 h-2.5" /> {t.filters}
            </label>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as MembershipFilter)}>
              <SelectTrigger className="h-9 bg-secondary/50 border-white/5 text-[10px] font-bold uppercase">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-white/10">
                <SelectItem value="all" className="text-[10px] uppercase font-bold">{t.statusAll}</SelectItem>
                <SelectItem value="in_assoc" className="text-[10px] uppercase font-bold">{t.statusIn}</SelectItem>
                <SelectItem value="free" className="text-[10px] uppercase font-bold">{t.statusFree}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[8px] font-black uppercase text-muted-foreground ml-1 tracking-widest flex items-center gap-1">
              <ArrowUpDown className="w-2.5 h-2.5" /> {sortField === 'level' ? t.sortLevel : t.sortDate}
            </label>
            <div className="flex gap-1">
              <Select value={sortField} onValueChange={(v) => setSortField(v as SortField)}>
                <SelectTrigger className="h-9 bg-secondary/50 border-white/5 text-[10px] font-bold uppercase flex-1">
                  <SlidersHorizontal className="w-3 h-3 mr-1 opacity-50" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-white/10">
                  <SelectItem value="level" className="text-[10px] uppercase font-bold">{t.lvl}</SelectItem>
                  <SelectItem value="date" className="text-[10px] uppercase font-bold">{language === 'ru' ? 'Дата' : 'Date'}</SelectItem>
                </SelectContent>
              </Select>
              <Button 
                variant="outline" 
                size="icon" 
                className="h-9 w-9 bg-secondary/50 border-white/5"
                onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
              >
                <ArrowUpDown className={cn("w-3.5 h-3.5 transition-transform", sortOrder === 'asc' && "rotate-180")} />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {isManagersLoading ? (
          <div className="py-20 flex flex-col items-center justify-center space-y-4 opacity-50">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-[10px] uppercase font-bold tracking-widest">Accessing database...</p>
          </div>
        ) : filteredAndSortedManagers.length > 0 ? (
          filteredAndSortedManagers.map((manager) => {
            const assocName = manager.associationId ? assocMap[manager.associationId] : null;
            const isEntryPremium = manager.isPremium === true;
            
            return (
              <div 
                key={manager.id} 
                onClick={() => setSelectedManager({ id: manager.id, name: manager.displayName })}
                className="bg-secondary/20 p-3 rounded-xl border border-white/5 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-background flex items-center justify-center border border-white/10">
                    <User className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      {isEntryPremium ? (
                        <div className="relative inline-flex items-center min-w-0 max-w-[150px]">
                          <div className="absolute inset-0 bg-gradient-to-r from-accent/30 via-accent/5 to-transparent border-l-2 border-accent -z-10" />
                          <span className="px-3 py-0.5 text-[10px] font-bold uppercase tracking-tight truncate text-white">
                            {manager.displayName}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs font-bold uppercase">{manager.displayName}</span>
                      )}
                      {manager.id === user.uid && <Badge className="text-[7px] bg-primary text-primary-foreground">YOU</Badge>}
                    </div>
                    <span className={cn(
                      "text-[9px] font-black uppercase tracking-tight",
                      assocName ? "text-primary" : "text-muted-foreground/40"
                    )}>
                      {assocName || t.noAssoc}
                    </span>
                  </div>
                </div>
                <div className="text-right flex flex-col items-end">
                  <span className="text-[10px] font-black text-primary uppercase whitespace-nowrap">
                    {manager.managerLevel || 1} {t.lvl}
                  </span>
                </div>
              </div>
            );
          })
        ) : (
          <div className="py-20 text-center opacity-30 flex flex-col items-center gap-4">
            <Users className="w-12 h-12" />
            <p className="text-xs uppercase font-bold tracking-widest">{t.noResults}</p>
          </div>
        )}
      </div>

      {managerDirectoryError && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {language === 'ru' ? 'Не удалось загрузить каталог менеджеров.' : 'Could not load the manager directory.'}
        </p>
      )}
      {managerCursor && !isManagersLoading && (
        <Button
          variant="outline"
          className="w-full mt-4"
          onClick={loadMoreManagers}
          disabled={isLoadingMoreManagers}
        >
          {isLoadingMoreManagers ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          {language === 'ru' ? 'Загрузить ещё' : 'Load more'}
        </Button>
      )}

      <Dialog open={!!selectedManager} onOpenChange={() => setSelectedManager(null)}>
        <DialogContent className="max-w-md bg-background border-white/10 p-0 overflow-hidden shadow-2xl">
          <DialogHeader className="p-6 bg-gradient-to-br from-primary/10 to-transparent border-b border-white/5">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-secondary/50 flex items-center justify-center border border-white/10">
                <User className="w-6 h-6 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-xl font-headline font-bold uppercase tracking-tight text-primary">
                  {selectedManager?.name}
                </DialogTitle>
                <DialogDescription className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">
                  {t.userMenuDesc} {selectedManager?.name}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="p-4 space-y-2">
            {selectedManager?.id !== user.uid && (
              <Card 
                className="glass-card border-white/5 hover:bg-white/5 cursor-pointer transition-all active:scale-[0.98]"
                onClick={isSelectedFriend ? handleRemoveFriend : handleAddFriend}
              >
                <CardContent className="p-3 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-lg bg-secondary/50">
                      {isActionProcessing ? (
                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                      ) : (
                        isSelectedFriend ? <UserMinus className="w-5 h-5 text-destructive" /> : <UserPlus className="w-5 h-5 text-green-400" />
                      )}
                    </div>
                    <div>
                      <h3 className={cn("text-xs font-bold uppercase", isSelectedFriend ? "text-destructive" : "text-green-400")}>
                        {isSelectedFriend ? t.removeFriend : t.addFriend}
                      </h3>
                      <p className="text-[9px] text-muted-foreground leading-tight">
                        {isSelectedFriend ? t.removeFriendDesc : t.addFriendDesc}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </CardContent>
              </Card>
            )}

            <Card 
              className="glass-card border-white/5 hover:bg-white/5 cursor-pointer transition-all active:scale-[0.98]"
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

            <Card className="glass-card border-white/5 opacity-50 cursor-not-allowed">
              <CardContent className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-2 rounded-lg bg-secondary/50">
                    <Shield className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold uppercase">Club Page</h3>
                    <p className="text-[9px] text-muted-foreground leading-tight">Restricted clearance</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="p-4 bg-secondary/20 border-t border-white/5">
            <Button 
              variant="outline" 
              className="w-full h-10 text-[10px] font-bold uppercase border-white/10"
              onClick={() => setSelectedManager(null)}
            >
              {t.close}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
