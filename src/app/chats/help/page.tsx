'use client';

import Link from 'next/link';
import { BookOpen, ChevronLeft, Users, Swords, Wallet, Trophy, GraduationCap, ArrowRightLeft, Building2, MessageSquare } from 'lucide-react';
import { useGameState } from '../../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const guides = [
  { icon: Users, title: 'Состав и тактика', body: 'Соберите стартовую пятёрку, распределите роли, настройте запасных и выберите стратегию на матч.', href: '/roster' },
  { icon: Swords, title: 'Матчи и отчёты', body: 'Следите за календарём, открывайте предматчевую информацию и изучайте итоговые отчёты после игр.', href: '/matches' },
  { icon: ArrowRightLeft, title: 'Трансферный рынок', body: 'Ищите игроков, делайте ставки и выставляйте собственных игроков на продажу.', href: '/transfers' },
  { icon: GraduationCap, title: 'Молодёжная академия', body: 'Сканируйте таланты, набирайте юниоров, проводите ежедневные тренировки и выпускайте игроков в основу с 18 лет.', href: '/youth-academy' },
  { icon: Building2, title: 'Инфраструктура', body: 'Развивайте арену, штаб, тренировочную базу, академию и медицинский центр.', href: '/training' },
  { icon: Trophy, title: 'Лиги и турниры', body: 'Проверяйте положение в таблице, участвуйте в Кубке пирамиды и открытых соревнованиях.', href: '/tournaments' },
  { icon: Wallet, title: 'Финансы и магазин', body: 'Контролируйте бюджет клуба, расходы на персонал и доступные игровые покупки.', href: '/finances' },
  { icon: MessageSquare, title: 'Связь с менеджерами', body: 'Используйте общий чат для общения с сообществом и личные сообщения для прямого контакта.', href: '/chats' },
];

export default function NewManagerHelpPage() {
  const { language } = useGameState();
  const ru = language !== 'en';

  return (
    <main className="max-w-2xl mx-auto px-4 py-6 pb-24 space-y-5">
      <header className="flex items-center gap-3">
        <Link href="/chats"><Button variant="ghost" size="icon"><ChevronLeft /></Button></Link>
        <div><h1 className="text-2xl font-black tracking-tight flex items-center gap-2"><BookOpen className="text-primary" />{ru ? 'ПОМОЩЬ НОВИЧКАМ' : 'MANAGER GUIDE'}</h1><p className="text-xs text-muted-foreground">{ru ? 'Краткий справочник по управлению клубом' : 'A quick guide to managing your club'}</p></div>
      </header>
      <Card className="border-primary/20 bg-primary/5"><CardContent className="p-4"><p className="text-sm font-bold">{ru ? 'Добро пожаловать в Forge-Rivals!' : 'Welcome to Forge-Rivals!'}</p><p className="text-xs text-muted-foreground mt-1">{ru ? 'Начните с состава и ближайшего матча. Затем развивайте инфраструктуру, усиливайте команду на рынке и постепенно растите в турнирной пирамиде.' : 'Start with your squad and next match. Then develop facilities, strengthen the team on the market and climb the tournament pyramid.'}</p></CardContent></Card>
      <section className="grid gap-3 sm:grid-cols-2">
        {guides.map((guide, index) => {
          const Icon = guide.icon;
          return <Link href={guide.href} key={guide.href}><Card className="h-full hover:border-primary/40 transition-colors"><CardContent className="p-4 flex gap-3"><div className="rounded-xl bg-secondary/60 p-2 h-fit"><Icon className="w-5 h-5 text-primary" /></div><div><p className="text-xs font-black uppercase">{ru ? guide.title : ['Squad and tactics','Matches and reports','Transfer market','Youth academy','Club facilities','Leagues and tournaments','Finances and shop','Manager communications'][index]}</p><p className="text-[11px] leading-relaxed text-muted-foreground mt-1">{ru ? guide.body : ['Build your starting five, assign roles, set substitutes and choose your match strategy.','Follow fixtures, check match previews and review reports after games.','Scout the market, place bids and list your own players for sale.','Scout prospects, recruit youth, train daily and promote players at age 18.','Develop your arena, headquarters, training ground, academy and medical centre.','Check standings, enter the Pyramid Cup and join open competitions.','Track club budget, staff costs and available in-game purchases.','Use global chat for the community and private messages for direct contact.'][index]}</p></div></CardContent></Card></Link>;
        })}
      </section>
    </main>
  );
}
