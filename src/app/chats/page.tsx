
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/firebase';
import { useGameState } from '../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  MessageSquare, Mail, HelpCircle, Megaphone,
  ChevronLeft, ChevronRight 
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { LoadingScreen } from '@/components/game/LoadingScreen';

export default function ChatsPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const { language, isLoaded } = useGameState();

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
      title: "COMMUNICATIONS",
      subtitle: "Tactical Messaging Network",
      locked: "Locked",
      menu: [
        { label: 'Global Chat', desc: 'Real-time communication with all managers', icon: MessageSquare, active: true, href: '/chats/global' },
        { label: 'Private Messages', desc: 'Direct encrypted transmissions', icon: Mail, active: true, href: '/chats/private' },
        { label: 'Help for Newbies', desc: 'Training support and field guides', icon: HelpCircle, active: false },
        { label: 'Announcements', desc: 'Official league broadcasts and updates', icon: Megaphone, active: false },
      ]
    },
    ru: {
      title: "ТЕРМИНАЛ СВЯЗИ",
      subtitle: "Сеть тактических сообщений",
      locked: "Закрыто",
      menu: [
        { label: 'Общий чат', desc: 'Общение со всеми менеджерами лиги', icon: MessageSquare, active: true, href: '/chats/global' },
        { label: 'Личные сообщения', desc: 'Прямая зашифрованная связь', icon: Mail, active: true, href: '/chats/private' },
        { label: 'Помощь новичкам', desc: 'Поддержка и руководства для кадетов', icon: HelpCircle, active: false },
        { label: 'Объявления', desc: 'Официальные сводки и новости лиги', icon: Megaphone, active: false },
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

      <div className="space-y-2">
        {t.menu.map((item) => {
          const content = (
            <Card 
              className={cn(
                "glass-card border-white/5 transition-all",
                item.active ? "hover:bg-white/5 cursor-pointer" : "opacity-60"
              )}
            >
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-2 rounded-lg bg-secondary/50">
                    <item.icon className={cn("w-5 h-5", item.active ? "text-primary" : "text-muted-foreground")} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold uppercase">{item.label}</h3>
                    <p className="text-[10px] text-muted-foreground">{item.desc}</p>
                  </div>
                </div>
                {item.active ? (
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <Badge variant="outline" className="text-[8px] uppercase">{t.locked}</Badge>
                )}
              </CardContent>
            </Card>
          );

          if (item.active && item.href) {
            return (
              <Link key={item.label} href={item.href} className="block">
                {content}
              </Link>
            );
          }

          return (
            <div key={item.label} className={cn("block", !item.active && "cursor-not-allowed")}>
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
