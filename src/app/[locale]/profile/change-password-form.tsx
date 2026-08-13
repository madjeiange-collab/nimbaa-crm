'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { changePassword } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function ChangePasswordForm() {
  const t = useTranslations('auth');
  const [isPending, startTransition] = useTransition();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next.length < 8) {
      setMsg({ kind: 'error', text: t('passwordTooShort') });
      return;
    }
    if (next !== confirm) {
      setMsg({ kind: 'error', text: t('passwordMismatch') });
      return;
    }
    startTransition(async () => {
      const res = await changePassword(current, next);
      if (res.ok) {
        setMsg({ kind: 'ok', text: t('passwordChanged') });
        setCurrent('');
        setNext('');
        setConfirm('');
      } else {
        setMsg({ kind: 'error', text: t(res.error as never) });
      }
    });
  }

  return (
    <Card className="max-w-sm">
      <CardHeader>
        <CardTitle className="text-lg">{t('changePassword')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cur">{t('currentPassword')}</Label>
            <Input
              id="cur"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new">{t('newPassword')}</Label>
            <Input
              id="new"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cfm">{t('confirmPassword')}</Label>
            <Input
              id="cfm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>

          {msg && (
            <p
              role="alert"
              className={
                msg.kind === 'ok'
                  ? 'text-sm font-medium text-knock-green'
                  : 'text-sm font-medium text-destructive'
              }
            >
              {msg.text}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? t('signingIn') : t('changePassword')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
