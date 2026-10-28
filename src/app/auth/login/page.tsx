'use client';

import { useMemo, useState, Suspense } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { useAppRouter as useRouter, useAppBasePath } from '@/components/app-base-path';
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { ArrowRight, Loader2 } from "lucide-react";
import Link from '@/components/app-link';
import { BrandMark } from '@/components/auth/brand-mark';
import { useTranslations } from 'next-intl';
import { LanguageSwitcher } from '@/components/language-switcher';
import { apiUrl } from '@/lib/api-url';
import { withBasePath } from '@/lib/base-path';
import { useBranding } from '@/components/branding-provider';

type LoginValues = { email: string; password: string };

function LoginForm() {
  const t = useTranslations('auth');
  const brand = useBranding();
  const formSchema = useMemo(() => z.object({
    email: z.string().email(t('invalidEmail')),
    password: z.string().min(1, t('login.passwordRequired')),
  }), [t]);
  const router = useRouter();
  const basePath = useAppBasePath();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard';
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState("");

  const form = useForm<LoginValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  async function onSubmit(values: LoginValues) {
    setLoading(true);
    setError(null);
    try {
      const result = await signIn('credentials', {
        redirect: false,
        email: values.email,
        password: values.password,
      });

      if (result?.error) {
        setError(t('login.invalidCredentials'));
      } else {
        window.location.href = withBasePath(callbackUrl, basePath);
        router.refresh();
      }
    } catch {
      setError(t('unexpectedError'));
    } finally {
      setLoading(false);
    }
  }

  async function resendVerification() {
    const email = form.getValues("email");
    if (!z.string().email().safeParse(email).success) {
      setResendMessage(t('verify.enterEmail'));
      return;
    }
    setResending(true);
    setResendMessage("");
    try {
      const response = await fetch(apiUrl('/api/auth/resend-verification'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
      });
      await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(t('verify.resendFailed'));
      setResendMessage(t('verify.resendSent'));
    } catch (err) {
      setResendMessage(err instanceof Error ? err.message : t('verify.resendFailed'));
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen relative overflow-hidden bg-background">
      <div className="absolute top-4 right-4 z-20">
        <LanguageSwitcher />
      </div>
      {/* Background Orbs */}
      <div className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 w-[40rem] h-[40rem] bg-primary/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 translate-x-1/3 translate-y-1/3 w-[30rem] h-[30rem] bg-blue-500/20 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative z-10 w-full max-w-md p-4 animate-in fade-in zoom-in-95 duration-500">
        <div className="flex flex-col items-center mb-8">
          <BrandMark className="mb-4" />
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{t('login.title')}</h1>
          <p className="text-muted-foreground mt-2">{t('login.subtitle', { appName: brand.name })}</p>
        </div>

        <div className="glass-panel rounded-3xl p-8 shadow-2xl shadow-black/5 dark:shadow-black/40">
          {error && (
            <div role="alert" aria-live="assertive" className="mb-6 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-center text-sm font-medium text-destructive animate-in shake duration-300 motion-reduce:animate-none">
              {error}
            </div>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" aria-busy={loading}>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground/80">{t('email')}</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        autoComplete="email"
                        autoFocus
                        placeholder={t('emailPlaceholder')}
                        className="h-12 px-4 rounded-xl bg-background/50 border-white/20 dark:border-white/10 focus-visible:ring-primary/50 transition-all font-medium"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground/80">{t('password')}</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="current-password"
                        placeholder="••••••••"
                        className="h-12 px-4 rounded-xl bg-background/50 border-white/20 dark:border-white/10 focus-visible:ring-primary/50 transition-all font-medium"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                size="lg"
                className="w-full h-12 rounded-xl text-base shadow-lg shadow-primary/20 hover:shadow-primary/30 mt-2"
                disabled={loading}
              >
                {loading ? (
                  <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> {t('login.submitting')}</>
                ) : (
                  <>{t('login.submit')} <ArrowRight className="ml-2 h-5 w-5" /></>
                )}
              </Button>
            </form>
          </Form>
          <div className="mt-5 border-t pt-4 text-center">
            <button type="button" onClick={resendVerification} disabled={resending} className="text-sm text-primary underline disabled:opacity-50">
              {resending ? t('verify.resending') : t('verify.resend')}
            </button>
            {resendMessage && <p role="status" aria-live="polite" className="mt-2 text-xs text-muted-foreground">{resendMessage}</p>}
          </div>
        </div>

        <div className="mt-8 text-center text-sm text-muted-foreground">
          {t('login.noAccount')}{" "}
          <Link href="/auth/register" className="font-semibold text-primary hover:text-primary/80 transition-colors">
            {t('login.createAccount')}
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-background" role="status" aria-label="Carregando">
        <Loader2 className="h-8 w-8 animate-spin text-primary motion-reduce:animate-none" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
