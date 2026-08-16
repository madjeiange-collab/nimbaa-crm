'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, Plus, Trash2 } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import {
  addStage,
  renameStage,
  reorderStages,
  setStageActive,
  deleteStage,
} from '@/lib/stages/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

export interface StageRow {
  id: string;
  name: string;
  sort_order: number;
  is_won: boolean;
  is_lost: boolean;
  is_active: boolean;
  system_key: string | null;
}

export function StagesEditor({ initial }: { initial: StageRow[] }) {
  const t = useTranslations('adminStages');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [stages, setStages] = useState<StageRow[]>(initial);
  const [names, setNames] = useState<Record<string, string>>(
    Object.fromEntries(initial.map((s) => [s.id, s.name])),
  );
  const [newName, setNewName] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, refresh = true) {
    setMessage(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        const key =
          res.error === 'stageInUse'
            ? 'stageInUse'
            : res.error === 'systemStage'
              ? 'systemStage'
              : 'error';
        setMessage({ kind: 'error', text: t(key as never) });
      }
      if (refresh) router.refresh();
    });
  }

  function move(index: number, dir: -1 | 1) {
    const next = [...stages];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    setStages(next);
    run(() => reorderStages(next.map((s) => s.id)), false);
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-4">
        <p className="text-sm text-muted-foreground">{t('hint')}</p>

        <ul className="space-y-2">
          {stages.map((s, i) => (
            <li
              key={s.id}
              className={`rounded-lg border p-2.5 ${s.is_active ? '' : 'opacity-50'}`}
            >
              <div className="flex items-center gap-2">
                <div className="flex shrink-0 flex-col">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={isPending || i === 0}
                    aria-label={t('moveUp')}
                    className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={isPending || i === stages.length - 1}
                    aria-label={t('moveDown')}
                    className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                </div>

                <Input
                  value={names[s.id] ?? s.name}
                  onChange={(e) => setNames((p) => ({ ...p, [s.id]: e.target.value }))}
                  onBlur={() => {
                    const v = (names[s.id] ?? '').trim();
                    if (v && v !== s.name) run(() => renameStage(s.id, v));
                  }}
                  className="flex-1"
                />

                {s.system_key && (
                  <span
                    title={t('systemHint')}
                    className="inline-flex shrink-0 items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                  >
                    <Lock className="h-3 w-3" />
                    {t(`role_${s.system_key}` as never)}
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => run(() => setStageActive(s.id, !s.is_active))}
                  disabled={isPending || !!s.system_key}
                  aria-label={s.is_active ? t('deactivate') : t('activate')}
                  className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
                >
                  {s.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(t('deleteConfirm', { name: s.name }))) {
                      run(() => deleteStage(s.id));
                    }
                  }}
                  disabled={isPending || !!s.system_key}
                  aria-label={tCommon('delete')}
                  className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>

        {/* Add a stage */}
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('addPlaceholder')}
            maxLength={60}
          />
          <Button
            type="button"
            onClick={() => {
              if (!newName.trim()) return;
              run(() => addStage(newName));
              setNewName('');
            }}
            disabled={isPending || !newName.trim()}
          >
            <Plus className="mr-1 h-4 w-4" />
            {t('add')}
          </Button>
        </div>

        {message && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {message.text}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
