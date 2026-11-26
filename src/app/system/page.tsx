'use client';

import { useCallback, useEffect, useState } from 'react';
import { useUser } from '@/firebase';
import { useGameState } from '../lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, Settings, Users, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import Link from 'next/link';

type SystemStatus = {
  success: boolean;
  network?: 'online' | 'offline';
  totalPlayers?: number;
  onlinePlayers?: number;
  updatedAt?: string;
};

export default function SystemPage() {
  const { language } = useGameState();
  const { user } = useUser();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const isRu = language === 'ru';
  const loadStatus = useCallback(async () => {
    if (!user) {
      setStatus({ success: false, network: 'offline' });
      setLoading(false);
      return;
    }

    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/system/status', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok || payload.success !== true) throw new Error('SYSTEM_STATUS_UNAVAILABLE');
      setStatus(payload as SystemStatus);
    } catch {
      setStatus({ success: false, network: 'offline' });
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadStatus();
    const interval = window.setInterval(() => void loadStatus(), 60_000);
    return () => window.clearInterval(interval);
  }, [loadStatus]);

  const networkOnline = status?.network === 'online' && status.success === true;

  return (
    <div className="max-w-md mx-auto px-4 pt-8 pb-32">
      <header className="mb-8 flex items-center gap-4">
        <Link href="/">
          <Button variant="ghost" size="icon" className="rounded-full bg-secondary/50 border border-white/5">
            <ChevronLeft className="w-6 h-6" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-headline font-bold uppercase tracking-tighter text-white flex items-center gap-2">
            <Settings className="w-6 h-6 text-primary" />
            {isRu ? 'СИСТЕМА' : 'SYSTEM'}
          </h1>
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-black opacity-50">
            {isRu ? 'Состояние игрового сервера' : 'Game server status'}
          </p>
        </div>
      </header>

      <div className="space-y-3">
        <Card className="glass-card border-white/5 bg-secondary/10">
          <CardContent className="p-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {networkOnline
                ? <Wifi className="w-6 h-6 text-green-400" />
                : <WifiOff className="w-6 h-6 text-red-400" />}
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  {isRu ? 'Статус сети' : 'Network status'}
                </p>
                <p className="text-sm font-bold text-white">
                  {loading
                    ? (isRu ? 'Проверка...' : 'Checking...')
                    : networkOnline
                      ? (isRu ? 'СЕРВЕР ДОСТУПЕН' : 'SERVER ONLINE')
                      : (isRu ? 'НЕТ СОЕДИНЕНИЯ' : 'CONNECTION OFFLINE')}
                </p>
              </div>
            </div>
            <Badge variant={networkOnline ? 'default' : 'destructive'}>
              {loading ? '…' : networkOnline ? 'ONLINE' : 'OFFLINE'}
            </Badge>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Card className="glass-card border-white/5 bg-secondary/10">
            <CardContent className="p-4 text-center">
              <Users className="w-5 h-5 text-primary mx-auto mb-2" />
              <p className="text-[9px] font-black text-muted-foreground uppercase tracking-wider">
                {isRu ? 'Всего игроков' : 'Total players'}
              </p>
              <p className="text-2xl font-headline font-bold text-white">
                {loading || !status?.success ? '—' : (status.totalPlayers ?? 0).toLocaleString(isRu ? 'ru-RU' : 'en-US')}
              </p>
            </CardContent>
          </Card>

          <Card className="glass-card border-white/5 bg-secondary/10">
            <CardContent className="p-4 text-center">
              <Wifi className="w-5 h-5 text-green-400 mx-auto mb-2" />
              <p className="text-[9px] font-black text-muted-foreground uppercase tracking-wider">
                {isRu ? 'Сейчас в сети' : 'Online now'}
              </p>
              <p className="text-2xl font-headline font-bold text-white">
                {loading || !status?.success ? '—' : (status.onlinePlayers ?? 0).toLocaleString(isRu ? 'ru-RU' : 'en-US')}
              </p>
              <p className="text-[8px] text-muted-foreground mt-1">
                {isRu ? 'Активность за 2 минуты' : 'Active in the last 2 minutes'}
              </p>
            </CardContent>
          </Card>
        </div>

        <Button
          variant="outline"
          className="w-full"
          onClick={() => { setLoading(true); void loadStatus(); }}
          disabled={loading}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          {isRu ? 'Обновить статус' : 'Refresh status'}
        </Button>

        {status?.updatedAt && (
          <p className="text-center text-[9px] text-muted-foreground">
            {isRu ? 'Обновлено: ' : 'Updated: '}
            {new Date(status.updatedAt).toLocaleTimeString(isRu ? 'ru-RU' : 'en-US')}
          </p>
        )}
      </div>
    </div>
  );
}
