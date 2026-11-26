
export interface Country {
  code: string;
  name: string;
  flag: string;
}

export const COUNTRIES: Country[] = [
  { code: 'RU', name: 'Россия', flag: '🇷🇺' },
  { code: 'US', name: 'США', flag: '🇺🇸' },
  { code: 'CN', name: 'Китай', flag: '🇨🇳' },
  { code: 'KR', name: 'Южная Корея', flag: '🇰🇷' },
  { code: 'KZ', name: 'Казахстан', flag: '🇰🇿' },
  { code: 'BY', name: 'Беларусь', flag: '🇧🇾' },
  { code: 'UA', name: 'Украина', flag: '🇺🇦' },
  { code: 'DE', name: 'Германия', flag: '🇩🇪' },
  { code: 'FR', name: 'Франция', flag: '🇫🇷' },
  { code: 'GB', name: 'Великобритания', flag: '🇬🇧' },
  { code: 'JP', name: 'Япония', flag: '🇯🇵' },
  { code: 'BR', name: 'Бразилия', flag: '🇧🇷' },
  { code: 'ES', name: 'Испания', flag: '🇪🇸' },
  { code: 'IT', name: 'Италия', flag: '🇮🇹' },
  { code: 'TR', name: 'Турция', flag: '🇹🇷' },
  { code: 'CA', name: 'Канада', flag: '🇨🇦' },
];
