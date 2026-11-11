'use client';

import { useState, useMemo } from 'react';
import { useGameState } from '../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  ChevronLeft, ChevronRight, Heart, Users, Ticket, 
  BusFront, Signature, Info, Star, ShieldCheck, 
  TrendingUp, Zap, Sparkles, Loader2, Coins
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { Badge } from '@/components/ui/badge';
import { useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { getMoscowDateString } from '../lib/time-utils';

type FanclubTab = 
  | 'menu'
  | 'groups' 
  | 'free_entry' 
  | 'organized_trip' 
  | 'autograph';

export default function FanclubPage() {
  const { language, isLoaded, selectedLeagueId, leagueLevel, groupId, launchFanCampaign, credits } = useGameState();
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<FanclubTab>('menu');
  const [isProcessing, setIsProcessing] = useState(false);

  const teamRef = useMemoFirebase(() => {
    if (!db || !user || !selectedLeagueId) return null;
    const seasonId = `season_1`; // Simplified for now
    const prefixedGroupId = `${seasonId}_league_${selectedLeagueId}_group_${groupId}`;
    return doc(db, 'leagues_v2', selectedLeagueId, 'divisions', String(leagueLevel), 'groups', prefixedGroupId, 'teams', user.uid);
  }, [db, user, selectedLeagueId, leagueLevel, groupId]);

  const { data: teamData, isLoading: isFanLoading } = useDoc(teamRef);
  const fanData = teamData?.fanclub || { fanCount: 5000, loyalty: 30 };

  if (!isLoaded || isFanLoading) return <LoadingScreen />;

  const translations = {
    en: {
      title: "FANCLUB TERMINAL",
      subtitle: "Supporter Management & Loyalty Protocols",
      back: "Back to Hub",
      insufficient: "Insufficient Credits",
      cooldown: "Campaign Limit Reached",
      success: "Campaign Launched!",
      tabs: {
        groups: { label: "Fan Groups", desc: "Manage organized supporter organizations", icon: Users, color: "text-blue-400" },
        free_entry: { label: "Free Entry", desc: "Promotional ticketing for matchday hype", icon: Ticket, color: "text-green-400" },
        organized_trip: { label: "Organized Trip", desc: "Support for away sector deployments", icon: BusFront, color: "text-orange-400" },
        autograph: { label: "Autograph Session", desc: "Boosting hero media popularity", icon: Signature, color: "text-accent" }
      },
      groupsInfo: {
        title: "SUPPORTER HIERARCHY",
        desc: "Loyal fan groups increase your home stadium advantage and ticket sales efficiency.",
        status: "Active Groups",
        stats: "Community Reach"
      },
      promoInfo: {
        title: "PROMOTIONAL DEPLOYMENT",
        desc: "Offering free entry to local cadet schools increases stadium occupancy but reduces immediate revenue.",
        cost: "Cost: 25,000 €",
        launch: "Launch 'Cadet Day' Promo"
      }
    },
    ru: {
      title: "ТЕРМИНАЛ ФАНКЛУБА",
      subtitle: "Управление болельщиками и лояльностью",
      back: "В меню терминала",
      insufficient: "Недостаточно средств",
      cooldown: "Лимит кампаний исчерпан",
      success: "Кампания запущена!",
      tabs: {
        groups: { label: "Фан-группы", desc: "Управление организациями болельщиков", icon: Users, color: "text-blue-400" },
        free_entry: { label: "Свободный вход", desc: "Промо-акции для заполнения трибун", icon: Ticket, color: "text-green-400" },
        organized_trip: { label: "Организованный выезд", desc: "Поддержка выездного сектора на играх", icon: BusFront, color: "text-orange-400" },
        autograph: { label: "Автограф-сессия", desc: "Повышение медийности и популярности героев", icon: Signature, color: "text-accent" }
      },
      groupsInfo: {
        title: "ИЕРАРХИЯ БОЛЕЛЬЩИКОВ",
        desc: "Организованные фан-группы усиливают преимущество домашней арены и увеличивают продажи мерча.",
        status: "Активные группы",
        stats: "Охват аудитории"
      },
      promoInfo: {
        title: "ПРОМО-КАМПАНИИ",
        desc: "Предоставление свободного входа для местных школ повышает заполняемость стадиона в долгосрочной перспективе.",
        cost: "Стоимость: 25,000 €",
        launch: "Запустить 'День кадета'"
      }
    }
  };

  const t = translations[language as keyof typeof translations] || translations.ru;

  const handleLaunch = (type: string, cost: number, fans: number, loyalty: number) => {
    if (credits < cost) {
      toast({ title: t.insufficient, variant: "destructive" });
      return;
    }
    const today = getMoscowDateString();
    if (fanData.lastCampaignDate === today) {
      toast({ title: t.cooldown, variant: "destructive" });
      return;
    }

    setIsProcessing(true);
    setTimeout(() => {
      launchFanCampaign(type as any, cost, fans, loyalty);
      toast({ title: t.success });
      setIsProcessing(false);
      setActiveTab('menu');
    }, 1500);
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'groups':
        return (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <Card className="glass-card border-blue-500/20 bg-blue-500/5">
              <CardContent className="p-6 text-center space-y-4">
                <div className="w-20 h-20 rounded-full bg-blue-500/20 border-2 border-blue-500 flex items-center justify-center mx-auto shadow-[0_0_20px_rgba(59,130,246,0.3)]">
                  <Users className="w-10 h-10 text-blue-400" />
                </div>
                <h3 className="text-xl font-headline font-bold uppercase text-white">{t.groupsInfo.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed italic px-4">
                  "{t.groupsInfo.desc}"
                </p>
              </CardContent>
            </Card>

            <div className="space-y-3">
               <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">{t.groupsInfo.status}</h4>
               <div className="bg-secondary/20 p-4 rounded-xl border border-white/5 flex items-center justify-between">
                 <div className="flex items-center gap-3">
                   <ShieldCheck className="w-5 h-5 text-primary" />
                   <span className="text-xs font-bold uppercase tracking-tight">Main Ultras Section</span>
                 </div>
                 <Badge className="bg-primary text-primary-foreground text-[8px] font-black uppercase">Ур 1</Badge>
               </div>
               <div className="bg-secondary/20 p-4 rounded-xl border border-dashed border-white/10 flex items-center justify-center opacity-40">
                 <p className="text-[8px] font-black uppercase tracking-[0.2em]">New Slot: 10,000 XP Required</p>
               </div>
            </div>
          </div>
        );

      case 'free_entry':
        return (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <Card className="glass-card border-green-500/20 bg-green-500/5">
              <CardContent className="p-6 text-center space-y-4">
                <div className="w-20 h-20 rounded-full bg-green-500/20 border-2 border-green-500 flex items-center justify-center mx-auto shadow-[0_0_20px_rgba(34,197,94,0.3)]">
                  <Ticket className="w-10 h-10 text-green-400" />
                </div>
                <h3 className="text-xl font-headline font-bold uppercase text-white">{t.promoInfo.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed italic px-4">
                  "{t.promoInfo.desc}"
                </p>
              </CardContent>
            </Card>

            <div className="space-y-3">
              <Button 
                className="w-full h-14 bg-green-600/10 border border-green-500/20 text-green-400 font-black uppercase text-[10px] tracking-widest hover:bg-green-600/20"
                disabled={isProcessing}
                onClick={() => handleLaunch('open_day', 25000, 100, 2)}
              >
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />} 
                {t.promoInfo.launch}
              </Button>
              <p className="text-[8px] text-center text-muted-foreground uppercase font-bold">{t.promoInfo.cost} | Duration: 1 Match</p>
            </div>
          </div>
        );

      case 'autograph':
        return (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <Card className="glass-card border-accent/20 bg-accent/5">
              <CardContent className="p-6 text-center space-y-4">
                <div className="w-20 h-20 rounded-full bg-accent/20 border-2 border-accent flex items-center justify-center mx-auto shadow-[0_0_20px_rgba(var(--accent),0.3)]">
                  <Signature className="w-10 h-10 text-accent" />
                </div>
                <h3 className="text-xl font-headline font-bold uppercase text-white">Media Exposure</h3>
                <p className="text-xs text-muted-foreground leading-relaxed italic px-4">
                  "Invite fans to the base for a direct meet with heroes. Increases loyalty significantly."
                </p>
              </CardContent>
            </Card>
            <Button 
              className="w-full h-14 hero-gradient font-black uppercase text-[10px] tracking-widest"
              disabled={isProcessing}
              onClick={() => handleLaunch('autograph', 50000, 50, 8)}
            >
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Signature className="w-4 h-4 mr-2" />} 
              Launch Autograph Session
            </Button>
            <p className="text-[8px] text-center text-muted-foreground uppercase font-bold">Cost: 50,000 € | Loyalty +8%</p>
          </div>
        );

      default: return null;
    }
  };

  if (activeTab === 'menu') {
    return (
      <div className="max-w-md mx-auto px-4 pt-8 pb-4">
        <header className="mb-8 flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon" className="rounded-full">
              <ChevronLeft className="w-6 h-6" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter flex items-center gap-2">
              <Heart className="w-6 h-6 text-primary" />
              {t.title}
            </h1>
            <p className="text-muted-foreground text-[10px] uppercase tracking-widest">{t.subtitle}</p>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-3 mb-8">
           <Card className="glass-card bg-primary/5 border-primary/20">
             <CardContent className="p-4 text-center">
                <p className="text-[8px] font-black text-muted-foreground uppercase mb-1">Fan Count</p>
                <p className="text-xl font-headline font-black italic text-primary">{(fanData?.fanCount || 5000).toLocaleString()}</p>
             </CardContent>
           </Card>
           <Card className="glass-card bg-accent/5 border-accent/20">
             <CardContent className="p-4 text-center">
                <p className="text-[8px] font-black text-muted-foreground uppercase mb-1">Loyalty</p>
                <p className="text-xl font-headline font-black italic text-accent">{fanData?.loyalty || 30}%</p>
             </CardContent>
           </Card>
        </div>

        <div className="space-y-2">
          {(Object.entries(t.tabs) as [FanclubTab, any][]).map(([id, data]) => (
            <Card 
              key={id}
              className="glass-card border-white/5 hover:bg-white/5 transition-all cursor-pointer overflow-hidden group"
              onClick={() => setActiveTab(id)}
            >
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={cn("p-2.5 rounded-xl bg-secondary/50", data.color)}>
                    <data.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold uppercase group-hover:text-white transition-colors">{data.label}</h3>
                    <p className="text-[10px] text-muted-foreground leading-tight">{data.desc}</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-4">
      <header className="mb-8 flex items-center gap-4">
        <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setActiveTab('menu')}>
          <ChevronLeft className="w-6 h-6" />
        </Button>
        <div>
          <h1 className="text-xl font-headline font-bold uppercase tracking-tight">
            {t.tabs[activeTab as keyof typeof t.tabs].label}
          </h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest">{t.back}</p>
        </div>
      </header>
      {renderContent()}
    </div>
  );
}
