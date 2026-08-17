'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Briefcase, Phone, Plus, Trash2, Wrench, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import {
  createDeal,
  setDealStage,
  updateDeal,
  deleteDeal,
} from '@/lib/deals/actions';
import { addContactPerson, assignDealPerson } from '@/lib/contacts/people-actions';
import { assignInstaller } from '@/lib/installations/actions';
import { INSTALL_STATUS_BADGE, INSTALL_STATUS_BY_KEY } from '@/lib/installations/protocol';
import type { DealStatus, InstallStatus } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

export interface DealInstall {
  id: string;
  status: InstallStatus;
  installerId: string | null;
  scheduledDate: string | null;
  nextVisitDate: string | null;
  doneSteps: number;
  totalSteps: number;
  equipmentCount: number;
}

export interface DealCard {
  id: string;
  title: string | null;
  productId: string | null;
  valueXof: number | null;
  status: DealStatus;
  pipelineStageId: string | null;
  needsInstallation: boolean;
  contactPersonId: string | null;
  installs: DealInstall[];
}

/** An interlocutor of the business, selectable per deal. */
export interface PersonOption {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
}

export interface DealStage {
  id: string;
  name: string;
  is_won: boolean;
  is_lost: boolean;
}

export interface ProductOption {
  id: string;
  name: string;
}

const STATUS_BADGE: Record<DealStatus, string> = {
  open: 'bg-brand-amber/15 text-brand-brown',
  won: 'bg-brand-green/15 text-brand-green',
  lost: 'bg-destructive/10 text-destructive',
};

/**
 * Inline "new interlocutor" mini-form: creates the person on the business and
 * hands the new id back so the caller can link it to a deal right away.
 */
function QuickAddPerson({
  contactId,
  onCreated,
}: {
  contactId: string;
  onCreated: (personId: string) => void | Promise<void>;
}) {
  const t = useTranslations('deals');
  const tP = useTranslations('people');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs font-medium text-primary"
      >
        <Plus className="h-3.5 w-3.5" /> {t('addPerson')}
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border p-2.5">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={tP('namePlaceholder')}
        autoFocus
      />
      <div className="grid grid-cols-2 gap-2">
        <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder={tP('rolePlaceholder')} />
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder={tP('phonePlaceholder')} />
      </div>
      {error && <p className="text-xs text-destructive">{tP('error')}</p>}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={isPending || !name.trim()}
          onClick={() => {
            setError(false);
            startTransition(async () => {
              const res = await addContactPerson(contactId, { name, role, phone });
              if (!res.ok) {
                setError(true);
                return;
              }
              setName('');
              setRole('');
              setPhone('');
              setOpen(false);
              await onCreated(res.personId);
            });
          }}
        >
          {tP('save')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
          {tP('cancel')}
        </Button>
      </div>
    </div>
  );
}

function InstallRow({
  contactId,
  install,
  technicians,
  canInstall,
}: {
  contactId: string;
  install: DealInstall;
  technicians: { id: string; name: string }[];
  canInstall: boolean;
}) {
  const t = useTranslations('installation');
  const tStatus = useTranslations('installation.status');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [date, setDate] = useState(install.scheduledDate ?? '');
  const meta = INSTALL_STATUS_BY_KEY[install.status];

  function assign(techId: string | null) {
    startTransition(async () => {
      await assignInstaller(install.id, contactId, techId, date || null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 rounded-md border border-primary/20 bg-primary/5 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
          <Wrench className="h-3.5 w-3.5" /> {t('cardTitle')}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${INSTALL_STATUS_BADGE[meta.color]}`}>
          {tStatus(meta.i18n)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={install.installerId ?? ''}
          onChange={(e) => assign(e.target.value || null)}
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
          onBlur={() => install.installerId && assign(install.installerId)}
          disabled={isPending}
          aria-label={t('scheduledDate')}
          className="text-sm"
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {t('stepsDone', { done: install.doneSteps, total: install.totalSteps })}
        </span>
        <span>{t('equipmentCount', { n: install.equipmentCount })}</span>
        {install.nextVisitDate && <span>{t('nextVisitOn', { date: install.nextVisitDate })}</span>}
      </div>
      {canInstall && (
        <Link
          href={`/install/new?job=${install.id}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary"
        >
          {t('openInstall')} <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}

function DealRow({
  contactId,
  deal,
  stages,
  products,
  people,
  technicians,
  canInstall,
}: {
  contactId: string;
  deal: DealCard;
  stages: DealStage[];
  products: ProductOption[];
  people: PersonOption[];
  technicians: { id: string; name: string }[];
  canInstall: boolean;
}) {
  const t = useTranslations('deals');
  const tInstall = useTranslations('installation');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState(deal.title ?? '');

  function run(fn: () => Promise<unknown>) {
    startTransition(async () => {
      await fn();
      router.refresh();
    });
  }

  return (
    <div className="space-y-2.5 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() !== (deal.title ?? '') && run(() => updateDeal(deal.id, { title }))}
          placeholder={t('untitled')}
          className="flex-1 font-medium"
        />
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[deal.status]}`}>
          {t(`status_${deal.status}` as never)}
        </span>
        <button
          type="button"
          aria-label={t('delete')}
          disabled={isPending}
          onClick={() => run(() => deleteDeal(deal.id))}
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">{t('product')}</Label>
          <select
            value={deal.productId ?? ''}
            onChange={(e) => run(() => updateDeal(deal.id, { productId: e.target.value || null }))}
            disabled={isPending}
            className="flex min-h-touch w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">{t('noProduct')}</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {t('value')}: {(deal.valueXof ?? 0).toLocaleString('fr-FR')} XOF
          </p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('stage')}</Label>
          <select
            value={deal.pipelineStageId ?? ''}
            onChange={(e) => run(() => setDealStage(deal.id, e.target.value))}
            disabled={isPending}
            className="flex min-h-touch w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Interlocutor this deal is negotiated with — always visible, with a
          one-tap way to create the person right here. */}
      <div className="space-y-1.5">
        <Label className="text-xs">{t('person')}</Label>
        {people.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              value={deal.contactPersonId ?? ''}
              onChange={(e) =>
                run(() => assignDealPerson(deal.id, contactId, e.target.value || null))
              }
              disabled={isPending}
              className="flex min-h-touch w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">{t('noPerson')}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.role ? ` — ${p.role}` : ''}
                </option>
              ))}
            </select>
            {(() => {
              const sel = people.find((p) => p.id === deal.contactPersonId);
              return sel?.phone ? (
                <a
                  href={`tel:${sel.phone}`}
                  aria-label={t('callPerson')}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
                >
                  <Phone className="h-4 w-4" />
                </a>
              ) : null;
            })()}
          </div>
        )}
        <QuickAddPerson
          contactId={contactId}
          onCreated={async (personId) => {
            await assignDealPerson(deal.id, contactId, personId);
            router.refresh();
          }}
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={deal.needsInstallation}
          disabled={isPending}
          onChange={(e) => run(() => updateDeal(deal.id, { needsInstallation: e.target.checked }))}
        />
        {t('needsInstallation')}
      </label>

      {/* Installation(s) for a won + installable deal */}
      {deal.status === 'won' && deal.needsInstallation && (
        <div className="space-y-2">
          {deal.installs.length === 0 ? (
            <p className="text-xs text-muted-foreground">{tInstall('noJobs')}</p>
          ) : (
            deal.installs.map((inst) => (
              <InstallRow
                key={inst.id}
                contactId={contactId}
                install={inst}
                technicians={technicians}
                canInstall={canInstall}
              />
            ))
          )}
          {technicians.length === 0 && (
            <p className="text-xs text-muted-foreground">{tInstall('noTechnicians')}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function DealsSection({
  contactId,
  deals,
  stages,
  products,
  people = [],
  technicians,
  canInstall,
}: {
  contactId: string;
  deals: DealCard[];
  stages: DealStage[];
  products: ProductOption[];
  people?: PersonOption[];
  technicians: { id: string; name: string }[];
  canInstall: boolean;
}) {
  const t = useTranslations('deals');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [newTitle, setNewTitle] = useState('');
  const [newNeedsInstall, setNewNeedsInstall] = useState(false);
  const [newPersonId, setNewPersonId] = useState('');

  function addDeal() {
    startTransition(async () => {
      await createDeal(contactId, {
        title: newTitle.trim() || null,
        needsInstallation: newNeedsInstall,
        contactPersonId: newPersonId || null,
      });
      setNewTitle('');
      setNewNeedsInstall(false);
      setNewPersonId('');
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Briefcase className="h-4 w-4 text-primary" />
          {t('title')}
        </p>

        {deals.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('noAffaires')}</p>
        ) : (
          <div className="space-y-2">
            {deals.map((d) => (
              <DealRow
                key={d.id}
                contactId={contactId}
                deal={d}
                stages={stages}
                products={products}
                people={people}
                technicians={technicians}
                canInstall={canInstall}
              />
            ))}
          </div>
        )}

        {/* New affaire — name it here, pick the product on the card once created */}
        <div className="space-y-2 rounded-lg border border-dashed p-3">
          <p className="text-xs font-medium text-muted-foreground">{t('newAffaire')}</p>
          <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder={t('productPlaceholder')} />
          <div className="space-y-1.5">
            <Label className="text-xs">{t('person')}</Label>
            {people.length > 0 && (
              <select
                value={newPersonId}
                onChange={(e) => setNewPersonId(e.target.value)}
                className="flex min-h-touch w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">{t('noPerson')}</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.role ? ` — ${p.role}` : ''}
                  </option>
                ))}
              </select>
            )}
            <QuickAddPerson
              contactId={contactId}
              onCreated={(personId) => {
                // The refreshed people list will include them; preselect now.
                setNewPersonId(personId);
                router.refresh();
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={newNeedsInstall} onChange={(e) => setNewNeedsInstall(e.target.checked)} />
              {t('needsInstallation')}
            </label>
            <Button size="sm" onClick={addDeal} disabled={isPending}>
              <Plus className="mr-1 h-4 w-4" /> {t('add')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
