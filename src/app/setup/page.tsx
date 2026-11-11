'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Loader2, Rocket, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useGameState } from '@/app/lib/store';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { useUser, useFirebase } from '@/firebase';

/**
 * СТРАНИЦА ИНИЦИАЛИЗАЦИИ v166.
 * После успешной регистрации ждёт фактическую синхронизацию players_v14 вместо
 * безусловного router.replace('/'), чтобы не попадать в бесконечный preloader.
 * Вызывает защищённый Next.js API endpoint регистрации клуба.
 * Сервер проверяет Firebase ID Token и выполняет атомарную транзакцию Firestore.
 */
export default function SetupPage() {
  const router = useRouter();
  const { user, isUserLoading } = useUser();
  const { firebaseApp } = useFirebase();
  const { toast } = useToast();
  const { language, isLoaded, isTeamLoaded, isInitialSyncDone } = useGameState();
  
  const [isUpdating, setIsUpdating] = useState(false);
  const [step, setStep] = useState<'IDLE' | 'PROVISIONING' | 'SUCCESS'>('IDLE');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isInitialSyncDone && isTeamLoaded) {
      console.log('[AUTH HANDOFF] players_v14 loaded; redirecting to /', { uid: user?.uid });
      router.replace('/');
    }
  }, [isInitialSyncDone, isTeamLoaded, router, user?.uid]);

  useEffect(() => {
    if (step !== 'SUCCESS' || isTeamLoaded) return;
    const timer = window.setTimeout(() => {
      console.error('[AUTH HANDOFF] players_v14 snapshot timeout after registration', {
        uid: user?.uid,
        isInitialSyncDone,
        isTeamLoaded
      });
      setError('PLAYER_SYNC_TIMEOUT');
      setStep('IDLE');
      setIsUpdating(false);
    }, 12000);
    return () => window.clearTimeout(timer);
  }, [step, isTeamLoaded, isInitialSyncDone, user?.uid]);

  const handleCompleteSetup = async () => {
    if (isUpdating || !user || !firebaseApp) return;
    
    setIsUpdating(true);
    setStep('PROVISIONING');
    setError(null);
    
    try {
      // Hosted and local registration now use the same authenticated
      // Next.js endpoint. The legacy callable remains available only to the
      // local emulator during the migration window.
      let idToken: string;
      try {
        idToken = await user.getIdToken(true);
      } catch (refreshError: any) {
        const useLocalEmulators = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === 'true';
        if (useLocalEmulators) {
          console.warn('[SETUP] Forced token refresh failed in emulator mode; retrying with cached token:', refreshError);
          idToken = await user.getIdToken();
        } else {
          throw refreshError;
        }
      }

      const clubName = localStorage.getItem('pending_club_name') || '';
      const response = await fetch('/api/registration/initialize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        cache: 'no-store',
        body: JSON.stringify({ clubName }),
      });

      const result = await response.json();
      if (!response.ok || !result?.success) {
        throw new Error(typeof result?.error === 'string' ? result.error : 'CLUB_INITIALIZATION_FAILED');
      }
      console.log("[SETUP] Server response:", result);

      // Проверка версии серверного registration endpoint
      if (result.version !== 'v170') {
        console.error("[SETUP] Outdated function version detected:", result.version);
        throw new Error("REGISTRATION_FUNCTION_OUTDATED");
      }

      if (!result.success) {
        throw new Error(result.error || "REGISTRATION_FAILED");
      }

      setStep('SUCCESS');
      localStorage.removeItem('pending_club_name');
      console.log('[AUTH HANDOFF] initializeClub success; waiting for players_v14 snapshot', { uid: user.uid });
      toast({ title: language === 'ru' ? "Штаб развернут!" : "HQ Fully Operational!" });
      // Не уходим на '/' по таймеру. AuthGuard должен увидеть isTeamLoaded=true
      // после реального snapshot players_v14 и сам выполнит переход.

    } catch (e: any) {
      const originalCode = e?.details?.originalErrorCode || e?.code;
      const originalMessage = e?.details?.originalErrorMessage || e?.message;
      const originalName = e?.details?.originalErrorName || e?.name;

      console.error("[SETUP ERROR DETAILS]", {
        code: e.code,
        message: e.message,
        details: e.details,
        name: e.name,
        stack: e.stack,
        originalCode,
        originalMessage,
        originalName
      });
      
      let errorMsg = "CLUB_INITIALIZATION_FAILED";
      const msg = e.message || "";
      const details = e.details || {};

      // Анализ диагностических сообщений от HttpsError
      if (msg.includes('SEASON_CONFIG_MISSING')) errorMsg = "SEASON_CONFIG_MISSING";
      else if (msg.includes('WORLD_INITIALIZING')) errorMsg = "WORLD_INITIALIZING";
      else if (msg.includes('WORLD_NOT_READY')) errorMsg = "WORLD_NOT_READY";
      else if (msg.includes('AUTH_TOKEN_REVOKED')) errorMsg = "AUTH_TOKEN_REVOKED";
      else if (msg.includes('AUTH_TOKEN_INVALID')) errorMsg = "AUTH_TOKEN_INVALID";
      else if (msg.includes('APP_CHECK_REQUIRED') || msg.includes('APP_CHECK_INVALID')) errorMsg = msg;
      else if (msg.includes('SEASON_TRANSITION_IN_PROGRESS')) errorMsg = "SEASON_TRANSITION_IN_PROGRESS";
      else if (msg.includes('LEAGUE_TABLE_MISSING')) errorMsg = "LEAGUE_TABLE_MISSING";
      else if (msg.includes('LEAGUE_TABLE_MISMATCH')) errorMsg = "LEAGUE_TABLE_MISMATCH";
      else if (msg.includes('BOT_NOT_FOUND_IN_SLOT')) errorMsg = "BOT_NOT_FOUND_IN_SLOT";
      else if (msg.includes('INVALID_LEAGUE_SLOT')) errorMsg = "INVALID_LEAGUE_SLOT";
      else if (msg.includes('NO_FREE_SLOTS_IN_LEAGUE') || originalMessage?.includes('NO_FREE_SLOTS_IN_LEAGUE')) errorMsg = "NO_FREE_SLOTS_IN_LEAGUE";
      else if (msg.includes('REGISTRATION_FUNCTION_OUTDATED')) errorMsg = "REGISTRATION_FUNCTION_OUTDATED";
      else if (msg.includes('AUTHENTICATION_REQUIRED') || e.code === 'functions/unauthenticated') errorMsg = "AUTHENTICATION_REQUIRED";
      else if (msg.includes('EMAIL_REQUIRED')) errorMsg = "EMAIL_REQUIRED";
      else if (details?.originalErrorCode) errorMsg = `${details.originalErrorCode}`;
      else if (originalCode) errorMsg = `${originalCode}`;
      
      setError(errorMsg);
      setIsUpdating(false);
      setStep('IDLE');
      
      toast({ 
        variant: "destructive", 
        title: language === 'ru' ? "Ошибка инициализации" : "Initialization Error",
        description: errorMsg
      });
    }
  };

  if (!isLoaded || isUserLoading) return <LoadingScreen />;

  const t = {
    ru: {
      title: 'РАЗВЕРТЫВАНИЕ БАЗЫ',
      subtitle: 'Подготовка систем и личного состава',
      finalize: 'ПОЛУЧИТЬ ДОПУСК',
      desc: 'Ваш профиль создается на сервере. Вы получите стартовый состав и место в Дивизионе 4.',
      loading: 'Идет синхронизация с лигой...',
      success: 'ДОСТУП РАЗРЕШЕН'
    },
    en: {
      title: 'BASE DEPLOYMENT',
      subtitle: 'Provisioning systems and personnel',
      finalize: 'AUTHORIZE ACCESS',
      desc: 'Your profile is being created on the server. You will receive a starting squad and a slot in Division 4.',
      loading: 'Syncing with league server...',
      success: 'ACCESS AUTHORIZED'
    }
  }[language === 'ru' ? 'ru' : 'en'];

  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none opacity-20 bg-[radial-gradient(circle_at_50%_50%,_hsl(var(--primary)/0.15),_transparent_70%)]" />
      <div className="relative z-10 w-full max-w-md mx-auto px-4 flex flex-col min-h-screen justify-center">
        
        <div className="text-center space-y-8 animate-in fade-in zoom-in duration-700">
          <div className="relative mx-auto w-32 h-32">
             <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full animate-pulse" />
             <div className="relative w-full h-full bg-secondary/30 rounded-3xl border-2 border-primary/50 flex items-center justify-center overflow-hidden">
                {step === 'SUCCESS' ? (
                  <CheckCircle2 className="w-16 h-16 text-green-400 animate-in zoom-in" />
                ) : step === 'PROVISIONING' ? (
                  <Loader2 className="w-16 h-16 text-primary animate-spin" />
                ) : (
                  <Rocket className="w-16 h-16 text-primary" />
                )}
             </div>
          </div>

          <div className="space-y-2">
            <h1 className="text-3xl font-headline font-bold text-white uppercase tracking-tighter">
              {step === 'SUCCESS' ? t.success : t.title}
            </h1>
            <p className="text-muted-foreground text-xs uppercase tracking-widest font-black opacity-80">{t.subtitle}</p>
          </div>

          <Card className="glass-card border-white/5 bg-secondary/10 mx-4">
            <CardContent className="p-6">
               {step === 'PROVISIONING' ? (
                 <div className="space-y-4">
                   <p className="text-[10px] text-primary font-black uppercase animate-pulse">{t.loading}</p>
                   <Progress value={66} className="h-1" />
                 </div>
               ) : (
                 <p className="text-[10px] text-muted-foreground leading-relaxed italic uppercase font-bold">"{t.desc}"</p>
               )}
               {error && (
                 <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-3 text-red-400">
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    <span className="text-[10px] font-black uppercase">{error}</span>
                 </div>
               )}
            </CardContent>
          </Card>

          {step === 'IDLE' && (
            <Button 
              disabled={isUpdating} 
              onClick={handleCompleteSetup}
              className="w-full max-w-[280px] h-16 hero-gradient font-black text-sm tracking-[0.2em] uppercase shadow-2xl mx-auto"
            >
              {t.finalize}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
