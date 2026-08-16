'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { saveLeaderboardPoints } from '@/lib/leaderboard/actions';
import type { PointConfig } from '@/lib/leaderboard/score';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

const FIELDS: { key: keyof PointConfig; i18n: string }[] = [
  { key: 'visit', i18n: 'visit' },
  { key: 'interested', i18n: 'interested' },
  { key: 'appointment', i18n: 'appointment' },
  { key: 'deal_won', i18n: 'dealWon' },
  { key: 'install_done', i18n: 'installDone' },
  { key: 'revisit', i18n: 'revisit' },
];

export function PointsEditor({ initial }: { initial: PointConfig }) {
  const t = useTranslations('adminPoints');
  const tCommon = useTranslations('common');
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(FIELDS.map((f) => [f.key, String(initial[f.key])])),
  );
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  function onSave() {
    setMessage(null);
    startTransition(async () => {
      const input = Object.fromEntries(
        FIELDS.map((f) => [f.key, Number(values[f.key])]),
      ) as Partial<PointConfig>;
      const res = await saveLeaderboardPoints(input);
      setMessage(
        res.ok
          ? { kind: 'ok', text: t('saved') }
          : { kind: 'error', text: t('error') },
      );
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-4">
        <p className="text-sm text-muted-foreground">{t('hint')}</p>
        <div className="grid grid-cols-2 gap-4">
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={`pt-${f.key}`}>{t(f.i18n as never)}</Label>
              <Input
                id={`pt-${f.key}`}
                type="number"
                min={0}
                max={1000}
                inputMode="numeric"
                value={values[f.key]}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                }
              />
            </div>
          ))}
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
        <Button onClick={onSave} className="w-full" size="lg" disabled={isPending}>
          {isPending ? tCommon('saving') : tCommon('save')}
        </Button>
      </CardContent>
    </Card>
  );
}
