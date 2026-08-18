'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarClock, Check, Undo2, Wrench } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import { completeTask, reopenTask, type TaskRow } from '@/lib/tasks/actions';
import { Card, CardContent } from '@/components/ui/card';

const KIND_ICON = { rdv: CalendarClock, revisit: Wrench, manual: Check } as const;

/**
 * Open follow-ups. Anyone on the team can close one, because whoever turns up
 * at the customer is the one who settles it.
 */
export function TaskList({
  tasks,
  title,
  showContact = true,
  showAssignee = false,
  emptyHint,
}: {
  tasks: TaskRow[];
  title: string;
  /** Off on a contact page, where every task is about that contact. */
  showContact?: boolean;
  showAssignee?: boolean;
  emptyHint?: string;
}) {
  const t = useTranslations('tasks');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (tasks.length === 0 && !emptyHint) return null;

  const now = Date.now();
  const fmtDue = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    const withTime = iso.includes('T') && !iso.endsWith('T00:00:00.000Z');
    return d.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
      timeZone: 'Africa/Abidjan',
    });
  };

  return (
    <Card>
      <CardContent className={`space-y-2 pt-4 ${isPending ? 'opacity-60' : ''}`}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">{title}</p>
          {tasks.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {t('openCount', { n: tasks.filter((x) => x.status === 'open').length })}
            </span>
          )}
        </div>

        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyHint}</p>
        ) : (
          <ul className="divide-y">
            {tasks.map((task) => {
              const Icon = KIND_ICON[task.kind] ?? Check;
              const overdue =
                task.status === 'open' && task.dueAt != null && new Date(task.dueAt).getTime() < now;
              const done = task.status === 'done';
              return (
                <li key={task.id} className="flex items-start gap-2 py-2">
                  <Icon
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      done ? 'text-muted-foreground' : overdue ? 'text-destructive' : 'text-primary'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${done ? 'text-muted-foreground line-through' : ''}`}>
                      {task.title}
                    </p>
                    {task.details && (
                      <p className="text-xs text-muted-foreground">{task.details}</p>
                    )}
                    <p className="flex flex-wrap items-center gap-x-2 text-xs">
                      {task.dueAt && (
                        <span className={overdue ? 'font-semibold text-destructive' : 'text-muted-foreground'}>
                          {overdue ? t('overdue', { date: fmtDue(task.dueAt) }) : fmtDue(task.dueAt)}
                        </span>
                      )}
                      {showContact && task.contactId && (
                        <Link href={`/contacts/${task.contactId}`} className="text-primary underline">
                          {task.contactName ?? t('contact')}
                        </Link>
                      )}
                      {showAssignee && task.assigneeName && (
                        <span className="text-muted-foreground">· {task.assigneeName}</span>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isPending}
                    aria-label={done ? t('reopen') : t('complete')}
                    onClick={() =>
                      startTransition(async () => {
                        if (done) await reopenTask(task.id, task.contactId);
                        else await completeTask(task.id, task.contactId);
                        router.refresh();
                      })
                    }
                    className={`flex h-9 shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-medium ${
                      done ? 'border-input text-muted-foreground' : 'border-primary text-primary'
                    }`}
                  >
                    {done ? (
                      <>
                        <Undo2 className="h-3.5 w-3.5" /> {t('reopen')}
                      </>
                    ) : (
                      <>
                        <Check className="h-3.5 w-3.5" /> {t('complete')}
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
