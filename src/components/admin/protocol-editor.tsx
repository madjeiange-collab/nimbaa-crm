'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowUp, ArrowDown, Trash2, Plus, Eye, EyeOff, Check, X, Pencil } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import {
  addProtocolStep,
  updateProtocolStep,
  deleteProtocolStep,
  moveProtocolStep,
} from '@/lib/installations/protocol-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

export interface ProtocolStep {
  id: string;
  label: string;
  is_active: boolean;
}

export function ProtocolEditor({ steps }: { steps: ProtocolStep[] }) {
  const t = useTranslations('protocol');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [newLabel, setNewLabel] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

  function run(fn: () => Promise<unknown>) {
    startTransition(async () => {
      await fn();
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>

      <Card>
        <CardContent className="space-y-2 pt-4">
          {steps.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            steps.map((step, i) => (
              <div
                key={step.id}
                className={`flex items-center gap-2 rounded-lg border p-2 ${
                  step.is_active ? '' : 'opacity-50'
                }`}
              >
                {/* Reorder */}
                <div className="flex flex-col">
                  <button
                    type="button"
                    aria-label={t('moveUp')}
                    disabled={isPending || i === 0}
                    onClick={() => run(() => moveProtocolStep(step.id, 'up'))}
                    className="text-muted-foreground disabled:opacity-30"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('moveDown')}
                    disabled={isPending || i === steps.length - 1}
                    onClick={() => run(() => moveProtocolStep(step.id, 'down'))}
                    className="text-muted-foreground disabled:opacity-30"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                </div>

                {/* Label (view / edit) */}
                {editingId === step.id ? (
                  <>
                    <Input
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      autoFocus
                      className="flex-1"
                    />
                    <button
                      type="button"
                      aria-label={t('save')}
                      disabled={isPending}
                      onClick={() =>
                        run(async () => {
                          await updateProtocolStep(step.id, { label: editLabel });
                          setEditingId(null);
                        })
                      }
                      className="text-knock-green"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={t('cancel')}
                      onClick={() => setEditingId(null)}
                      className="text-muted-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm font-medium">{step.label}</span>
                    <button
                      type="button"
                      aria-label={t('rename')}
                      onClick={() => {
                        setEditingId(step.id);
                        setEditLabel(step.label);
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={step.is_active ? t('deactivate') : t('activate')}
                      disabled={isPending}
                      onClick={() =>
                        run(() => updateProtocolStep(step.id, { is_active: !step.is_active }))
                      }
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {step.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      aria-label={t('delete')}
                      disabled={isPending}
                      onClick={() => run(() => deleteProtocolStep(step.id))}
                      className="text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Add a step */}
      <div className="flex gap-2">
        <Input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder={t('newStepPlaceholder')}
          className="flex-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newLabel.trim()) {
              run(async () => {
                await addProtocolStep(newLabel);
                setNewLabel('');
              });
            }
          }}
        />
        <Button
          disabled={isPending || !newLabel.trim()}
          onClick={() =>
            run(async () => {
              await addProtocolStep(newLabel);
              setNewLabel('');
            })
          }
        >
          <Plus className="mr-1 h-4 w-4" />
          {t('add')}
        </Button>
      </div>
    </div>
  );
}
