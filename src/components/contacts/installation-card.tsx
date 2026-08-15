'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Wrench, CheckCircle2, ArrowRight, Plus } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import { assignInstaller, createInstallation } from '@/lib/installations/actions';
import {
  INSTALL_STATUS_BADGE,
  INSTALL_STATUS_BY_KEY,
} from '@/lib/installations/protocol';
import type { InstallStatus } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

export interface TechOption {
  id: string;
  name: string;
}

export interface InstallJob {
  id: string;
  title: string | null;
  status: InstallStatus;
  installerId: string | null;
  scheduledDate: string | null;
  nextVisitDate: string | null;
  doneSteps: number;
  totalSteps: number;
  equipmentCount: number;
}

function JobRow({
  contactId,
  job,
  technicians,
  canInstall,
}: {
  contactId: string;
  job: InstallJob;
  technicians: TechOption[];
  canInstall: boolean;
}) {
  const t = useTranslations('installation');
  const tStatus = useTranslations('installation.status');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [date, setDate] = useState(job.scheduledDate ?? '');

  const meta = INSTALL_STATUS_BY_KEY[job.status];

  function assign(technicianId: string | null, scheduledDate: string | null) {
    startTransition(async () => {
      await assignInstaller(job.id, contactId, technicianId, scheduledDate);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium">{job.title || t('untitledJob')}</p>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            INSTALL_STATUS_BADGE[meta.color]
          }`}
        >
          {tStatus(meta.i18n)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <select
          value={job.installerId ?? ''}
          onChange={(e) => assign(e.target.value || null, date || null)}
          disabled={isPending || technicians.length === 0}
          aria-label={t('assignTech')}
          className="flex min-h-touch w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">{t('unassignedTech')}</option>
          {technicians.map((tech) => (
            <option key={tech.id} value={tech.id}>
              {tech.name}
            </option>
          ))}
        </select>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          onBlur={() => {
            if (job.installerId) assign(job.installerId, date || null);
          }}
          disabled={isPending}
          aria-label={t('scheduledDate')}
          className="text-sm"
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {t('stepsDone', { done: job.doneSteps, total: job.totalSteps })}
        </span>
        <span>{t('equipmentCount', { n: job.equipmentCount })}</span>
        {job.nextVisitDate && <span>{t('nextVisitOn', { date: job.nextVisitDate })}</span>}
      </div>

      {canInstall && (
        <Link
          href={`/install/new?job=${job.id}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary"
        >
          {t('openInstall')}
          <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}

export function InstallationsSection({
  contactId,
  jobs,
  technicians,
  canInstall,
}: {
  contactId: string;
  jobs: InstallJob[];
  technicians: TechOption[];
  canInstall: boolean;
}) {
  const t = useTranslations('installation');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [newTitle, setNewTitle] = useState('');

  function addJob() {
    startTransition(async () => {
      await createInstallation(contactId, newTitle.trim() || null);
      setNewTitle('');
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Wrench className="h-4 w-4 text-primary" />
          {t('cardTitle')}
        </p>

        {jobs.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('noJobs')}</p>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => (
              <JobRow
                key={job.id}
                contactId={contactId}
                job={job}
                technicians={technicians}
                canInstall={canInstall}
              />
            ))}
          </div>
        )}

        {technicians.length === 0 && (
          <p className="text-xs text-muted-foreground">{t('noTechnicians')}</p>
        )}

        {/* Add another installation job */}
        <div className="flex gap-2">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder={t('newJobPlaceholder')}
            className="flex-1"
          />
          <Button variant="outline" onClick={addJob} disabled={isPending}>
            <Plus className="mr-1 h-4 w-4" />
            {t('addJob')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
