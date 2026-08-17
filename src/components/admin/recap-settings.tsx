'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { saveRecapSettings } from '@/lib/recap/actions';
import { GenerateRecapButton } from '@/components/leaderboard/generate-recap-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

export function RecapSettings({
  initialHour,
  initialGoal,
}: {
  initialHour: number;
  initialGoal: number;
}) {
  const t = useTranslations('adminRecap');
  const tCommon = useTranslations('common');
  const [hour, setHour] = useState(initialHour);
  const [goal, setGoal] = useState(String(initialGoal));
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  function onSave() {
    setMessage(null);
    startTransition(async () => {
      const res = await saveRecapSettings({ hour, dailyGoal: Number(goal) });
      setMessage(
        res.ok ? { kind: 'ok', text: t('saved') } : { kind: 'error', text: t('error') },
      );
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-4">
        <div className="space-y-1.5">
          <Label htmlFor="recap-hour">{t('sendHour')}</Label>
          <select
            id="recap-hour"
            value={hour}
            onChange={(e) => setHour(Number(e.target.value))}
            className="flex min-h-touch w-full rounded-md border border-input bg-background px-3 text-base"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}h00
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{t('sendHourHint')}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="daily-goal">{t('dailyGoal')}</Label>
          <Input
            id="daily-goal"
            type="number"
            min={1}
            max={200}
            inputMode="numeric"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t('dailyGoalHint')}</p>
        </div>

        {message && (
          <p
            role="alert"
            className={
              message.kind === 'ok'
                ? 'text-sm font-medium text-knock-green'
                : 'text-sm font-medium text-destructive'
            }
          >
            {message.text}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button onClick={onSave} className="flex-1" size="lg" disabled={isPending}>
            {isPending ? tCommon('saving') : tCommon('save')}
          </Button>
          <GenerateRecapButton />
        </div>
      </CardContent>
    </Card>
  );
}
