'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowRight, Shield, KeyRound, Mail } from 'lucide-react';
import { useGameState } from '@/app/lib/store';
import { useAuth, initiateEmailSignUp } from '@/firebase';
import { LoadingScreen } from '@/components/game/LoadingScreen';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  const router = useRouter();
  const { toast } = useToast();
  const { language, isLoaded } = useGameState();
  const auth = useAuth();

  const t = {
    en: {
      title: "Initialize Profile",
      subtitle: "Define your tactical identity and access key",
      callsign: "Login / Team Name",
      passLabel: "Access Key",
      emailLabel: "Operational Email",
      submitBtn: "ESTABLISH COMMAND LINK",
      alreadyRegistered: "Already registered?",
      loginLink: "Login",
      errorShort: "Team name too short (min 3)",
      errorPass: "Password too simple (min 6)",
      errorEmail: "Invalid email format",
      success: "Command link established"
    },
    ru: {
      title: "Инициация профиля",
      subtitle: "Определите тактический позывной и ключ доступа",
      callsign: "Логин / название команды",
      passLabel: "Ключ доступа",
      emailLabel: "Ваш Email",
      submitBtn: "УСТАНОВИТЬ СВЯЗЬ",
      alreadyRegistered: "Уже зарегистрированы?",
      loginLink: "Войти",
      errorShort: "Название слишком короткое (мин. 3)",
      errorPass: "Пароль слишком простой (мин. 6)",
      errorEmail: "Неверный формат почты",
      success: "Связь со штабом установлена"
    }
  }[language as 'en' | 'ru'] || { title: "Register", subtitle: "Join" };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth || isProcessing) return;

    if (username.trim().length < 3) {
      toast({ variant: "destructive", title: t.errorShort });
      return;
    }

    setIsProcessing(true);
    try {
      await initiateEmailSignUp(auth, email, password);
      localStorage.setItem('pending_club_name', username);
      
      toast({ title: t.success });
      router.push('/setup');
    } catch (error: any) {
      setIsProcessing(false);
      let errorMsg = error.message;
      
      if (error.code === 'auth/email-already-in-use') {
        errorMsg = language === 'ru' ? "Этот Email уже используется" : "Email already in use";
      } else if (error.code === 'auth/weak-password') {
        errorMsg = language === 'ru' ? "Пароль слишком простой" : "Password too weak";
      } else if (error.code === 'auth/invalid-email') {
        errorMsg = language === 'ru' ? "Некорректный Email" : "Invalid email";
      }

      toast({ 
        variant: "destructive", 
        title: "Registration Failed", 
        description: errorMsg
      });
    }
  };

  if (!isLoaded) return <LoadingScreen />;

  return (
    <Card className="glass-card w-full max-w-sm border-primary/20 shadow-[0_0_40px_rgba(var(--primary),0.1)] overflow-hidden">
      <CardHeader className="pt-8">
        <CardTitle className="font-headline text-center uppercase tracking-[0.2em] text-primary text-xl">
          {t.title}
        </CardTitle>
        <p className="text-[10px] text-center text-muted-foreground uppercase font-black tracking-widest mt-2 px-4 leading-relaxed">
          {t.subtitle}
        </p>
      </CardHeader>
      
      <CardContent className="px-8">
        <form onSubmit={handleRegister} className="space-y-5 animate-in fade-in duration-500">
          <div className="space-y-2">
            <Label className="text-[10px] font-black uppercase text-muted-foreground ml-1 tracking-widest flex items-center gap-2">
              <Shield className="w-3 h-3" /> {t.callsign}
            </Label>
            <Input 
              value={username} 
              onChange={e => setUsername(e.target.value)} 
              required 
              className="bg-secondary/40 border-white/5 h-12 text-sm font-bold uppercase tracking-tight focus-visible:ring-primary" 
              placeholder="FORGE_TEAM"
              disabled={isProcessing}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[10px] font-black uppercase text-muted-foreground ml-1 tracking-widest flex items-center gap-2">
              <Mail className="w-3 h-3" /> {t.emailLabel}
            </Label>
            <Input 
              type="email"
              value={email} 
              onChange={e => setEmail(e.target.value)} 
              required 
              className="bg-secondary/40 border-white/5 h-12 text-sm font-bold" 
              placeholder="commander@hq.net"
              disabled={isProcessing}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[10px] font-black uppercase text-muted-foreground ml-1 tracking-widest flex items-center gap-2">
              <KeyRound className="w-3 h-3" /> {t.passLabel}
            </Label>
            <Input 
              type="password" 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              required 
              className="bg-secondary/40 border-white/5 h-12 text-sm focus-visible:ring-primary" 
              placeholder="••••••••"
              disabled={isProcessing}
            />
          </div>
          <Button type="submit" className="w-full h-14 hero-gradient font-black text-xs tracking-widest shadow-xl uppercase mt-4" disabled={isProcessing}>
            {isProcessing ? <Loader2 className="animate-spin" /> : <>{t.submitBtn} <ArrowRight className="ml-2 w-4 h-4" /></>}
          </Button>
        </form>
      </CardContent>

      <CardFooter className="flex flex-col gap-4 border-t border-white/5 pt-6 pb-8 px-8 bg-secondary/10">
        <p className="text-[10px] text-center text-muted-foreground font-bold uppercase tracking-widest">
          {t.alreadyRegistered} <Link href="/auth/login" className="text-primary hover:text-accent transition-colors underline-offset-4 underline">{t.loginLink}</Link>
        </p>
      </CardFooter>
    </Card>
  );
}
