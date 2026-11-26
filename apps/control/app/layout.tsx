import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Forge-Rivals Control',
  description: 'Private operations console for Forge-Rivals Beta',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body style={{ margin: 0, background: '#090d16', color: '#e8edf7', fontFamily: 'Inter, system-ui, sans-serif' }}>{children}</body></html>;
}
