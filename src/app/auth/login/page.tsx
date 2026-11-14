'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowRight, ShieldCheck, Mail } from 'lucide-react';
import { useGameState } from '@/app/lib/store';
import { cn } from '@/lib/utils';
import { LoadingScreen } from '@/components/game/LoadingScreen';
import { useAuth, useUser, initiateEmailSignIn } from '@/firebase';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  const router = useRouter();
  const { toast } = useToast();
  const { language, isLoaded: storeIsLoaded } = useGameState();
  const { user, isUserLoading } = useUser();
  const auth = useAuth();

  const translations = {
    en: {
      title: "Global Access",
      navLogin: "Login",
      navRegister: "Register",
      emailLabel: "Registered Email",
      passLabel: "Access Key",
      submitBtn: "ESTABLISH LINK",
      welcomeBack: "Command Link Active",
      enterHub: "ENTER COMMAND CENTER",
      error: "Access Denied: Invalid credentials"
    },
    ru: {
      title: "Глобальный доступ",
      navLogin: "Вход",
      navRegister: "Регистрация",
      emailLabel: "Ваш Email",
      passLabel: "Ключ доступа",
      submitBtn: "УСТАНОВИТЬ СВЯЗЬ",
      welcomeBack: "Связь со штабом активна",
      enterHub: "ВОЙТИ В КОМАНДНЫЙ ЦЕНТР",
      error: "Доступ отклонен: Неверные данные"
    }
  };

  const t = translations[language as keyof typeof translations] || translations.ru;

  useEffect(() => {
    if (user && !isUserLoading) {
      router.push('/');
    }
  }, [user, isUserLoading, router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth) return;

    if (!email.trim() || password.length < 6) return;

    setIsProcessing(true);
    try {
      await initiateEmailSignIn(auth, email.trim(), password);
    } catch (error: any) {
      toast({ variant: "destructive", title: t.error });
    } finally {
      setIsProcessing(false);
    }
  };

  if (!storeIsLoaded || isUserLoading) return <LoadingScreen />;

  if (user) {
    return (
      <div className="space-y-4 animate-in fade-in zoom-in duration-500">
        <Card className="glass-card border-primary/20 bg-primary/5">
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-secondary/50 flex items-center justify-center mb-4 border-2 border-primary shadow-[0_0_20px_rgba(var(--primary),0.3)]">
              <ShieldCheck className="w-8 h-8 text-primary" />
            </div>
            <CardTitle className="font-headline uppercase tracking-widest text-white text-lg">{t.welcomeBack}</CardTitle>
            <p className="text-[10px] text-muted-foreground uppercase font-bold mt-2">ID: {user.uid.slice(0, 12)}...</p>
          </CardHeader>
          <CardFooter>
            <Button onClick={() => router.push('/')} className="w-full h-14 hero-gradient font-black text-xs tracking-widest">
              {t.enterHub} <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-center gap-2 mb-4 bg-secondary/20 p-1 rounded-lg border border-white/5">
        <Button variant="ghost" size="sm" className={cn("flex-1 text-xs font-bold h-8 uppercase tracking-widest", "bg-white/10 text-primary")} onClick={() => router.push('/auth/login')}>
          {t.navLogin}
        </Button>
        <Button variant="ghost" size="sm" className={cn("flex-1 text-xs font-bold h-8 uppercase tracking-widest text-muted-foreground")} onClick={() => router.push('/auth/register')}>
          {t.navRegister}
        </Button>
      </div>

      <Card className="glass-card">
        <form onSubmit={handleLogin}>
          <CardHeader>
            <CardTitle className="font-headline text-center uppercase tracking-widest text-accent text-lg">{t.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t.emailLabel}</Label>
              <Input 
                id="email" 
                type="email"
                placeholder="commander@gmail.com" 
                value={email} 
                onChange={(e) => setEmail(e.target.value)} 
                required 
                className="bg-secondary/50" 
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t.passLabel}</Label>
              <Input 
                id="password" 
                type="password" 
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                required 
                className="bg-secondary/50" 
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full hero-gradient font-bold h-12" disabled={isProcessing}>
              {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : t.submitBtn}
            </Button>
            <p className="text-xs text-center text-muted-foreground mt-2">
              New manager? <Link href="/auth/register" className="text-primary hover:underline font-bold">Initialize command link</Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
