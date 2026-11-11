
'use client';

import { useState, memo } from 'react';
import { useGameState } from '@/app/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Timer, Star, Gavel, Users, Zap, Gem, Target, Eye, Map, Sparkles, Sword, Crosshair, Brain, TrendingUp, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { PlayerDossier } from '@/components/game/PlayerDossier';
import { calculateLiveAge } from '@/app/lib/time-utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

const normTalent = (val: any) => { const n = Number(val); if (isNaN(n)) return 0; return n < 10 ? Math.round(n * 10) : Math.round(n); };
const renderStars = (talent: number) => {
  const numericTalent = normTalent(talent); const heightClass = 'h-7';
  if (numericTalent > 50) { let src = 'https://iili.io/Cnrlw6F.md.png'; if (numericTalent >= 60 && numericTalent <= 69) src = 'https://iili.io/CnrSxcJ.md.png'; if (numericTalent >= 70) src = 'https://iili.io/CnrUKJf.md.png'; return <img src={src} alt={`${numericTalent} stars`} className={cn(heightClass, 'w-auto object-contain')} />; }
  const starRating = Math.max(0, numericTalent / 10);
  return <div className={cn('flex items-center gap-0.5', heightClass)}>{Array.from({ length: 5 }).map((_, i) => { const fill = Math.min(Math.max(starRating - i, 0), 1); return <div key={i} className='relative w-3 h-3 flex items-center justify-center'><Star className='absolute inset-0 text-muted-foreground/10 w-3 h-3' /><div className='absolute inset-0 overflow-hidden' style={{ width: `${fill * 100}%` }}><Star className='text-yellow-500 fill-yellow-500 w-3 h-3' /></div></div>; })}</div>;
};

export const TransferPlayerCard = memo(({ 
  agent, 
  user, 
  onBid, 
  now,
  language 
}: { 
  agent: any, 
  user: any, 
  profile?: any,
  onBid: (agent: any, amount: number) => Promise<void>,
  now: number,
  language: string
}) => {
  const [showBidModal, setShowBidModal] = useState(false);
  const [showDossier, setShowDossier] = useState(false);
  const [bidPercent, setBidPercent] = useState(3);
  const [bidAmount, setBidAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const { displayName } = useGameState();

  const isLeading = agent.highestBidderId === user?.uid;
  const isOwner = agent.sellerId === user?.uid;
  const isDiamond = agent.currency === 'crystals';
  const minimumBid = Math.ceil(Number(agent.currentBid || agent.startingPrice || 0) * 1.03);
  const maxBid = Math.floor(Number(agent.maxBid || Number(agent.startingPrice || agent.currentBid || 0) * 3));
  const suggestedBid = Math.min(maxBid, Math.ceil(Number(agent.currentBid || 0) * (1 + bidPercent / 100)));
  const nextBidValue = Math.max(minimumBid, suggestedBid);
  const liveAge = calculateLiveAge(agent.heroData.baseAge, agent.heroData.hiredAt);
  
  const talentsValues = Object.values(agent.heroData.proTalents || {}).map(v => normTalent(v));
  const maxTalentValue = Math.max(...talentsValues);

  const rolesRu: Record<string, string> = {
    'Carry': 'Керри', 'Midlaner': 'Мидер', 'Tank': 'Танк', 'Jungler': 'Лес', 'Support': 'Саппорт'
  };

  const proStatsLabels: Record<string, string> = {
    lastHitting: language === 'ru' ? "Добив крипов" : "Last Hitting",
    mapAwareness: language === 'ru' ? "Контроль карты" : "Map Awareness",
    positioning: language === 'ru' ? "Позиционка" : "Positioning",
    reflexes: language === 'ru' ? "Рефлексы" : "Reflexes",
    manaManagement: language === 'ru' ? "Менеджмент маны" : "Mana Management",
    objectiveControl: language === 'ru' ? "Объекты" : "Objective Control",
    communication: language === 'ru' ? "Конмуникация" : "Communication",
    tiltResistance: language === 'ru' ? "Стрессоустойчивость" : "Tilt Resistance",
    versatility: language === 'ru' ? "Универсальность" : "Versatility",
    ganking: language === 'ru' ? "Ганкинг" : "Ganking",
  };

  const icons: Record<string, any> = {
    lastHitting: Target, mapAwareness: Eye, positioning: Map, reflexes: Zap,
    manaManagement: Sparkles, objectiveControl: Sword, communication: Users,
    tiltResistance: Brain, versatility: TrendingUp, ganking: Crosshair,
  };

  const handleOpenBid = (e?: any) => {
    e?.stopPropagation?.();
    if (isOwner || isLeading || maxBid <= Number(agent.currentBid || 0)) return;
    setBidAmount(String(nextBidValue));
    setShowBidModal(true);
  };

  const handleConfirmBid = async () => {
    const amount = Math.floor(Number(bidAmount));
    if (!Number.isFinite(amount) || amount < minimumBid || amount > maxBid || isProcessing) return;
    setIsProcessing(true);
    try {
      await onBid(agent, amount);
      setShowBidModal(false);
    } finally {
      setIsProcessing(false);
    }
  };

  const getCountdown = (expiryIso: string) => {
    const expiry = new Date(expiryIso).getTime();
    const diff = expiry - now;
    if (diff <= 0) return "00:00:00";
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <>
      <Card 
        onClick={() => setShowDossier(true)}
        className={cn(
          "glass-card border-white/5 overflow-hidden transition-all cursor-pointer active:scale-[0.98]", 
          isLeading && "border-green-500/40 bg-green-500/5",
          isOwner && "border-primary/40 bg-primary/5",
          agent.isPro && "border-yellow-500/30 shadow-[0_0_20px_rgba(234,179,8,0.1)]"
        )}
      >
        <CardContent className="p-2.5">
          <div className="flex items-center justify-between mb-1.5">
             <div className="flex items-center gap-1 text-accent">
               <Timer className="w-2.5 h-2.5 animate-pulse" />
               <span className="text-[8px] font-mono font-bold tracking-tighter">{getCountdown(agent.expiresAt)}</span>
             </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <div className="w-[72px] h-[72px] rounded-lg overflow-hidden bg-secondary/30 border border-white/10 relative shadow-lg">
                <img src={agent.heroData?.image} alt="" className="w-full h-full object-cover" />
                <div className="absolute -bottom-1 -right-1 bg-background rounded-sm p-0.5 border border-white/10 shadow-xl z-10 flex items-center justify-center">
                  <span className="text-[8px] leading-none">{agent.heroData.country?.flag}</span>
                </div>
              </div>
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex flex-col gap-0.5 mb-1">
                <h3 className="text-[11px] font-bold uppercase truncate text-white tracking-tight leading-none">{agent.heroData?.name}</h3>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[6px] h-3 py-0 border-white/10 uppercase font-black text-primary/80">
                    {rolesRu[agent.heroData.role] || agent.heroData.role}
                  </Badge>
                  <span className="text-[7px] font-black text-muted-foreground uppercase tracking-widest">Age: {liveAge.display}</span>
                </div>
              </div>
              
              <div className="flex items-center min-h-[32px]">
                {renderStars(maxTalentValue)}
              </div>
            </div>
            
            <div className="text-right flex flex-col items-end shrink-0 justify-center pr-1">
              <p className="text-[6px] font-black text-primary uppercase tracking-widest leading-none mb-0.5">ОБЩ</p>
              <p className="text-xl font-headline font-bold text-accent italic leading-none">{agent.heroData?.overallRating}</p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-2 mt-1.5 border-t border-white/5">
            <div className="flex flex-col gap-1 min-w-0 flex-1">
              <div className="flex items-center justify-between pr-2">
                <div className="flex items-center gap-1">
                  {isDiamond ? <Gem className="w-2.5 h-2.5 text-blue-400" /> : <span className="text-white font-black text-[10px] leading-none">€</span>}
                  <p className="text-sm font-headline font-bold text-white tracking-tight leading-none">{agent.currentBid?.toLocaleString()}</p>
                </div>
              </div>
              <div className={cn("flex items-center gap-1.5 min-w-0 text-[8px] uppercase tracking-wider", agent.highestBidderName ? "text-accent" : "text-muted-foreground")}>
                <Gavel className="w-2.5 h-2.5 shrink-0" />
                <span className="shrink-0 font-black">{language === 'ru' ? 'Ставка:' : 'Bid:'}</span>
                <span className="truncate font-bold">{agent.highestBidderName || (language === 'ru' ? 'Нет ставок' : 'No bids')}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <PlayerDossier
        player={agent.heroData ? { ...agent.heroData, onTransferUntil: agent.expiresAt } : null}
        open={showDossier}
        onClose={() => setShowDossier(false)}
        language={language}
        ownerName={agent.sellerName || 'Manager'}
        actions={
          <Button
            className="w-full h-12 hero-gradient font-black text-[10px] uppercase tracking-widest"
            onClick={() => { setShowDossier(false); handleOpenBid(); }}
            disabled={isOwner || isLeading || maxBid <= Number(agent.currentBid || 0)}
          >
            <Gavel className="w-4 h-4 mr-2" />
            {isOwner ? (language === 'ru' ? 'ВАШ АУКЦИОН' : 'YOUR AUCTION')
              : isLeading ? (language === 'ru' ? 'ВЫ ЛИДИРУЕТЕ' : 'YOU ARE LEADING')
              : maxBid <= Number(agent.currentBid || 0) ? (language === 'ru' ? 'ДОСТИГНУТ МАКСИМУМ' : 'MAXIMUM REACHED')
              : (language === 'ru' ? 'СДЕЛАТЬ СТАВКУ' : 'PLACE BID')}
          </Button>
        }
      />

      <Dialog open={showBidModal} onOpenChange={setShowBidModal}>
        <DialogContent className="max-w-sm bg-card border-white/10" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle className="uppercase font-black">{language === 'ru' ? 'Сделать ставку' : 'Place bid'}</DialogTitle>
            <DialogDescription className="text-xs">
              {language === 'ru'
                ? `Минимум €${minimumBid.toLocaleString('ru-RU')} · максимум €${maxBid.toLocaleString('ru-RU')}`
                : `Minimum €${minimumBid.toLocaleString('en-US')} · maximum €${maxBid.toLocaleString('en-US')}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-3 gap-2">
              {[3, 5, 10].map((percent) => {
                const value = Math.min(maxBid, Math.ceil(Number(agent.currentBid || 0) * (1 + percent / 100)));
                return (
                  <Button key={percent} variant="outline" className="h-9 text-[9px] font-black" disabled={value < minimumBid} onClick={() => setBidAmount(String(value))}>
                    +{percent}%
                  </Button>
                );
              })}
            </div>
            <div className="space-y-1.5">
              <label className="text-[8px] font-black uppercase text-muted-foreground">{language === 'ru' ? 'Ваша ставка' : 'Your bid'}</label>
              <Input
                type="number"
                min={minimumBid}
                max={maxBid}
                step={1}
                value={bidAmount}
                onChange={(e) => setBidAmount(e.target.value)}
                className="h-12 text-lg font-black"
              />
            </div>
            <p className="text-[9px] text-muted-foreground leading-relaxed">
              {language === 'ru'
                ? 'Если ставка сделана в последние 10 минут, окончание аукциона переносится на 10 минут от момента этой ставки.'
                : 'A bid placed during the final 10 minutes moves the auction end to 10 minutes after that bid.'}
            </p>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowBidModal(false)} disabled={isProcessing}>{language === 'ru' ? 'ОТМЕНА' : 'CANCEL'}</Button>
            <Button className="hero-gradient font-black" onClick={handleConfirmBid} disabled={isProcessing || Number(bidAmount) < minimumBid || Number(bidAmount) > maxBid}>
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gavel className="w-4 h-4 mr-2" />}
              {language === 'ru' ? 'ПОДТВЕРДИТЬ' : 'CONFIRM BID'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});

TransferPlayerCard.displayName = 'TransferPlayerCard';

