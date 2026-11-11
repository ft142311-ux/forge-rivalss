'use client';

import { useState, useMemo } from 'react';
import { useGameState } from '../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  ChevronLeft, ChevronRight, Coins, AlertTriangle, 
  TrendingUp, FileText, BarChart3, Wallet, 
  Landmark, PiggyBank, History,
  CheckCircle2, XCircle, ArrowUpRight,
  ShoppingCart, Info, Crown
} from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import Link from 'next/link';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { getMoscowTime } from '@/app/lib/time-utils';
import { Badge } from '@/components/ui/badge';
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

type FinanceTab = 
  | 'menu'
  | 'bankruptcy' 
  | 'income' 
  | 'reports' 
  | 'charts' 
  | 'budget' 
  | 'salaries' 
  | 'match_reports';

export default function FinancesPage() {
  const { language, isLoaded, credits, ownedPlayers, staff, arena, managerSkills, isPremium } = useGameState();
  const [activeTab, setActiveTab] = useState<FinanceTab>('menu');

  if (!isLoaded) return <LoadingScreen />;

  const translations = {
    en: {
      title: "FINANCIAL TERMINAL",
      subtitle: "Economic Management & Asset Control",
      back: "Back to Terminal",
      tabs: {
        bankruptcy: { label: "Bankruptcy Conditions", desc: "Critical liquidation risk analysis", icon: AlertTriangle, color: "text-red-400" },
        income: { label: "Income Breakdown", desc: "Operational revenue streams", icon: TrendingUp, color: "text-green-400" },
        reports: { label: "Financial Reports", desc: "Detailed transaction history", icon: FileText, color: "text-blue-400" },
        charts: { label: "Analytics Charts", desc: "Visual growth and cashflow data", icon: BarChart3, color: "text-accent" },
        budget: { label: "Transfer Budget", desc: "Available liquidity for roster growth", icon: Wallet, color: "text-yellow-400" },
        salaries: { label: "Daily Salaries", desc: "Player and staff payroll charged at 00:00 MSK", icon: PiggyBank, color: "text-primary" },
        match_reports: { label: "Last Match Outcomes", desc: "Revenue from recent deployments", icon: History, color: "text-slate-400" }
      },
      bankruptcyInfo: {
        title: "LIQUIDATION PROTOCOL",
        desc: "Managers with a deficit exceeding 1,000,000 € for more than 3 consecutive matches are subject to immediate club liquidation.",
        status: "Current Status",
        safe: "OPERATIONAL STABILITY",
        warning: "LIQUIDATION WARNING",
        critical: "BANKRUPTCY IMMINENT"
      },
      incomeInfo: {
        daily: "Daily Estimated Revenue",
        tickets: "Ticket Sales (AVG)",
        sponsors: "League Sponsorship",
        merch: "Merchandise & Sales",
        total: "Total Projected Daily",
        skillBonus: "Sponsor Skill Bonus",
        premiumBonus: "PREMIUM 200% SPONSOR BONUS"
      }
    },
    ru: {
      title: "ФИНАНСОВЫЙ ТЕРМИНАЛ",
      subtitle: "Экономическое управление и активы",
      back: "В меню терминала",
      tabs: {
        bankruptcy: { label: "Условия банкротства", desc: "Анализ рисков ликвидации клуба", icon: AlertTriangle, color: "text-red-400" },
        income: { label: "Доходы", desc: "Операционные источники выручки", icon: TrendingUp, color: "text-green-400" },
        reports: { label: "Отчёты", desc: "Детальная история транзакций", icon: FileText, color: "text-blue-400" },
        charts: { label: "Графики", desc: "Визуализация роста и денежных потоков", icon: BarChart3, color: "text-accent" },
        budget: { label: "Трансферный бюджет", desc: "Ликвидность для усиления ростера", icon: Wallet, color: "text-yellow-400" },
        salaries: { label: "Ежедневные зарплаты", desc: "Зарплата игроков и персонала списывается в 00:00 МСК", icon: PiggyBank, color: "text-primary" },
        match_reports: { label: "Отчёты о последних матчах", desc: "Выручка от недавних операций", icon: History, color: "text-slate-400" }
      },
      bankruptcyInfo: {
        title: "ПРОТОКОЛ ЛИКВИДАЦИИ",
        desc: "Менеджеры с дефицитом более 1,000,000 € в течение 3 матчей подряд подлежат немедленной ликвидации клуба.",
        status: "Текущий статус",
        safe: "ОПЕРАЦИОННАЯ СТАБИЛЬНОСТЬ",
        warning: "ПРЕДУПРЕЖДЕНИЕ О ЛИКВИДАЦИИ",
        critical: "УГРОЗА БАНКРОТСТВА"
      },
      incomeInfo: {
        daily: "Оценочный ежедневный доход",
        tickets: "Продажа билетов (сред.)",
        sponsors: "Спонсорство Лиги",
        merch: "Мерч и атрибутика",
        total: "Итоговая проекция",
        skillBonus: "Бонус Спонсоров",
        premiumBonus: "PREMIUM 200% БОНУС СПОНСОРОВ"
      }
    }
  };

  const t = translations[language as keyof typeof translations] || translations.ru;

  const chartData = [
    { day: "1", credits: credits * 0.7 },
    { day: "2", credits: credits * 0.8 },
    { day: "3", credits: credits * 0.75 },
    { day: "4", credits: credits * 0.9 },
    { day: "5", credits: credits * 0.85 },
    { day: "6", credits: credits * 0.95 },
    { day: "7", credits: credits },
  ];

  const chartConfig = {
    credits: {
      label: "Credits",
      color: "hsl(var(--primary))",
    },
  } satisfies ChartConfig;

  const renderContent = () => {
    switch (activeTab) {
      case 'bankruptcy':
        return (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500 pb-6">
            <Card className="glass-card border-red-500/20 bg-red-500/5">
              <CardContent className="p-6 text-center space-y-4">
                <div className="w-20 h-20 rounded-full bg-red-500/20 border-2 border-red-500 flex items-center justify-center mx-auto shadow-[0_0_20px_rgba(239,68,68,0.3)]">
                  <AlertTriangle className="w-10 h-10 text-red-400 animate-pulse" />
                </div>
                <h3 className="text-xl font-headline font-bold uppercase text-white">{t.bankruptcyInfo.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed italic px-4">
                  "{t.bankruptcyInfo.desc}"
                </p>
              </CardContent>
            </Card>

            <div className="space-y-3">
               <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">{t.bankruptcyInfo.status}</h4>
               <div className={cn(
                 "p-4 rounded-xl border flex items-center justify-between",
                 credits > 0 ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-red-500/10 border-red-500/20 text-red-400"
               )}>
                 <div className="flex items-center gap-3">
                   {credits > 0 ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-4 h-4" />}
                   <span className="text-xs font-bold uppercase tracking-tight">
                     {credits > 0 ? t.bankruptcyInfo.safe : (credits < -500000 ? t.bankruptcyInfo.critical : t.bankruptcyInfo.warning)}
                   </span>
                 </div>
                 <span className="text-lg font-headline font-black italic">{credits.toLocaleString()} €</span>
               </div>
            </div>
          </div>
        );

      case 'income':
        const sponsorBonusMultiplier = 1 + (managerSkills.sponsors * 0.1);
        const ticketBase = (arena?.capacity || 5000) * 15;
        const merchBase = (arena?.shopLevel || 0) * 12000 + 5000;
        const sponsorBase = 250000;

        const premiumSponsorMultiplier = isPremium ? 3.0 : 1.0;

        const ticketIncome = Math.round(ticketBase * sponsorBonusMultiplier);
        const merchIncome = Math.round(merchBase * sponsorBonusMultiplier);
        const sponsorIncome = Math.round(sponsorBase * sponsorBonusMultiplier * premiumSponsorMultiplier);

        return (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500 pb-6">
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-accent px-1">{t.incomeInfo.daily}</h3>
            <div className="space-y-2">
              <div className="bg-secondary/20 p-4 rounded-xl border border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-500/10"><Landmark className="w-4 h-4 text-blue-400" /></div>
                  <span className="text-xs font-bold uppercase text-muted-foreground">{t.incomeInfo.tickets}</span>
                </div>
                <span className="text-sm font-bold text-white">+{ticketIncome.toLocaleString()} €</span>
              </div>
              <div className={cn("p-4 rounded-xl border flex items-center justify-between", isPremium ? "bg-yellow-500/10 border-yellow-500/20" : "bg-secondary/20 border-white/5")}>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-yellow-500/10"><Coins className="w-4 h-4 text-yellow-500" /></div>
                  <div>
                    <span className="text-xs font-bold uppercase text-muted-foreground">{t.incomeInfo.sponsors}</span>
                    {isPremium && <p className="text-[7px] text-yellow-500 font-black uppercase mt-0.5 tracking-tighter">Premium 3x Active</p>}
                  </div>
                </div>
                <span className={cn("text-sm font-bold", isPremium ? "text-yellow-500" : "text-white")}>+{sponsorIncome.toLocaleString()} €</span>
              </div>
              <div className="bg-secondary/20 p-4 rounded-xl border border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-500/10"><ShoppingCart className="w-4 h-4 text-purple-400" /></div>
                  <span className="text-xs font-bold uppercase text-muted-foreground">{t.incomeInfo.merch}</span>
                </div>
                <span className="text-sm font-bold text-white">+{merchIncome.toLocaleString()} €</span>
              </div>

              {isPremium && (
                <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl flex items-center justify-between shadow-[0_0_15px_rgba(234,179,8,0.1)]">
                   <div className="flex items-center gap-2">
                     <Crown className="w-3.5 h-3.5 text-yellow-500" />
                     <span className="text-[9px] font-black uppercase text-yellow-500">{t.incomeInfo.premiumBonus}</span>
                   </div>
                   <Badge className="bg-yellow-500 text-black text-[8px] font-black">+200%</Badge>
                </div>
              )}

              {managerSkills.sponsors > 0 && (
                <div className="p-3 bg-accent/10 border border-accent/20 rounded-xl flex items-center justify-between">
                  <span className="text-[9px] font-black uppercase text-accent">{t.incomeInfo.skillBonus}</span>
                  <Badge className="bg-accent text-accent-foreground text-[8px] font-black">+{managerSkills.sponsors * 10}%</Badge>
                </div>
              )}

              <div className="bg-primary/10 p-5 rounded-xl border border-primary/20 flex items-center justify-between mt-4">
                <span className="text-sm font-black uppercase tracking-widest text-primary">{t.incomeInfo.total}</span>
                <span className="text-xl font-headline font-black italic text-primary">
                  +{(ticketIncome + sponsorIncome + merchIncome).toLocaleString()} €
                </span>
              </div>
            </div>
          </div>
        );

      case 'charts':
        return (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500 pb-6">
            <Card className="glass-card border-white/5">
              <CardContent className="p-4">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-accent mb-6">Cashflow Dynamics (Weekly)</h3>
                <div className="h-64 w-full">
                   <ChartContainer config={chartConfig}>
                    <AreaChart
                      data={chartData}
                      margin={{ left: -20, right: 12, top: 10, bottom: 0 }}
                    >
                      <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis 
                        dataKey="day" 
                        tickLine={false} 
                        axisLine={false} 
                        tickMargin={8}
                        tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }}
                      />
                      <YAxis 
                        tickLine={false} 
                        axisLine={false}
                        tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }}
                        tickFormatter={(val) => `${(val / 1000000).toFixed(1)}M`}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area
                        type="monotone"
                        dataKey="credits"
                        stroke="var(--color-credits)"
                        fill="var(--color-credits)"
                        fillOpacity={0.1}
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ChartContainer>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 gap-3">
               <div className="bg-green-500/10 p-4 rounded-xl border border-green-500/20 text-center">
                  <ArrowUpRight className="w-5 h-5 text-green-400 mx-auto mb-1" />
                  <p className="text-[8px] uppercase text-muted-foreground font-black">Net Growth</p>
                  <p className="text-sm font-bold text-green-400">+12.5%</p>
               </div>
               <div className="bg-blue-500/10 p-4 rounded-xl border border-blue-500/20 text-center">
                  <TrendingUp className="w-5 h-5 text-blue-400 mx-auto mb-1" />
                  <p className="text-[8px] uppercase text-muted-foreground font-black">Efficiency</p>
                  <p className="text-sm font-bold text-blue-400">Optimal</p>
               </div>
            </div>
          </div>
        );

      case 'salaries': {
        const playerSalary = ownedPlayers.reduce((sum, p) => sum + Number(p.salary || 0), 0);
        const staffSalary = Object.values(staff || {}).reduce((sum: number, member: any) => sum + Number(member?.salary || 0), 0);
        const totalSalary = playerSalary + staffSalary;
        const now = getMoscowTime();
        const nextMidnight = new Date(now.getTime());
        nextMidnight.setUTCHours(21, 0, 0, 0);
        if (nextMidnight.getTime() <= now.getTime()) nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
        const hours = Math.floor((nextMidnight.getTime() - now.getTime()) / 3600000);
        const minutes = Math.floor(((nextMidnight.getTime() - now.getTime()) % 3600000) / 60000);
        return (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500 pb-6">
            <div className="p-6 bg-primary/5 rounded-2xl border border-primary/20 text-center">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-2">{language === 'ru' ? 'Ежедневный фонд зарплат' : 'Daily salary bill'}</p>
              <p className="text-3xl font-headline font-bold text-white">{totalSalary.toLocaleString()} €</p>
              <Badge className="mt-4 bg-primary text-primary-foreground text-[8px] font-black uppercase">00:00 MSK</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Card className="glass-card"><CardContent className="p-4"><p className="text-[9px] text-muted-foreground uppercase">{language === 'ru' ? 'Игроки' : 'Players'}</p><p className="text-lg font-black">{playerSalary.toLocaleString()} €</p></CardContent></Card>
              <Card className="glass-card"><CardContent className="p-4"><p className="text-[9px] text-muted-foreground uppercase">{language === 'ru' ? 'Персонал' : 'Staff'}</p><p className="text-lg font-black">{staffSalary.toLocaleString()} €</p></CardContent></Card>
            </div>
            <Card className="glass-card border-white/5"><CardContent className="p-4 flex items-center justify-between"><span className="text-xs text-muted-foreground">{language === 'ru' ? 'До следующего списания' : 'Until next payroll'}</span><span className="font-black">{hours}ч {minutes}м</span></CardContent></Card>
          </div>
        );
      }

      case 'match_reports':
      case 'budget':
        return (
          <div className="py-20 text-center opacity-30 animate-in fade-in duration-500 pb-6">
            <div className="w-16 h-16 rounded-full border-2 border-dashed border-muted-foreground mx-auto mb-4 flex items-center justify-center">
              <FileText className="w-8 h-8" />
            </div>
            <p className="text-xs font-black uppercase tracking-widest leading-relaxed">
              Section data is being synthesized.<br/>Check back after the next match.
            </p>
          </div>
        );

      default: return null;
    }
  };

  if (activeTab === 'menu') {
    return (
      <div className="max-w-md mx-auto px-4 pt-8 pb-4">
        <header className="mb-8 flex items-center gap-4">
          <Link href="/"><Button variant="ghost" size="icon" className="rounded-full"><ChevronLeft className="w-6 h-6" /></Button></Link>
          <div>
            <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter flex items-center gap-2">
              <Coins className="w-6 h-6 text-primary" />
              {t.title}
            </h1>
            <p className="text-muted-foreground text-[10px] uppercase tracking-widest">{t.subtitle}</p>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-3 mb-8">
           <Card className="glass-card bg-primary/5 border-primary/20">
             <CardContent className="p-4 text-center">
                <p className="text-[8px] font-black text-muted-foreground uppercase mb-1">Available Credits</p>
                <p className="text-xl font-headline font-black italic text-primary">{credits.toLocaleString()} €</p>
             </CardContent>
           </Card>
           <Card className="glass-card bg-accent/5 border-accent/20">
             <CardContent className="p-4 text-center">
                <p className="text-[8px] font-black text-muted-foreground uppercase mb-1">Weekly Profit</p>
                <p className="text-xl font-headline font-black italic text-accent">+1.2M €</p>
             </CardContent>
           </Card>
        </div>

        <div className="space-y-2">
          {(Object.entries(t.tabs) as [FinanceTab, any][]).map(([id, data]) => (
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
