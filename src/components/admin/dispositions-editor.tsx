'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { saveDispositionSettings } from '@/lib/visits/disposition-actions';
import {
  DISPOSITIONS,
  DISPOSITION_BTN_CLASSES,
  type KnockDisposition,
} from '@/lib/visits/dispositions';
import type { DispositionConfig } from '@/lib/visits/disposition-config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

export function DispositionsEditor({ initial }: { initial: DispositionConfig }) {
  const t = useTranslations('adminDispositions');
  const tDisp = useTranslations('dispositions');
  const tCommon = useTranslations('common');
  const [isPending, startTransition] = useTransition();
  const [rows, setRows] = useState<Record<KnockDisposition, { label: string; active: boolean }>>(
    () =>
      Object.fromEntries(
        DISPOSITIONS.map((d) => [
          d.key,
          { label: initial[d.key]?.label ?? '', active: initial[d.key]?.active !== false },
        ]),
      ) as Record<KnockDisposition, { label: string; active: boolean }>,
  );
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  function patch(key: KnockDisposition, p: Partial<{ label: string; active: boolean }>) {
    setRows((prev) => ({ ...prev, [key]: { ...prev[key], ...p } }));
  }

  function onSave() {
    setMessage(null);
    startTransition(async () => {
      const res = await saveDispositionSettings(rows);
      setMessage(
        res.ok
          ? { kind: 'ok', text: t('saved') }
          : {
              kind: 'error',
              text: res.error === 'atLeastOne' ? t('atLeastOne') : t('error'),
            },
      );
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-4">
        <p className="text-sm text-muted-foreground">{t('hint')}</p>

        <ul className="space-y-2">
          {DISPOSITIONS.map((d) => {
            const row = rows[d.key];
            return (
              <li
                key={d.key}
                className={`rounded-lg border p-3 ${row.active ? '' : 'opacity-50'}`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex h-8 shrink-0 items-center rounded-md px-2.5 text-xs font-semibold ${DISPOSITION_BTN_CLASSES[d.color]}`}
                  >
                    {tDisp(d.key)}
                  </span>
                  <Input
                    value={row.label}
                    onChange={(e) => patch(d.key, { label: e.target.value })}
                    placeholder={t('labelPlaceholder', { name: tDisp(d.key) })}
                    maxLength={40}
                    className="flex-1"
                  />
                  <label className="flex shrink-0 items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={row.active}
                      onChange={(e) => patch(d.key, { active: e.target.checked })}
                    />
                    {t('visible')}
                  </label>
                </div>
                {d.createsContact && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {d.key === 'sold' ? t('behaviourSold') : t('behaviourEngaged')}
                  </p>
                )}
              </li>
            );
          })}
        </ul>

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
