'use client';

import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { FirebaseClientProvider } from "@/firebase/client-provider";
import { GameStateProvider, useGameState } from "@/app/lib/store";
import { TopBar } from "@/components/game/TopBar";
import { BottomNav } from "@/components/game/BottomNav";
import { AutoMatchManager } from "@/components/game/AutoMatchManager";
import { DailyRewardManager } from "@/components/game/DailyRewardManager";
import { GiftGenerationManager } from "@/components/game/GiftGenerationManager";
import { FriendlyMatchListener } from "@/components/game/FriendlyMatchListener";
import { AuthGuard } from "@/components/game/AuthGuard";
import { Suspense } from 'react';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import Script from 'next/script';

function GameInterface({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isLoaded, isDataReady } = useGameState();
  
  const isAuthOrSetup = pathname?.startsWith('/auth') || pathname === '/setup';

  // В локальном режиме нам не нужен Firebase User для старта
  const needsWorldSync = isLoaded && !isAuthOrSetup;

  // Показываем прелоадер только во время первичной инициализации стора
  const showPreloader = !isLoaded || (needsWorldSync && !isDataReady);

  return (
    <>
      {/* Global Background Layer */}
      <div 
        className="fixed inset-0 z-[-1] pointer-events-none bg-[#0a0d14]"
        style={{
          // Even lighter overlay (reduced alpha from 0.1/0.5 to 0.02/0.15)
          backgroundImage: `linear-gradient(to bottom, rgba(10, 13, 20, 0.02), rgba(10, 13, 20, 0.15)), url('https://i.ibb.co/GQ39Zhc9/1787834437641.png')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        }}
      />

      {needsWorldSync && <AutoMatchManager />}
      
      {showPreloader ? (
        <LoadingScreen />
      ) : (
        <>
          {!isAuthOrSetup && isDataReady && <TopBar />}
          {!isAuthOrSetup && isDataReady && (
            <>
              <DailyRewardManager />
              <GiftGenerationManager />
              <FriendlyMatchListener />
            </>
          )}
          
          <Suspense fallback={<LoadingScreen />}>
            <main className={cn(!isAuthOrSetup && isDataReady ? "pt-16 pb-14" : "")}>
              {children}
            </main>
          </Suspense>

          {!isAuthOrSetup && isDataReady && <BottomNav />}
        </>
      )}
    </>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      </head>
      <body className="font-body antialiased min-h-screen text-foreground relative" suppressHydrationWarning>
        <FirebaseClientProvider>
          <GameStateProvider>
            <AuthGuard>
              <GameInterface>
                {children}
              </GameInterface>
              <Toaster />
            </AuthGuard>
          </GameStateProvider>
        </FirebaseClientProvider>
      </body>
    </html>
  );
}
