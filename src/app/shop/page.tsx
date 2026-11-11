
'use client';

import { useState, useMemo } from 'react';
import { useGameState } from '../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { 
  ChevronLeft, ChevronRight, Gem, UserPlus, 
  Edit3, Flag, Coins, Star,
  Loader2, Info, Sparkles, ShoppingCart,
  ArrowRightLeft, Target, Calendar, User, ScrollText, ShieldCheck, Lock,
  Crown, Award, Zap, Users, TrendingUp, CheckCircle2, ShieldAlert,
  Swords, Trophy
} from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import Link from 'next/link';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { useToast } from '@/hooks/use-toast';
import { COUNTRIES } from '../lib/countries-data';
import { Player, Role } from '../lib/moba-data';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from '@/components/ui/badge';
import { useUser } from '@/firebase';
import {
  purchaseLicenseAction,
  purchasePremiumShopAction,
  purchaseDiamondPackAction,
  exchangeCrystalsForCreditsAction,
  changeClubNameAction,
  changeClubCountryAction,
  createShopPlayerAction,
} from '@/app/actions/shop';

type ShopTab = 
  | 'menu'
  | 'diamonds' 
  | 'premium'
  | 'create_player' 
  | 'exchange' 
  | 'change_name' 
  | 'change_country'
  | 'licenses';

export default function ShopPage() {
  const { 
    language, isLoaded, credits, crystals, numericId,
    activeLicenseTier, country: currentCountry, isPremium, premiumUntil
  } = useGameState();
  const [activeTab, setActiveTab] = useState<ShopTab>('menu');
  const [newName, setNewName] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const { user } = useUser();

  const [heroNickname, setHeroNickname] = useState('');
  const [heroRole, setHeroRole] = useState<Role>('Carry');
  const [heroTalent, setHeroTalent] = useState('4.0');
  const [heroAge, setHeroAge] = useState('18');
  const [heroCountryCode, setHeroCountryCode] = useState('US');

  const creationCost = useMemo(() => {
    let cost = 200; 
    const t = parseFloat(heroTalent);
    if (t === 3.5) cost += 150;
    if (t === 4.0) cost += 300;
    if (t === 4.5) cost += 600;
    if (t === 5.0) cost += 1200;
    const a = parseInt(heroAge);
    if (a < 18) cost += 200;
    else if (a < 22) cost += 100;
    return cost;
  }, [heroTalent, heroAge]);

  if (!isLoaded) return <LoadingScreen />;

  const translations = {
    en: {
      title: "GLOBAL TRADING HUB",
      subtitle: "Secure Resource Acquisition Node",
      back: "Back to Menu",
      insufficient: "Insufficient resources",
      tabs: {
        diamonds: { label: "Buy Diamonds", desc: "Purchase premium operational currency", icon: Gem, color: "text-blue-400" },
        premium: { label: "Elite Status", desc: "Monthly elite club privileges", icon: Crown, color: "text-yellow-500" },
        licenses: { label: "Licenses", desc: "Command tier progressions and rights", icon: ScrollText, color: "text-red-400" },
        create_player: { label: "Create Player", desc: "Generate a custom high-tier elite hero", icon: UserPlus, color: "text-primary" },
        exchange: { label: "Exchange 💎 to €", desc: "Convert crystals to operational funds", icon: ArrowRightLeft, color: "text-yellow-400" },
        change_name: { label: "Change Name", desc: "Update your club's global callsign", icon: Edit3, color: "text-accent" },
        change_country: { label: "Change Country", desc: "Relocate your club's operational sector", icon: Flag, color: "text-orange-400" }
      },
      premiumInfo: {
        title: "ELITE OPERATIONS ACCESS",
        cost: "5,000 Diamonds",
        duration: "30 Days",
        benefits: [
          { icon: Crown, label: "Exclusive callsign badge", desc: "Recognition in global comms" },
          { icon: Gem, label: "Daily 50 💎 payout", desc: "Resource stability boost" },
          { icon: Zap, label: "5x XP gain multiplier", desc: "Rapid level progression" },
          { icon: ArrowRightLeft, label: "Unlimited bidding logic", desc: "Tactical market freedom" },
          { icon: Users, label: "15-hero squad limit", desc: "Extended personnel roster" },
          { icon: TrendingUp, label: "200% Sponsor Bonus", desc: "Tripled operational funding" }
        ],
        active: "ELITE STATUS ACTIVE",
        expires: "Expires on",
        buy: "ACTIVATE ELITE PROTOCOL"
      },
      licenseInfo: {
        current: "Current Clearance",
        upgrade: "Request Promotion",
        order: "Licenses must be acquired sequentially.",
        tiers: [
          { 
            tier: 4, label: "Standard License", cost: 0, 
            benefits: [
              { icon: ShieldAlert, label: "Restriction", desc: "Max 1 tournament / day" },
              { icon: Swords, label: "Restriction", desc: "Max 5 friendlies / day" },
              { icon: Target, label: "Restriction", desc: "Max Building Level: 10" },
              { icon: TrendingUp, label: "Restriction", desc: "Max bid: +10% market value" },
              { icon: Users, label: "Restriction", desc: "Squad limit: 7 heroes" },
              { icon: Coins, label: "Restriction", desc: "Sponsor payout: 50% only" }
            ] 
          },
          { 
            tier: 3, label: "B-Tier License", cost: 500, 
            benefits: [
              { icon: ShieldCheck, label: "Permission", desc: "Unlimited building & matches" },
              { icon: Users, label: "Alliance", desc: "Ability to join associations" },
              { icon: Zap, label: "2x XP Multiplier", desc: "Increased experience gain" },
              { icon: TrendingUp, label: "Market", desc: "Max bid: +30% market value" },
              { icon: Users, label: "Squad", desc: "Squad limit: 8 heroes" },
              { icon: Coins, label: "Finance", desc: "Full 100% sponsor payouts" }
            ] 
          },
          { 
            tier: 2, label: "A-Tier License", cost: 1500, 
            benefits: [
              { icon: Zap, label: "3x XP Multiplier", desc: "Rapid experience gain" },
              { icon: TrendingUp, label: "Market", desc: "Max bid: +100% market value" },
              { icon: Users, label: "Squad", desc: "Squad limit: 10 heroes" },
              { icon: Coins, label: "Bonus", desc: "+50% Sponsor Bonus (Total 150%)" }
            ] 
          },
          { 
            tier: 1, label: "S-Tier License", cost: 3000, 
            benefits: [
              { icon: Star, label: "Social", desc: "Send daily gifts to friends" },
              { icon: Award, label: "Alliance", desc: "Create your own associations" },
              { icon: Gem, label: "Stability", desc: "Daily 10 💎 stipend" },
              { icon: Zap, label: "4x XP Multiplier", desc: "Elite experience gain" },
              { icon: TrendingUp, label: "Market", desc: "Max bid: +300% market value" },
              { icon: Users, label: "Squad", desc: "Squad limit: 12 heroes" },
              { icon: Coins, label: "Finance", desc: "+100% Sponsor Bonus (Total 200%)" }
            ] 
          }
        ]
      },
      creator: { nickname: "Hero Name", placeholderNick: "Enter unique nickname...", role: "Primary Role", talent: "Talent Potential", age: "Starting Age", country: "Nationality", summary: "Strategic Unit Profile", summaryDesc: "Adult units (18+) join main squad immediately", insufficient: "Insufficient Diamonds" },
      confirm: "CONFIRM TRANSACTION",
      diamondPacks: [ { label: "Cadet Pack", amount: 1000, price: "$4.99" }, { label: "Commander Cache", amount: 5000, price: "$19.99" }, { label: "Emperor Vault", amount: 15000, price: "$49.99" } ],
    },
    ru: {
      title: "ТОРГОВЫЙ УЗЕЛ",
      subtitle: "Безопасное получение ресурсов",
      back: "В меню терминала",
      insufficient: "Недостаточно ресурсов",
      tabs: {
        diamonds: { label: "Купить алмазы", desc: "Приобрести премиальную валюту", icon: Gem, color: "text-blue-400" },
        premium: { label: "Элитный Статус", desc: "Ежемесячные привилегии элитного клуба", icon: Crown, color: "text-yellow-500" },
        licenses: { label: "Лицензии", desc: "Уровни допуска и полномочий", icon: ScrollText, color: "text-red-400" },
        create_player: { label: "Создать игрока", desc: "Генерация элитного героя высокого уровня", icon: UserPlus, color: "text-primary" },
        exchange: { label: "Обмен Алмазы на €", desc: "Конвертация кристаллов в бюджет клуба", icon: ArrowRightLeft, color: "text-yellow-400" },
        change_name: { label: "Сменить название", desc: "Обновить позывной вашего клуба", icon: Edit3, color: "text-accent" },
        change_country: { label: "Сменить страну", desc: "Изменить регион базирования клуба", icon: Flag, color: "text-orange-400" }
      },
      premiumInfo: {
        title: "ЭЛИТНЫЙ ДОСТУП",
        cost: "5,000 Алмазов",
        duration: "30 Дней",
        benefits: [
          { icon: Crown, label: "Особая отметка к названию", desc: "Признание в чатах и рейтингах" },
          { icon: Gem, label: "50 кристаллов в день", desc: "Ежедневная поддержка ресурсами" },
          { icon: Zap, label: "В 5 раз больше опыта", desc: "Ускоренная прокачка менеджера" },
          { icon: ArrowRightLeft, label: "Безлимитные торги", desc: "Снятие ограничений на ставку" },
          { icon: Users, label: "Состав до 15 игроков", desc: "Расширенный ростер персонала" },
          { icon: TrendingUp, label: "200% Бонус Спонсоров", desc: "Выплаты в 3 раза выше" }
        ],
        active: "ЭЛИТНЫЙ СТАТУС АКТИВИРОВАН",
        expires: "Истекает",
        buy: "АКТИВИРОВАТЬ ЭЛИТНЫЙ СТАТУС"
      },
      licenseInfo: {
        current: "Ваш уровень допуска",
        upgrade: "Повысить уровень",
        order: "Лицензии приобретаются последовательно.",
        tiers: [
          { 
            tier: 4, label: "Стандартная Лицензия", cost: 0, 
            benefits: [
              { icon: ShieldAlert, label: "Ограничение", desc: "Участие только в 1 турнире в день" },
              { icon: Swords, label: "Ограничение", desc: "Только 5 тов. матчей в день" },
              { icon: Target, label: "Ограничение", desc: "Макс. уровень построек: 10" },
              { icon: TrendingUp, label: "Ограничение", desc: "Ставка: не более +10% от цены" },
              { icon: Users, label: "Ограничение", desc: "Лимит состава: 7 героев" },
              { icon: Coins, label: "Ограничение", desc: "Спонсорские выплаты: только 50%" }
            ] 
          },
          { 
            tier: 3, label: "Лицензия B-Tier", cost: 500, 
            benefits: [
              { icon: ShieldCheck, label: "Разрешение", desc: "Снятие лимитов постройки и матчей" },
              { icon: Users, label: "Ассоциации", desc: "Возможность вступать в ассоциации" },
              { icon: Zap, label: "2x Опыт", desc: "Ускоренное получение опыта" },
              { icon: TrendingUp, label: "Рынок", desc: "Ставка: до +30% от цены" },
              { icon: Users, label: "Состав", desc: "Лимит состава: 8 героев" },
              { icon: Coins, label: "Финансы", desc: "Полные выплаты спонсоров (100%)" }
            ] 
          },
          { 
            tier: 2, label: "Лицензия A-Tier", cost: 1500, 
            benefits: [
              { icon: Zap, label: "3x Опыт", desc: "Быстрая прокачка уровня" },
              { icon: TrendingUp, label: "Рынок", desc: "Ставка: до +100% от цены" },
              { icon: Users, label: "Состав", desc: "Лимит состава: 10 героев" },
              { icon: Coins, label: "Бонус", desc: "Спонсорский бонус 50% (Итого 150%)" }
            ] 
          },
          { 
            tier: 1, label: "Лицензия S-Tier", cost: 3000, 
            benefits: [
              { icon: Star, label: "Подарки", desc: "Дарить подарки друзьям ежедневно" },
              { icon: Award, label: "Alliance", desc: "Создание собственных ассоциаций" },
              { icon: Gem, label: "Алмазы", desc: "10 алмазов ежедневно" },
              { icon: Zap, label: "4x Опыт", desc: "Элитная прокачка уровня" },
              { icon: TrendingUp, label: "Рынок", desc: "Ставка: до +300% от цены" },
              { icon: Users, label: "Состав", desc: "Лимит состава: 12 героев" },
              { icon: Coins, label: "Бонус", desc: "Спонсорский бонус 100% (Итого 200%)" }
            ] 
          }
        ]
      },
      creator: { nickname: "Имя героя", placeholderNick: "Введите уникальный позывной...", role: "Специализация", talent: "Предел таланта", age: "Начальный возраст", country: "Национальность", summary: "Профиль боевой единицы", summaryDesc: "Взрослые юнииты (18+) сразу попадают в основу", insufficient: "Недостаточно алмазов" },
      confirm: "ПОДТВЕРДИТЬ ТРАНЗАКЦИЮ",
      diamondPacks: [ { label: "Пакет Кадета", amount: 1000, price: "4.99 $" }, { label: "Кейс Командира", amount: 5000, price: "19.99 $" }, { label: "Хранилище Императора", amount: 15000, price: "49.99 $" } ],
    }
  };

  const t = translations[language as keyof typeof translations] || translations.ru;

  const getToken = async () => {
    if (!user) throw new Error('AUTHENTICATION_REQUIRED');
    return user.getIdToken(true);
  };

  const handleBuyPremium = async () => {
    try {
      setIsProcessing(true);
      const res = await purchasePremiumShopAction(await getToken());
      if ('error' in res) throw new Error(res.error || 'PREMIUM_PURCHASE_FAILED');
      toast({ title: language === 'ru' ? 'Элитный статус активирован на 30 дней!' : 'Elite status activated for 30 days!' });
      setActiveTab('menu');
    } catch (e: any) {
      toast({ title: e?.message || t.insufficient, variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCreatePlayer = async () => {
    const country = COUNTRIES.find(c => c.code === heroCountryCode) || COUNTRIES[0];
    try {
      setIsProcessing(true);
      const res = await createShopPlayerAction(await getToken(), {
        nickname: heroNickname.trim(),
        role: heroRole,
        talent: Number(heroTalent),
        age: Number(heroAge),
        country: { code: country.code, name: country.name, flag: country.flag },
      });
      if ('error' in res) throw new Error(res.error || 'PLAYER_CREATION_FAILED');
      toast({ title: ('isYouth' in res && res.isYouth) ? 'Игрок отправлен в Академию!' : 'Игрок добавлен в состав!' });
      setHeroNickname('');
      setActiveTab('menu');
    } catch (e: any) {
      toast({ title: e?.message || t.insufficient, variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBuyDiamonds = async (amount: number) => {
    try {
      setIsProcessing(true);
      const res = await purchaseDiamondPackAction(await getToken(), amount);
      if ('error' in res && res.error) throw new Error(res.error || 'DIAMOND_PURCHASE_FAILED');
      toast({
        title: res.pending
          ? (language === 'ru' ? 'Заказ создан. Ожидается подтверждение платежа.' : 'Order created. Payment confirmation required.')
          : (language === 'ru' ? `Зачислено +${amount} 💎` : `+${amount} 💎 added`),
      });
    } catch (e: any) {
      toast({ title: e?.message || 'DIAMOND_PURCHASE_FAILED', variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };
  
  const handleBuyLicense = async (tier: number) => {
    try {
      setIsProcessing(true);
      const res = await purchaseLicenseAction(await getToken(), tier);
      if ('error' in res) throw new Error(res.error || 'LICENSE_PURCHASE_FAILED');
      toast({ title: language === 'ru' ? 'Уровень допуска повышен!' : 'License tier upgraded!' });
      setActiveTab('menu');
    } catch (e: any) {
      toast({ title: e?.message || t.insufficient, variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExchange = async (amount: number) => {
    try {
      setIsProcessing(true);
      const res = await exchangeCrystalsForCreditsAction(await getToken(), amount);
      if ('error' in res) throw new Error(res.error || 'EXCHANGE_FAILED');
      toast({ title: language === 'ru' ? `Обменено ${amount} 💎 на €${(amount * 10000).toLocaleString()}` : 'Assets converted' });
    } catch (e: any) {
      toast({ title: e?.message || t.insufficient, variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleChangeName = async () => {
    if (!newName.trim()) return;
    try {
      setIsProcessing(true);
      const res = await changeClubNameAction(await getToken(), newName.trim());
      if ('error' in res) throw new Error(res.error || 'RENAME_FAILED');
      toast({ title: language === 'ru' ? 'Название команды изменено!' : 'Club name updated!' });
      setNewName('');
      setActiveTab('menu');
    } catch (e: any) {
      toast({ title: e?.message || t.insufficient, variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleChangeCountry = async (countryName: string) => {
    const country = COUNTRIES.find(c => c.name === countryName);
    if (!country) return;
    try {
      setIsProcessing(true);
      const res = await changeClubCountryAction(await getToken(), { code: country.code, name: country.name, flag: country.flag });
      if ('error' in res) throw new Error(res.error || 'COUNTRY_CHANGE_FAILED');
      toast({ title: language === 'ru' ? 'Страна команды изменена!' : 'Club country updated!' });
      setActiveTab('menu');
    } catch (e: any) {
      toast({ title: e?.message || t.insufficient, variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'licenses':
        const currentTier = activeLicenseTier || 4;
        const nextTierIndex = t.licenseInfo.tiers.findIndex(t => t.tier === currentTier - 1);
        const nextTier = nextTierIndex !== -1 ? t.licenseInfo.tiers[nextTierIndex] : null;
        const activeTierData = t.licenseInfo.tiers.find(t => t.tier === currentTier);

        return (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500 pb-6">
            <div className="p-4 bg-primary/10 border border-primary/20 rounded-xl flex gap-4 mb-2">
               <span className="p-1 rounded bg-primary/20 h-fit"><Info className="w-5 h-5 text-primary shrink-0" /></span>
               <p className="text-[10px] text-muted-foreground italic leading-relaxed">
                 {t.licenseInfo.order}
               </p>
            </div>

            <section className="space-y-3">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">{t.licenseInfo.current}</h3>
              <Card className="glass-card border-green-500/30 bg-green-500/5 overflow-hidden">
                <CardContent className="p-5 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-green-500/20 border border-green-500/30 text-green-400">
                      <ShieldCheck className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-sm font-black uppercase text-white">{activeTierData?.label}</h3>
                      <p className="text-[10px] text-green-400/70 font-black uppercase tracking-widest mt-1">ACTIVE STATUS</p>
                    </div>
                  </div>
                  <CheckCircle2 className="w-6 h-6 text-green-400" />
                </CardContent>
              </Card>
            </section>

            {nextTier ? (
              <section className="space-y-3">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-accent px-1">{t.licenseInfo.upgrade}</h3>
                <Card className="glass-card border-primary/30 bg-primary/5 overflow-hidden">
                   <CardContent className="p-6">
                      <div className="flex items-center gap-4 mb-6">
                        <div className="p-3 rounded-xl bg-primary/20 border border-primary/30 text-primary">
                          <ScrollText className="w-8 h-8" />
                        </div>
                        <div>
                          <h2 className="text-xl font-headline font-bold uppercase tracking-tight text-white">{nextTier.label}</h2>
                          <div className="flex gap-2 mt-1">
                            <Badge className="bg-primary text-primary-foreground font-black">{nextTier.cost} 💎</Badge>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2 mb-6">
                        {nextTier.benefits.map((benefit: any, idx: number) => (
                          <div key={idx} className="bg-secondary/20 p-3 rounded-xl border border-white/5 flex items-center gap-4">
                            <div className="p-2 rounded-lg bg-primary/10">
                              <benefit.icon className="w-4 h-4 text-primary" />
                            </div>
                            <div>
                              <h4 className="text-[10px] font-bold uppercase text-white">{benefit.label}</h4>
                              <p className="text-[9px] text-muted-foreground leading-tight">{benefit.desc}</p>
                            </div>
                          </div>
                        ))}
                      </div>

                      <Button 
                        className="w-full h-14 hero-gradient font-black text-xs tracking-widest uppercase shadow-xl active:scale-95 transition-all"
                        onClick={() => handleBuyLicense(nextTier.tier)}
                        disabled={isProcessing || crystals < nextTier.cost}
                      >
                        {language === 'ru' ? 'КУПИТЬ ЛИЦЕНЗИЮ' : 'ACQUIRE LICENSE'}
                      </Button>
                   </CardContent>
                </Card>
              </section>
            ) : (
              <div className="p-8 text-center bg-secondary/10 rounded-2xl border border-dashed border-white/5 opacity-40">
                <Trophy className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
                <p className="text-xs font-black uppercase tracking-widest">Master Command License Obtained</p>
              </div>
            )}
          </div>
        );

      case 'premium':
        return (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500 pb-6">
            <Card className="glass-card border-yellow-500/30 bg-gradient-to-br from-yellow-500/10 via-background to-transparent overflow-hidden">
               <CardContent className="p-8 text-center flex flex-col items-center">
                  <div className="relative mb-6">
                    <div className="absolute inset-0 bg-yellow-500/20 blur-2xl animate-pulse rounded-full"></div>
                    <div className="w-24 h-24 rounded-full bg-secondary/50 border-2 border-yellow-500 flex items-center justify-center shadow-[0_0_30px_rgba(234,179,8,0.3)] relative z-10">
                      <Crown className="w-12 h-12 text-yellow-500 animate-bounce" />
                    </div>
                  </div>
                  <h2 className="text-2xl font-headline font-bold uppercase tracking-tight text-white">{t.premiumInfo.title}</h2>
                  <div className="flex gap-4 mt-4">
                    <Badge className="bg-yellow-500 text-black font-black">{t.premiumInfo.cost}</Badge>
                    <Badge variant="outline" className="border-white/20 text-muted-foreground uppercase">{t.premiumInfo.duration}</Badge>
                  </div>
               </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-2">
              {t.premiumInfo.benefits.map((benefit, idx) => (
                <div key={idx} className="bg-secondary/20 p-4 rounded-xl border border-white/5 flex items-center gap-4">
                  <div className="p-2 rounded-lg bg-yellow-500/10">
                    <benefit.icon className="w-5 h-5 text-yellow-500" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold uppercase text-white">{benefit.label}</h4>
                    <p className="text-[10px] text-muted-foreground">{benefit.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-4">
              {isPremium ? (
                <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl text-center space-y-2">
                  <p className="text-xs font-black text-green-400 uppercase tracking-widest">{t.premiumInfo.active}</p>
                  <p className="text-[10px] text-muted-foreground uppercase">{t.premiumInfo.expires}: {new Date(premiumUntil!).toLocaleDateString()}</p>
                </div>
              ) : (
                <Button 
                  className="w-full h-16 hero-gradient font-black text-lg tracking-widest uppercase shadow-2xl shadow-yellow-500/20 active:scale-95 transition-all" 
                  onClick={handleBuyPremium}
                  disabled={isProcessing || crystals < 5000}
                >
                  {t.premiumInfo.buy}
                </Button>
              )}
            </div>
          </div>
        );

      case 'diamonds':
        return (
          <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-500 pb-6">
            {t.diamondPacks.map((pack, idx) => (
              <Card key={idx} className="glass-card border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/10 transition-all cursor-pointer group" onClick={() => handleBuyDiamonds(pack.amount)}>
                <CardContent className="p-5 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-blue-500/20 border border-blue-500/30 group-hover:scale-110 transition-transform">
                       <Gem className="w-6 h-6 text-blue-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold uppercase text-white">{pack.label}</h3>
                      <p className="text-lg font-headline font-bold text-blue-400">+{pack.amount} 💎</p>
                    </div>
                  </div>
                  <Button className="h-10 px-6 hero-gradient font-black text-[10px] uppercase shadow-lg shadow-blue-500/20">
                    {pack.price}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        );

      case 'create_player':
        return (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500 pb-6">
            <Card className="glass-card border-primary/20 bg-primary/5 p-4 space-y-4">
               <div className="space-y-2">
                 <label className="text-[10px] font-black uppercase text-muted-foreground ml-1">{t.creator.nickname}</label>
                 <div className="relative">
                   <Edit3 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary" />
                   <Input 
                    value={heroNickname} 
                    onChange={e => setHeroNickname(e.target.value)} 
                    placeholder={t.creator.placeholderNick}
                    className="pl-10 h-11 bg-background/50 border-white/10"
                   />
                 </div>
               </div>
               <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-2">
                   <label className="text-[10px] font-black uppercase text-muted-foreground ml-1">{t.creator.role}</label>
                   <Select value={heroRole} onValueChange={(v) => setHeroRole(v as Role)}>
                     <SelectTrigger className="h-11 bg-background/50 border-white/10 text-xs font-bold uppercase">
                       <SelectValue />
                     </SelectTrigger>
                     <SelectContent className="bg-card border-white/10">
                       <SelectItem value="Carry" className="text-xs uppercase font-bold">Carry</SelectItem>
                       <SelectItem value="Midlaner" className="text-xs uppercase font-bold">Midlaner</SelectItem>
                       <SelectItem value="Tank" className="text-xs uppercase font-bold">Tank</SelectItem>
                       <SelectItem value="Jungler" className="text-xs uppercase font-bold">Jungler</SelectItem>
                       <SelectItem value="Support" className="text-xs uppercase font-bold">Support</SelectItem>
                     </SelectContent>
                   </Select>
                 </div>
                 <div className="space-y-2">
                   <label className="text-[10px] font-black uppercase text-muted-foreground ml-1">{t.creator.talent}</label>
                   <Select value={heroTalent} onValueChange={setHeroTalent}>
                     <SelectTrigger className="h-11 bg-background/50 border-white/10 text-xs font-bold uppercase">
                       <SelectValue />
                     </SelectTrigger>
                     <SelectContent className="bg-card border-white/10">
                       <SelectItem value="3.5" className="text-xs uppercase font-bold text-slate-400">Average (3.5★)</SelectItem>
                       <SelectItem value="4.0" className="text-xs uppercase font-bold text-primary">Elite (4.0★)</SelectItem>
                       <SelectItem value="4.5" className="text-xs uppercase font-bold text-accent">World Class (4.5★)</SelectItem>
                       <SelectItem value="5.0" className="text-xs uppercase font-bold text-yellow-500">Legendary (5.0★)</SelectItem>
                     </SelectContent>
                   </Select>
                 </div>
               </div>
               <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-2">
                   <label className="text-[10px] font-black uppercase text-muted-foreground ml-1">{t.creator.age}</label>
                   <Select value={heroAge} onValueChange={setHeroAge}>
                     <SelectTrigger className="h-11 bg-background/50 border-white/10 text-xs font-bold uppercase">
                       <SelectValue />
                     </SelectTrigger>
                     <SelectContent className="bg-card border-white/10">
                       {[14, 15, 16, 17, 18, 19, 20, 21, 22, 25, 28].map(age => (
                         <SelectItem key={age} value={age.toString()} className="text-xs uppercase font-bold">{age} {language === 'ru' ? 'лет' : 'years'}</SelectItem>
                       ))}
                     </SelectContent>
                   </Select>
                 </div>
                 <div className="space-y-2">
                   <label className="text-[10px] font-black uppercase text-muted-foreground ml-1">{t.creator.country}</label>
                   <Select value={heroCountryCode} onValueChange={setHeroCountryCode}>
                     <SelectTrigger className="h-11 bg-background/50 border-white/10 text-xs font-bold uppercase">
                       <SelectValue />
                     </SelectTrigger>
                     <SelectContent className="bg-card border-white/10 h-64">
                       {COUNTRIES.map(c => (
                         <SelectItem key={c.code} value={c.code} className="text-xs uppercase font-bold">
                           {c.flag} {c.name}
                         </SelectItem>
                       ))}
                     </SelectContent>
                   </Select>
                 </div>
               </div>
               <div className="pt-4 border-t border-white/5">
                 <div className="bg-background/50 p-4 rounded-xl border border-white/10 flex items-center justify-between">
                    <div>
                      <h4 className="text-[10px] font-black uppercase text-primary tracking-widest">{t.creator.summary}</h4>
                      <p className="text-[8px] text-muted-foreground italic mt-0.5">{t.creator.summaryDesc}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-black text-muted-foreground uppercase">Price</p>
                      <p className="text-xl font-headline font-bold text-primary flex items-center justify-end gap-1">
                        <Gem className="w-4 h-4" /> {creationCost}
                      </p>
                    </div>
                 </div>
                 <Button className="w-full h-14 hero-gradient font-black text-xs uppercase tracking-widest mt-4 shadow-xl" onClick={handleCreatePlayer} disabled={isProcessing || !heroNickname.trim()}>
                   {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : t.confirm}
                 </Button>
               </div>
            </Card>
          </div>
        );

      case 'exchange':
        return (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500 pb-6">
             <div className="grid grid-cols-1 gap-3">
               {[100, 500, 1000].map(amount => (
                 <Card key={amount} className="glass-card border-yellow-500/20 hover:bg-yellow-500/5 transition-all cursor-pointer" onClick={() => handleExchange(amount)}>
                   <CardContent className="p-5 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Gem className="w-5 h-5 text-blue-400" />
                        <span className="text-lg font-headline font-bold">{amount}</span>
                        <ArrowRightLeft className="w-4 h-4 text-muted-foreground mx-2" />
                        <Coins className="w-5 h-5 text-yellow-500" />
                        <span className="text-lg font-headline font-bold text-yellow-500">{(amount * 10000).toLocaleString()} €</span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                   </CardContent>
                 </Card>
               ))}
             </div>
             <p className="text-[8px] text-center text-muted-foreground uppercase font-black tracking-widest">1 💎 = 10,000 €</p>
          </div>
        );

      case 'change_name':
        return (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500 pb-6">
             <Card className="glass-card border-accent/20 bg-accent/5 p-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-muted-foreground ml-1">New Club Callsign</label>
                    <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Enter name..." className="bg-background/50 border-white/10 h-12" />
                  </div>
                  <div className="pt-4 border-t border-white/5 text-center">
                    <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-4">Cost: 100 💎</p>
                    <Button className="w-full h-12 hero-gradient font-black text-xs uppercase" onClick={handleChangeName} disabled={isProcessing || crystals < 100 || !newName.trim()}>
                      UPDATE CALLSIGN
                    </Button>
                  </div>
                </div>
             </Card>
          </div>
        );

      case 'change_country':
        return (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500 pb-6">
             <div className="grid grid-cols-3 gap-2">
               {COUNTRIES.map(c => (
                 <Card key={c.code} className={cn(
                   "glass-card border-white/5 hover:border-orange-500/30 transition-all cursor-pointer p-3 text-center",
                   currentCountry === c.name && "border-orange-500 bg-orange-500/10"
                 )} onClick={() => handleChangeCountry(c.name)}>
                    <span className="text-2xl mb-1 block">{c.flag}</span>
                    <span className="text-[7px] font-black uppercase text-muted-foreground truncate block">{c.name}</span>
                 </Card>
               ))}
             </div>
             <p className="text-[8px] text-center text-muted-foreground uppercase font-black tracking-widest pt-4">Relocation cost: 100 💎</p>
          </div>
        );

      default: return null;
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-6">
      <header className="mb-8 flex items-center gap-4">
        {activeTab === 'menu' ? (
          <Link href="/">
            <Button variant="ghost" size="icon" className="rounded-full">
              <ChevronLeft className="w-6 h-6" />
            </Button>
          </Link>
        ) : (
          <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setActiveTab('menu')}>
            <ChevronLeft className="w-6 h-6" />
          </Button>
        )}
        <div>
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter flex items-center gap-2 text-primary">
            <ShoppingCart className="w-6 h-6 text-primary" /> 
            {activeTab === 'menu' ? (language === 'ru' ? 'МАГАЗИН' : 'TRADING HUB') : t.tabs[activeTab as keyof typeof t.tabs].label}
          </h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest flex items-center gap-2">
            {activeTab === 'menu' ? t.subtitle : t.back}
            {activeTab === 'menu' && <span className="text-accent font-black">ID: {numericId || '---'}</span>}
          </p>
        </div>
      </header>

      {activeTab === 'menu' ? (
        <>
          <div className="grid grid-cols-2 gap-3 mb-8">
             <Card className="glass-card bg-blue-500/5 border-blue-500/20">
               <CardContent className="p-4 text-center">
                 <p className="text-[8px] font-black text-muted-foreground uppercase mb-1">Crystals</p>
                 <div className="flex items-center justify-center gap-2">
                   <Gem className="w-4 h-4 text-blue-400" />
                   <p className="text-xl font-headline font-black italic text-blue-400">{crystals || 0}</p>
                 </div>
               </CardContent>
             </Card>
             <Card className="glass-card bg-yellow-500/5 border-yellow-500/20">
               <CardContent className="p-4 text-center">
                 <p className="text-[8px] font-black text-muted-foreground uppercase mb-1">Credits</p>
                 <div className="flex items-center justify-center gap-2">
                   <span className="text-yellow-500 font-black">€</span>
                   <p className="text-xl font-headline font-black italic text-yellow-500">{formatCurrency(credits)}</p>
                 </div>
               </CardContent>
             </Card>
          </div>

          <div className="space-y-2">
            {(Object.entries(t.tabs) as [ShopTab, any][]).map(([id, data]) => (
              <Card key={id} className="glass-card border-white/5 hover:bg-white/5 transition-all cursor-pointer group" onClick={() => setActiveTab(id)}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={cn("p-2.5 rounded-xl bg-secondary/50", data.color)}><data.icon className="w-5 h-5" /></div>
                    <div>
                      <h3 className="text-sm font-bold uppercase group-hover:text-white transition-colors">{data.label}</h3>
                      <p className="text-[10px] text-muted-foreground leading-tight">{data.desc}</p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      ) : renderContent()}
    </div>
  );
}
