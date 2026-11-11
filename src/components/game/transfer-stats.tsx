import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STAT_KEYS } from '@/app/lib/player-stats';
export { STAT_KEYS };

function normTalent(value: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n < 10 ? Math.round(n * 10) : Math.round(n);
}

export function renderStars(talent: number) {
  const numericTalent = normTalent(talent);
  const heightClass = 'h-7';
  if (numericTalent > 50) {
    let src = 'https://iili.io/Cnrlw6F.md.png';
    if (numericTalent >= 60 && numericTalent <= 69) src = 'https://iili.io/CnrSxcJ.md.png';
    if (numericTalent >= 70) src = 'https://iili.io/CnrUKJf.md.png';
    return <img src={src} alt={`${numericTalent} stars`} className={cn(heightClass, 'w-auto object-contain')} />;
  }
  const starRating = Math.max(0, numericTalent / 10);
  return <div className={cn('flex items-center gap-0.5', heightClass)}>{Array.from({ length: 5 }).map((_, i) => {
    const fill = Math.min(Math.max(starRating - i, 0), 1);
    return <div key={i} className="relative w-3 h-3 flex items-center justify-center"><Star className="absolute inset-0 text-muted-foreground/10 w-3 h-3" /><div className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}><Star className="text-yellow-500 fill-yellow-500 w-3 h-3" /></div></div>;
  })}</div>;
}
