'use client';

import { useGameState } from '@/app/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { 
  ChevronLeft, Search, Zap, Shield, Sparkles, 
  Sword, Info, User, LayoutGrid, List,
  Layers, Filter, X
} from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useState, useMemo } from 'react';
import { PlaceHolderImages } from '@/app/lib/placeholder-images';

type Attribute = 'Strength' | 'Agility' | 'Intelligence' | 'Universal';
type ViewMode = 'grid' | 'list';

interface HeroBase {
  name: string;
  attr: Attribute;
  type: 'Melee' | 'Ranged';
  role: string;
}

const HEROES_LIST: HeroBase[] = [
  // Strength
  { name: "Abaddon", attr: "Strength", type: "Melee", role: "Support/Tank" },
  { name: "Alchemist", attr: "Strength", type: "Melee", role: "Carry" },
  { name: "Axe", attr: "Strength", type: "Melee", role: "Tank" },
  { name: "Beastmaster", attr: "Strength", type: "Melee", role: "Utility" },
  { name: "Brewmaster", attr: "Strength", type: "Melee", role: "Utility" },
  { name: "Bristleback", attr: "Strength", type: "Melee", role: "Tank" },
  { name: "Centaur Warrunner", attr: "Strength", type: "Melee", role: "Tank" },
  { name: "Chaos Knight", attr: "Strength", type: "Melee", role: "Carry" },
  { name: "Clockwerk", attr: "Strength", type: "Melee", role: "Utility" },
  { name: "Dawnbreaker", attr: "Strength", type: "Melee", role: "Carry/Tank" },
  { name: "Doom", attr: "Strength", type: "Melee", role: "Utility" },
  { name: "Dragon Knight", attr: "Strength", type: "Melee", role: "Carry/Tank" },
  { name: "Earth Spirit", attr: "Strength", type: "Melee", role: "Support" },
  { name: "Earthshaker", attr: "Strength", type: "Melee", role: "Support" },
  { name: "Elder Titan", attr: "Strength", type: "Melee", role: "Support" },
  { name: "Huskar", attr: "Strength", type: "Ranged", role: "Carry" },
  { name: "Kunkka", attr: "Strength", type: "Melee", role: "Utility" },
  { name: "Legion Commander", attr: "Strength", type: "Melee", role: "Carry" },
  { name: "Lifestealer", attr: "Strength", type: "Melee", role: "Carry" },
  { name: "Mars", attr: "Strength", type: "Melee", role: "Tank" },
  { name: "Night Stalker", attr: "Strength", type: "Melee", role: "Utility" },
  { name: "Pudge", attr: "Strength", type: "Melee", role: "Utility" },
  { name: "Slardar", attr: "Strength", type: "Melee", role: "Utility" },
  { name: "Sven", attr: "Strength", type: "Melee", role: "Carry" },
  { name: "Tidehunter", attr: "Strength", type: "Melee", role: "Tank" },
  { name: "Tiny", attr: "Strength", type: "Melee", role: "Carry/Utility" },
  { name: "Treant Protector", attr: "Strength", type: "Melee", role: "Support" },
  { name: "Underlord", attr: "Strength", type: "Melee", role: "Tank" },
  { name: "Wraith King", attr: "Strength", type: "Melee", role: "Carry" },

  // Agility
  { name: "Anti-Mage", attr: "Agility", type: "Melee", role: "Carry" },
  { name: "Arc Warden", attr: "Agility", type: "Ranged", role: "Carry" },
  { name: "Bloodseeker", attr: "Agility", type: "Melee", role: "Carry" },
  { name: "Bounty Hunter", attr: "Agility", type: "Melee", role: "Support" },
  { name: "Clinkz", attr: "Agility", type: "Ranged", role: "Carry" },
  { name: "Drow Ranger", attr: "Agility", type: "Ranged", role: "Carry" },
  { name: "Ember Spirit", attr: "Agility", type: "Melee", role: "Carry" },
  { name: "Faceless Void", attr: "Agility", type: "Melee", role: "Carry" },
  { name: "Gyrocopter", attr: "Agility", type: "Ranged", role: "Carry" },
  { name: "Juggernaut", attr: "Agility", type: "Melee", role: "Carry" },
  { name: "Luna", attr: "Agility", type: "Ranged", role: "Carry" },
  { name: "Medusa", attr: "Agility", type: "Ranged", role: "Carry" },
  { name: "Meepo", attr: "Agility", type: "Melee", role: "Carry" },
  { name: "Monkey King", attr: "Agility", type: "Melee", role: "Carry" },
  { name: "Morphling", attr: "Agility", type: "Ranged", role: "Carry" },
  { name: "Naga Siren", attr: "Agility", type: "Melee", role: "Carry" },
  { name: "Phantom Assassin", attr: "Agility", type: "Melee", role: "Carry" },
  { name: "Phantom Lancer", attr: "Agility", type: "Melee", role: "Carry" },
  { name: "Riki", attr: "Agility", type: "Melee", role: "Carry" },
  { name: "Shadow Fiend", attr: "Agility", type: "Ranged", role: "Carry" },
  { name: "Slark", attr: "Agility", type: "Melee", role: "Carry" },
  { name: "Sniper", attr: "Agility", type: "Ranged", role: "Carry" },
  { name: "Spectre", attr: "Agility", type: "Melee", role: "Carry" },
  { name: "Templar Assassin", attr: "Agility", type: "Ranged", role: "Carry" },
  { name: "Terrorblade", attr: "Agility", type: "Melee", role: "Carry" },
  { name: "Troll Warlord", attr: "Agility", type: "Ranged", role: "Carry" },
  { name: "Ursa", attr: "Agility", type: "Melee", role: "Carry" },
  { name: "Viper", attr: "Agility", type: "Ranged", role: "Carry" },
  { name: "Weaver", attr: "Agility", type: "Ranged", role: "Carry" },

  // Intelligence
  { name: "Ancient Apparition", attr: "Intelligence", type: "Ranged", role: "Support" },
  { name: "Crystal Maiden", attr: "Intelligence", type: "Ranged", role: "Support" },
  { name: "Death Prophet", attr: "Intelligence", type: "Ranged", role: "Carry" },
  { name: "Disruptor", attr: "Intelligence", type: "Ranged", role: "Support" },
  { name: "Enigma", attr: "Intelligence", type: "Ranged", role: "Utility" },
  { name: "Invoker", attr: "Intelligence", type: "Ranged", role: "Carry/Utility" },
  { name: "Jakiro", attr: "Intelligence", type: "Ranged", role: "Support" },
  { name: "Keeper of the Light", attr: "Intelligence", type: "Ranged", role: "Support" },
  { name: "Leshrac", attr: "Intelligence", type: "Ranged", role: "Carry" },
  { name: "Lich", attr: "Intelligence", type: "Ranged", role: "Support" },
  { name: "Lina", attr: "Intelligence", type: "Ranged", role: "Carry" },
  { name: "Lion", attr: "Intelligence", type: "Ranged", role: "Support" },
  { name: "Nature's Prophet", attr: "Intelligence", type: "Ranged", role: "Carry" },
  { name: "Necrophos", attr: "Intelligence", type: "Ranged", role: "Carry" },
  { name: "Oracle", attr: "Intelligence", type: "Ranged", role: "Support" },
  { name: "Outworld Destroyer", attr: "Intelligence", type: "Ranged", role: "Carry" },
  { name: "Puck", attr: "Intelligence", type: "Ranged", role: "Carry" },
  { name: "Pugna", attr: "Intelligence", type: "Ranged", role: "Utility" },
  { name: "Queen of Pain", attr: "Intelligence", type: "Ranged", role: "Carry" },
  { name: "Rubick", attr: "Intelligence", type: "Ranged", role: "Support" },
  { name: "Shadow Shaman", attr: "Intelligence", type: "Ranged", role: "Support" },
  { name: "Silencer", attr: "Intelligence", type: "Ranged", role: "Support/Carry" },
  { name: "Skywrath Mage", attr: "Intelligence", type: "Ranged", role: "Support" },
  { name: "Storm Spirit", attr: "Intelligence", type: "Ranged", role: "Carry" },
  { name: "Tinker", attr: "Intelligence", type: "Ranged", role: "Carry" },
  { name: "Visage", attr: "Intelligence", type: "Ranged", role: "Utility" },
  { name: "Warlock", attr: "Intelligence", type: "Ranged", role: "Support" },
  { name: "Windranger", attr: "Intelligence", type: "Ranged", role: "Carry" },
  { name: "Witch Doctor", attr: "Intelligence", type: "Ranged", role: "Support" },
  { name: "Zeus", attr: "Intelligence", type: "Ranged", role: "Carry" },

  // Universal
  { name: "Abyssal Horror", attr: "Universal", type: "Melee", role: "Tank" },
  { name: "Bane", attr: "Universal", type: "Ranged", role: "Support" },
  { name: "Batrider", attr: "Universal", type: "Ranged", role: "Utility" },
  { name: "Broodmother", attr: "Universal", type: "Melee", role: "Carry" },
  { name: "Chen", attr: "Universal", type: "Ranged", role: "Support" },
  { name: "Clockwerk", attr: "Universal", type: "Melee", role: "Utility" },
  { name: "Dark Seer", attr: "Universal", type: "Melee", role: "Utility" },
  { name: "Dark Willow", attr: "Universal", type: "Ranged", role: "Support" },
  { name: "Enchantress", attr: "Universal", type: "Ranged", role: "Support" },
  { name: "Io", attr: "Universal", type: "Ranged", role: "Support" },
  { name: "Lone Druid", attr: "Universal", type: "Ranged", role: "Carry" },
  { name: "Lycan", attr: "Universal", type: "Melee", role: "Carry" },
  { name: "Magnus", attr: "Universal", type: "Melee", role: "Utility" },
  { name: "Marci", attr: "Universal", type: "Melee", role: "Support/Carry" },
  { name: "Mirana", attr: "Universal", type: "Ranged", role: "Support" },
  { name: "Nyx Assassin", attr: "Universal", type: "Melee", role: "Support" },
  { name: "Pangolier", attr: "Universal", type: "Melee", role: "Utility" },
  { name: "Phoenix", attr: "Universal", type: "Ranged", role: "Support" },
  { name: "Sand King", attr: "Universal", type: "Melee", role: "Utility" },
  { name: "Snapfire", attr: "Universal", type: "Ranged", role: "Support" },
  { name: "Techies", attr: "Universal", type: "Ranged", role: "Utility" },
  { name: "Vengeful Spirit", attr: "Universal", type: "Ranged", role: "Support" },
  { name: "Venomancer", attr: "Universal", type: "Ranged", role: "Support" },
  { name: "Void Spirit", attr: "Universal", type: "Melee", role: "Carry" },
  { name: "Blade Master", attr: "Universal", type: "Melee", role: "Carry" },
  { name: "Mystic Weaver", attr: "Universal", type: "Ranged", role: "Utility" },
  { name: "Phantom Seraph", attr: "Universal", type: "Ranged", role: "Support" },
  { name: "Solar Saint", attr: "Universal", type: "Ranged", role: "Support" },
  { name: "Grave Warden", attr: "Universal", type: "Melee", role: "Support" },
  { name: "Muerta", attr: "Universal", type: "Ranged", role: "Carry" }
];

export default function HeroesKnowledgePage() {
  const { language } = useGameState();
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [activeAttr, setActiveAttr] = useState<Attribute | 'All'>('All');

  const filteredHeroes = useMemo(() => {
    let list = HEROES_LIST;
    if (search) {
      list = list.filter(h => h.name.toLowerCase().includes(search.toLowerCase()));
    }
    if (activeAttr !== 'All') {
      list = list.filter(h => h.attr === activeAttr);
    }
    return list;
  }, [search, activeAttr]);

  const groupedHeroes = useMemo(() => {
    const groups: Record<Attribute, HeroBase[]> = {
      Strength: [], Agility: [], Intelligence: [], Universal: []
    };
    filteredHeroes.forEach(h => groups[h.attr].push(h));
    return groups;
  }, [filteredHeroes]);

  const t = {
    ru: {
      title: "РЕЕСТР ГЕРОЕВ",
      subtitle: "Список из 128 легендарных юнитов",
      searchPlaceholder: "Поиск героя...",
      all: "Все",
      attr: { Strength: "Сила", Agility: "Ловкость", Intelligence: "Интеллект", Universal: "Универсалы" },
      type: { Melee: "Ближний", Ranged: "Дальний" },
      views: { grid: "Сетка", list: "Список" }
    },
    en: {
      title: "HERO REGISTRY",
      subtitle: "List of 128 legendary units",
      searchPlaceholder: "Find a hero...",
      all: "All",
      attr: { Strength: "Strength", Agility: "Agility", Intelligence: "Intelligence", Universal: "Universal" },
      type: { Melee: "Melee", Ranged: "Ranged" },
      views: { grid: "Grid", list: "List" }
    }
  }[language === 'ru' ? 'ru' : 'en'];

  const getAttrConfig = (attr: Attribute) => {
    switch (attr) {
      case 'Strength': return { color: 'text-red-400', icon: Shield, bg: 'bg-red-500/10' };
      case 'Agility': return { color: 'text-green-400', icon: Zap, bg: 'bg-green-500/10' };
      case 'Intelligence': return { color: 'text-blue-400', icon: Sparkles, bg: 'bg-blue-500/10' };
      case 'Universal': return { color: 'text-purple-400', icon: Layers, bg: 'bg-purple-500/10' };
    }
  };

  const getHeroIconUrl = (attr: Attribute) => {
    const key = attr === 'Strength' ? 'hero-str' : (attr === 'Agility' ? 'hero-agi' : (attr === 'Intelligence' ? 'hero-int' : 'hero-support'));
    const placeholder = PlaceHolderImages.find(img => img.id === key);
    return placeholder?.imageUrl || "https://picsum.photos/seed/hero/200/200";
  };

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-32">
      <header className="mb-8 flex items-center gap-4">
        <Link href="/system">
          <Button variant="ghost" size="icon" className="rounded-full bg-secondary/50 border border-white/5">
            <ChevronLeft className="w-6 h-6" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter text-white leading-none">{t.title}</h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-black opacity-50 mt-1">{t.subtitle}</p>
        </div>
      </header>

      <div className="space-y-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="pl-10 bg-secondary/30 border-white/10 h-12 rounded-xl text-sm"
          />
        </div>

        <div className="flex items-center justify-between gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
          <div className="flex gap-1">
             {(['All', 'Strength', 'Agility', 'Intelligence', 'Universal'] as const).map(attr => (
               <Button 
                key={attr}
                size="sm"
                variant={activeAttr === attr ? "default" : "ghost"}
                className={cn(
                  "h-8 px-3 text-[10px] font-black uppercase rounded-lg border border-transparent transition-all",
                  activeAttr === attr ? "hero-gradient shadow-lg" : "bg-secondary/30 hover:bg-white/5 border-white/5"
                )}
                onClick={() => setActiveAttr(attr)}
               >
                 {attr === 'All' ? t.all : t.attr[attr as Attribute]}
               </Button>
             ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-1 bg-secondary/30 p-1 rounded-xl border border-white/5">
           <Button 
            size="sm"
            variant="ghost"
            className={cn("flex-1 h-8 rounded-lg text-[9px] font-black uppercase gap-2", viewMode === 'grid' ? "bg-white/10 text-primary" : "text-muted-foreground")}
            onClick={() => setViewMode('grid')}
           >
             <LayoutGrid className="w-3.5 h-3.5" /> {t.views.grid}
           </Button>
           <Button 
            size="sm"
            variant="ghost"
            className={cn("flex-1 h-8 rounded-lg text-[9px] font-black uppercase gap-2", viewMode === 'list' ? "bg-white/10 text-primary" : "text-muted-foreground")}
            onClick={() => setViewMode('list')}
           >
             <List className="w-3.5 h-3.5" /> {t.views.list}
           </Button>
        </div>
      </div>

      <div className="space-y-10">
        {(Object.keys(groupedHeroes) as Attribute[]).map(attr => {
          const heroes = groupedHeroes[attr];
          if (heroes.length === 0) return null;
          const config = getAttrConfig(attr);

          return (
            <section key={attr} className="space-y-4 animate-in fade-in duration-500">
              <div className="flex items-center gap-3 px-1 border-l-2 border-primary/20 pl-3">
                <div className={cn("p-1.5 rounded-lg", config.bg)}>
                  <config.icon className={cn("w-4 h-4", config.color)} />
                </div>
                <div>
                  <h2 className="text-sm font-black uppercase text-white tracking-widest">{t.attr[attr]}</h2>
                  <p className="text-[7px] font-black text-muted-foreground uppercase opacity-50">{heroes.length} UNITS DETECTED</p>
                </div>
              </div>

              <div className={cn(
                "gap-2",
                viewMode === 'grid' ? "grid grid-cols-2" : "flex flex-col"
              )}>
                {heroes.map((hero, i) => (
                  <Card key={i} className={cn(
                    "glass-card border-white/5 bg-secondary/10 overflow-hidden group hover:border-primary/30 transition-all",
                    viewMode === 'list' ? "p-1" : ""
                  )}>
                    <CardContent className={cn("p-3", viewMode === 'list' ? "flex items-center gap-4" : "")}>
                      <div className={cn(
                        "rounded-lg overflow-hidden border border-white/10 bg-background shrink-0 shadow-lg",
                        viewMode === 'grid' ? "w-10 h-10 mb-3" : "w-12 h-12"
                      )}>
                         <img 
                          src={getHeroIconUrl(hero.attr)} 
                          alt={hero.name} 
                          className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all" 
                          data-ai-hint="hero portrait"
                        />
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col gap-1">
                        <div className="flex justify-between items-center">
                          <h3 className={cn(
                            "font-bold uppercase text-white truncate leading-none",
                            viewMode === 'grid' ? "text-[10px]" : "text-sm"
                          )}>{hero.name}</h3>
                          {viewMode === 'grid' && (
                            <div className={cn("shrink-0", config.color)}>
                              <config.icon className="w-3 h-3" />
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="outline" className="text-[6px] px-1 border-white/10 opacity-50 h-3 leading-none">{t.type[hero.type]}</Badge>
                          <Badge variant="secondary" className="text-[6px] px-1 bg-primary/10 text-primary border-none h-3 leading-none truncate max-w-[100px]">{hero.role}</Badge>
                        </div>
                      </div>
                      {viewMode === 'list' && (
                        <div className={cn("shrink-0 ml-auto", config.color)}>
                          <config.icon className="w-5 h-5 opacity-30" />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
