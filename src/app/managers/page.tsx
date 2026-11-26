'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { useGameState } from '../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  Users, UserCheck, Newspaper, Ban, VolumeX, UserPlus,
  ChevronLeft, ChevronRight, Globe, Lock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { collection, query, where } from 'firebase/firestore';

export default function ManagersHubPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const db = useFirestore();
  const { language, isLoaded } = useGameState();

  const requestsQuery = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return query(
      collection(db, 'friend_requests_v4'),
      where('toId', '==', user.uid),
      where('status', '==', 'pending')
    );
  }, [db, user?.uid]);

  const { data: requests } = useCollection(requestsQuery);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/auth/login');
    }
  }, [user, isUserLoading, router]);

  if (isUserLoading || !isLoaded || !user) {
    return <LoadingScreen />;
  }

  const translations = {
    en: {
      title: "MANAGERS HUB",
      subtitle: "Operational Personnel Network",
      locked: "Locked",
      offline: "OFFLINE: Social terminal restricted.",
      menu: [
        { id: 'all', label: 'All Managers', desc: 'Find and view other club commanders', icon: Globe, active: true, href: '/managers/all' },
        { id: 'friends', label: 'Friends', desc: 'Your trusted network of managers', icon: UserCheck, active: true, href: '/managers/friends' },
        { id: 'news', label: 'Friend News', desc: 'Recent activity from your contacts', icon: Newspaper, active: false },
        { id: 'black', label: 'Blacklist', desc: 'Banned and restricted managers', icon: Ban, active: false },
        { id: 'ignore', label: 'Ignore List', desc: 'Muted transmissions from managers', icon: VolumeX, active: false },
        { id: 'req', label: 'Friend Requests', desc: 'Incoming friendship proposals', icon: UserPlus, active: true, href: '/managers/requests', badge: requests?.length ? requests.length.toString() : null },
      ]
    },
    ru: {
      title: "ХАБ МЕНЕДЖЕРОВ",
      subtitle: "Сеть оперативного персонала",
      locked: "Закрыто",
      offline: "ОФЛАЙН: Социальный терминал недоступен.",
      menu: [
        { id: 'all', label: 'Все менеджеры', desc: 'Поиск и просмотр других командиров', icon: Globe, active: true, href: '/managers/all' },
        { id: 'friends', label: 'Друзья', desc: 'Ваша сеть доверенных менеджеров', icon: UserCheck, active: true, href: '/managers/friends' },
        { id: 'news', label: 'Новости друзей', desc: 'Активность ваших контактов', icon: Newspaper, active: false },
        { id: 'black', label: 'Черный список', desc: 'Заблокированные менеджеры', icon: Ban, active: false },
        { id: 'ignore', label: 'Игнор-лист', desc: 'Скрытые передачи от менеджеров', icon: VolumeX, active: false },
        { id: 'req', label: 'Хотят дружить', desc: 'Входящие запросы на дружбу', icon: UserPlus, active: true, href: '/managers/requests', badge: requests?.length ? requests.length.toString() : null },
      ]
    }
  };

  const t = translations[language as keyof typeof translations] || translations.ru;

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-20">
      <header className="mb-6 flex items-center gap-4">
        <Link href="/">
          <Button variant="ghost" size="icon" className="rounded-full">
            <ChevronLeft className="w-6 h-6" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter">{t.title}</h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest">{t.subtitle}</p>
        </div>
      </header>

      {!db && (
         <div className="py-20 opacity-30 flex flex-col items-center gap-6 text-center">
            <Lock className="w-16 h-16" />
            <p className="text-[10px] font-black uppercase tracking-widest px-10 leading-relaxed">{t.offline}</p>
         </div>
      )}

      {db && (
        <div className="space-y-2">
          {t.menu.map((item) => {
            const content = (
              <Card 
                key={item.id}
                className={cn(
                  "glass-card border-white/5 transition-all group overflow-hidden",
                  item.active ? "hover:bg-white/5 cursor-pointer" : "opacity-60"
                )}
              >
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={cn("p-2.5 rounded-xl bg-secondary/50 border border-white/5 group-hover:bg-primary/10 transition-colors shadow-inner")}>
                      <item.icon className={cn("w-5 h-5", item.active ? "text-primary" : "text-muted-foreground")} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold uppercase group-hover:text-white transition-colors">{item.label}</h3>
                        {item.badge && (
                          <Badge className="bg-primary text-primary-foreground text-[8px] h-4 px-1.5 font-black animate-pulse">
                            {item.badge}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground font-medium">{item.desc}</p>
                    </div>
                  </div>
                  {item.active ? (
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-all" />
                  ) : (
                    <Badge variant="outline" className="text-[8px] uppercase border-white/10 opacity-50">
                      {t.locked}
                    </Badge>
                  )}
                </CardContent>
              </Card>
            );

            if (item.active && item.href) {
              return (
                <Link key={item.id} href={item.href} className="block">
                  {content}
                </Link>
              );
            }

            return (
              <div key={item.id} className={cn("block", !item.active && "cursor-not-allowed")}>
                {content}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}