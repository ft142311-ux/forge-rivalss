'use client';

import { useEffect, useRef } from 'react';
import { useAuth, useUser } from '@/firebase';
import { syncTelegramUser } from '@/firebase/telegram-auth';
import { useToast } from '@/hooks/use-toast';

export function TelegramSyncHandler() {
  const auth = useAuth();
  const { user, isUserLoading } = useUser();
  const { toast } = useToast();
  const syncStartedRef = useRef(false);

  useEffect(() => {
    if (!auth || isUserLoading || syncStartedRef.current) return;

    const tg = (window as any).Telegram?.WebApp;
    const tgUser = tg?.initDataUnsafe?.user;

    // We only auto-enter through Telegram when there is no active user.
    // This also lets the handler restore the session after the auction action
    // signs out a revoked Firebase session.
    if (user || !tgUser?.id) return;

    syncStartedRef.current = true;

    const handleSync = async () => {
      try {
        tg.expand?.();
        tg.ready?.();

        await syncTelegramUser(auth, tgUser);
      } catch (error) {
        console.error('[TELEGRAM AUTH] Auto-Sync Error:', error);
        syncStartedRef.current = false;
        toast({
          title: 'Ошибка авторизации',
          description: 'Не удалось восстановить Telegram-сессию.',
          variant: 'destructive',
        });
      }
    };

    void handleSync();
  }, [auth, user, isUserLoading, toast]);

  return null;
}
