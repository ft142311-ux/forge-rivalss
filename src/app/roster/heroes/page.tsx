'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useUser } from '@/firebase';
import { useGameState } from '../../lib/store';
import { HERO_CATALOG, getHeroPoolPreview } from '../../lib/hero-draft-system';
import { updateTacticsAction } from '@/app/actions/gameplay';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ShieldBan, Swords, Save, Sparkles } from 'lucide-react';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { useToast } from '@/hooks/use-toast';

type DraftPrefs = { preferredHeroes: string[]; bannedHeroes: string[] };
const emptyPrefs: DraftPrefs = { preferredHeroes: [], bannedHeroes: [] };

export default function HeroesDraftPage() {
  const { user, isUserLoading } = useUser();
  const { ownedPlayers, language, isLoaded, strategy, tactics, lineSettings } = useGameState() as any;
  const { toast } = useToast();
  const ru = language !== 'en';
  const [prefs, setPrefs] = useState<DraftPrefs>(emptyPrefs);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const source = tactics?.draftPreferences || lineSettings?.draftPreferences || {};
    setPrefs({
      preferredHeroes: Array.isArray(source.preferredHeroes) ? source.preferredHeroes.filter((id: unknown) => typeof id === 'string') : [],
      bannedHeroes: Array.isArray(source.bannedHeroes) ? source.bannedHeroes.filter((id: unknown) => typeof id === 'string') : [],
    });
  }, [tactics, lineSettings]);

  const players = useMemo(() => (Array.isArray(ownedPlayers) ? ownedPlayers : []).slice(0, 5), [ownedPlayers]);
  const toggle = (key: keyof DraftPrefs, id: string) => setPrefs(current => {
    const has = current[key].includes(id);
    const limit = key === 'preferredHeroes' ? 5 : 2;
    if (!has && current[key].length >= limit) {
      toast({ title: ru ? `Можно выбрать не более ${limit}` : `Choose up to ${limit}`, variant: 'destructive' });
      return current;
    }
    return { ...current, [key]: has ? current[key].filter(x => x !== id) : [...current[key], id] };
  });

  const save = async () => {
    if (!user || busy) return;
    setBusy(true);
    try {
      const base = tactics && typeof tactics === 'object' ? tactics : lineSettings && typeof lineSettings === 'object' ? lineSettings : {};
      const next = { ...base, draftPreferences: { preferredHeroes: prefs.preferredHeroes, bannedHeroes: prefs.bannedHeroes } };
      const result = await updateTacticsAction(await user.getIdToken(true), strategy || 'Balanced Play', next);
      if (!result?.success) throw new Error(result?.error || 'DRAFT_PREFERENCES_SAVE_FAILED');
      toast({ title: ru ? 'Настройки драфта сохранены' : 'Draft preferences saved' });
    } catch (error: any) {
      toast({ title: error?.message || (ru ? 'Не удалось сохранить' : 'Save failed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  if (isUserLoading || !isLoaded || !user) return <LoadingScreen />;

  return <main className="max-w-2xl mx-auto px-4 pt-8 pb-32 space-y-5">
    <header className="flex items-center gap-3">
      <Link href="/roster"><Button variant="ghost" size="icon" className="rounded-full"><ChevronLeft /></Button></Link>
      <div className="min-w-0"><h1 className="text-2xl font-black uppercase tracking-tight flex items-center gap-2"><Swords className="w-6 h-6 text-primary" />{ru ? 'ГЕРОИ И ДРАФТ' : 'HEROES & DRAFT'}</h1><p className="text-[10px] text-muted-foreground uppercase tracking-widest">{ru ? 'Предпочтения и баны перед матчем' : 'Pre-match picks and bans preferences'}</p></div>
    </header>

    <Card className="border-primary/20 bg-primary/5"><CardContent className="p-4 space-y-2">
      <div className="flex items-center gap-2 font-black text-sm"><Sparkles className="w-4 h-4 text-primary" />{ru ? 'Как работают настройки' : 'How preferences work'}</div>
      <p className="text-xs text-muted-foreground leading-relaxed">{ru ? 'Выбери до 5 предпочитаемых героев и до 2 героев для бана. Настройки влияют на автоматический драфт, когда матч запускается через Match Core. Если герой недоступен или забанен, система подберёт альтернативу из пула игрока.' : 'Choose up to 5 preferred heroes and up to 2 bans. These preferences guide the automatic draft when a match runs through Match Core. Unavailable or banned heroes are replaced with a suitable hero from the player pool.'}</p>
      <div className="flex flex-wrap gap-2"><Badge variant="outline">{prefs.preferredHeroes.length}/5 {ru ? 'предпочтений' : 'preferences'}</Badge><Badge variant="outline">{prefs.bannedHeroes.length}/2 {ru ? 'бана' : 'bans'}</Badge></div>
    </CardContent></Card>

    <section className="space-y-3">
      <div><h2 className="font-black uppercase text-sm">{ru ? 'Предпочитаемые герои' : 'Preferred heroes'}</h2><p className="text-[10px] text-muted-foreground">{ru ? 'Драфт будет стараться выбрать их, если они подходят роли и доступны.' : 'The draft will favor these when available and role-compatible.'}</p></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{HERO_CATALOG.map(hero => {
        const selected = prefs.preferredHeroes.includes(hero.id);
        const banned = prefs.bannedHeroes.includes(hero.id);
        return <button type="button" key={hero.id} disabled={banned} onClick={() => toggle('preferredHeroes', hero.id)} className={`text-left rounded-xl border p-3 transition-colors ${selected ? 'border-primary bg-primary/10' : 'border-white/10 bg-card hover:bg-white/5'} ${banned ? 'opacity-40' : ''}`}>
          <div className="flex items-start justify-between gap-2"><span className="font-bold text-xs">{hero.name}</span>{selected && <Badge>{ru ? 'Приоритет' : 'Priority'}</Badge>}</div>
          <div className="flex flex-wrap gap-1 mt-2">{hero.roles.map(role => <Badge key={role} variant="outline" className="text-[9px]">{role}</Badge>)}</div>
          <p className="text-[10px] text-muted-foreground mt-2">{hero.tags.join(' · ')}</p>
        </button>;
      })}</div>
    </section>

    <section className="space-y-3">
      <div className="flex items-center gap-2"><ShieldBan className="w-4 h-4 text-destructive"/><div><h2 className="font-black uppercase text-sm">{ru ? 'Герои для бана' : 'Ban preferences'}</h2><p className="text-[10px] text-muted-foreground">{ru ? 'До двух героев, которых команда предпочитает исключать.' : 'Up to two heroes your team prefers to ban.'}</p></div></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{HERO_CATALOG.map(hero => {
        const selected = prefs.bannedHeroes.includes(hero.id);
        const preferred = prefs.preferredHeroes.includes(hero.id);
        return <button type="button" key={hero.id} disabled={preferred} onClick={() => toggle('bannedHeroes', hero.id)} className={`text-left rounded-xl border p-3 transition-colors ${selected ? 'border-destructive bg-destructive/10' : 'border-white/10 bg-card hover:bg-white/5'} ${preferred ? 'opacity-40' : ''}`}>
          <div className="flex items-center justify-between gap-2"><span className="font-bold text-xs">{hero.name}</span>{selected && <Badge variant="destructive">{ru ? 'Бан' : 'Ban'}</Badge>}</div>
          <p className="text-[10px] text-muted-foreground mt-2">{hero.tags.join(' · ')}</p>
        </button>;
      })}</div>
    </section>

    <section className="space-y-3">
      <div><h2 className="font-black uppercase text-sm">{ru ? 'Пулы и мастерство состава' : 'Squad pools & mastery'}</h2><p className="text-[10px] text-muted-foreground">{ru ? 'Предпросмотр вычисляется из существующих данных игроков; ничего не записывается в их характеристики.' : 'Preview is derived from current player data; no player attributes are modified.'}</p></div>
      {players.map((player: any, index: number) => {
        const pool = getHeroPoolPreview(player, player.currentRole || player.role);
        return <Card key={player.id || player.name || index} className="glass-card border-white/5"><CardContent className="p-3">
          <div className="flex items-center gap-3 mb-3">{player.image ? <img src={player.image} alt="" className="w-10 h-10 rounded-lg object-cover" /> : <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center"><Swords className="w-4 h-4"/></div>}<div className="min-w-0"><div className="font-bold text-xs truncate">{player.name || (ru ? `Игрок ${index + 1}` : `Player ${index + 1}`)}</div><div className="text-[10px] text-muted-foreground">{player.currentRole || player.role || 'Carry'} · OVR {player.overallRating ?? player.overall ?? '—'}</div></div></div>
          <div className="flex flex-wrap gap-1">{pool.map(({ hero, mastery }) => <Badge key={hero.id} variant="outline" className="text-[9px]">{hero.name} · {ru ? 'мастерство' : 'mastery'} {mastery}</Badge>)}</div>
        </CardContent></Card>;
      })}
      {players.length === 0 && <p className="text-xs text-muted-foreground">{ru ? 'Состав пока не найден. Настройки предпочтений всё равно можно сохранить.' : 'No roster found yet. Preferences can still be saved.'}</p>}
    </section>

    <Button onClick={() => void save()} disabled={busy} className="w-full h-12 font-black uppercase tracking-wider"><Save className="w-4 h-4 mr-2"/>{busy ? (ru ? 'СОХРАНЕНИЕ…' : 'SAVING…') : (ru ? 'СОХРАНИТЬ ДРАФТ' : 'SAVE DRAFT SETTINGS')}</Button>
  </main>;
}
