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
import { PhoneInput } from '@/components/shared/phone-input';
import { RoleSelect, DEFAULT_ROLE } from '@/components/shared/role-select';
import { BusinessTypeSelect } from '@/components/shared/business-type-select';
import { TagsInput } from '@/components/shared/tags-input';
import { assignInstaller } from '@/lib/installations/actions';
import { cancelSubscription } from '@/lib/commissions/actions';
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
  businessType: string | null;
  tags: string[];
  subscription?: DealSubscription | null;
  installs: DealInstall[];
}

/** An interlocutor of the business, selectable per deal. */
export interface PersonOption {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
}

export interface DealSubscription {
  id: string;
  status: 'active' | 'cancelled';
  slices: { index: number; status: string; amount: number; month: string }[];
}

const SLICE_DOT: Record<string, string> = {
  earned: '●',
  paid: '●',
  pending: '○',
  expired: '✕',
};

export interface DealStage {
  id: string;
  name: string;
  is_won: boolean;
  is_lost: boolean;
}

export interface ProductOption {
  id: string;
  name: string;
  price_xof?: number;
  commission_pct?: number;
  commission_mode?: string;
  commission_months?: number;
  tech_commission_pct?: number;
}

const STATUS_BADGE: Record<DealStatus, string> = {
  open: 'bg-brand-amber/15 text-brand-brown',
  won: 'bg-brand-green/15 text-brand-green',
  lost: 'bg-destructive/10 text-destructive',
};

/**
 * The same colour as the badge, run down the edge of the card. A fiche can
 * carry several affaires at once; the stripe says which is live, which is won
 * and which is dead without reading a word.
 */
const STATUS_EDGE: Record<DealStatus, string> = {
  open: 'border-l-brand-amber',
  won: 'border-l-brand-green',
  lost: 'border-l-destructive',
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
  const [role, setRole] = useState(DEFAULT_ROLE);
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
      <RoleSelect value={role} onChange={setRole} otherPlaceholder={tP('rolePlaceholder')} />
      <PhoneInput value={phone} onChange={setPhone} placeholder={tP('phonePlaceholder')} />
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
              setRole(DEFAULT_ROLE);
              setPhone('');
              setOpen(false);
              await onCreated(res.personId);
            });
          }}
        >
          {tP('save')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false);
            setName('');
            setRole(DEFAULT_ROLE);
            setPhone('');
            setError(false);
          }}
          disabled={isPending}
        >
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
  isManager = false,
}: {
  contactId: string;
  deal: DealCard;
  stages: DealStage[];
  products: ProductOption[];
  people: PersonOption[];
  technicians: { id: string; name: string }[];
  canInstall: boolean;
  isManager?: boolean;
}) {
  const t = useTranslations('deals');
  const tInstall = useTranslations('installation');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState(deal.title ?? '');
  const [failed, setFailed] = useState(false);

  // Every action on this card returns ActionResult. Discarding it meant a
  // refusal — no rights, row gone, save failed — was indistinguishable from a
  // dead control: the value simply snapped back on refresh with no message.
  function run(fn: () => Promise<unknown>) {
    startTransition(async () => {
      const res = (await fn()) as { ok?: boolean } | undefined;
      setFailed(res?.ok === false);
      router.refresh();
    });
  }

  return (
    <div
      className={`space-y-2.5 rounded-lg border border-l-4 bg-card p-3 shadow-sm ${STATUS_EDGE[deal.status]}`}
    >
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
        {/* Mirrors the RLS policy (0029): an open affaire that has produced
            nothing is anyone's to clear up; once it is won, lost, or carries a
            subscription, deleting it takes the chantiers and their trips with
            it, so it becomes a manager's call. */}
        {(isManager || (deal.status === 'open' && !deal.subscription)) && (
          <button
            type="button"
            aria-label={t('delete')}
            disabled={isPending}
            onClick={() => {
              if (!window.confirm(t('deleteConfirm'))) return;
              run(() => deleteDeal(deal.id));
            }}
            className="shrink-0 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {failed && <p className="text-xs text-destructive">{t('saveFailed')}</p>}

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
          {(() => {
            const prod = products.find((x) => x.id === deal.productId);
            const pct = prod?.commission_pct ?? 0;
            if (!prod || pct <= 0) return null;
            const base = deal.valueXof ?? prod.price_xof ?? 0;
            const slice = Math.round((base * pct) / 100);
            const months = prod.commission_mode === 'recurring' ? (prod.commission_months ?? 3) : 1;
            return (
              <p className="text-xs font-medium text-primary">
                {prod.commission_mode === 'recurring'
                  ? t('commissionPotentialRecurring', {
                      slice: slice.toLocaleString('fr-FR'),
                      months,
                      total: (slice * months).toLocaleString('fr-FR'),
                    })
                  : t('commissionPotentialOnce', { amount: slice.toLocaleString('fr-FR') })}
              </p>
            );
          })()}
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

      {/* Set once on the fiche and inherited by every affaire (0030): a maquis
          is a maquis whichever forfait it buys, and asking per affaire let the
          same customer end up two different things. */}
      {(deal.businessType || deal.tags.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {deal.businessType && (
            <span className="rounded-full bg-secondary px-2 py-0.5 font-medium text-secondary-foreground">
              {deal.businessType}
            </span>
          )}
          {deal.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
              {tag}
            </span>
          ))}
          <span className="text-muted-foreground">{t('fromContact')}</span>
        </div>
      )}

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

      {/* Subscription + commission slices (recurring products, once won) */}
      {deal.subscription && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-primary/5 px-3 py-2 text-sm">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              deal.subscription.status === 'active'
                ? 'bg-brand-green/15 text-brand-green'
                : 'bg-destructive/10 text-destructive'
            }`}
          >
            {deal.subscription.status === 'active' ? t('subActive') : t('subCancelled')}
          </span>
          <span className="font-mono text-base tracking-widest" title={t('sliceHint')}>
            {deal.subscription.slices.map((s) => SLICE_DOT[s.status] ?? '○').join('')}
          </span>
          <span className="text-xs text-muted-foreground">
            {t('sliceSummary', {
              earned: deal.subscription.slices.filter((s) => s.status === 'earned' || s.status === 'paid').length,
              total: deal.subscription.slices.length,
              amount: deal.subscription.slices
                .filter((s) => s.status === 'earned' || s.status === 'paid')
                .reduce((sum, s) => sum + s.amount, 0)
                .toLocaleString('fr-FR'),
            })}
          </span>
          {isManager && deal.subscription.status === 'active' && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto"
              disabled={isPending}
              onClick={() => {
                if (!window.confirm(t('cancelSubConfirm'))) return;
                run(() => cancelSubscription(deal.subscription!.id, contactId));
              }}
            >
              {t('cancelSub')}
            </Button>
          )}
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={deal.needsInstallation}
          disabled={isPending}
          onChange={(e) => run(() => updateDeal(deal.id, { needsInstallation: e.target.checked }))}
        />
        {t('needsInstallation')}
      </label>
      {deal.needsInstallation && deal.status !== 'won' && (
        <p className="pl-6 text-xs text-muted-foreground">{t('installOnWin')}</p>
      )}

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
  isManager = false,
}: {
  contactId: string;
  deals: DealCard[];
  stages: DealStage[];
  products: ProductOption[];
  people?: PersonOption[];
  technicians: { id: string; name: string }[];
  canInstall: boolean;
  isManager?: boolean;
}) {
  const t = useTranslations('deals');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [newTitle, setNewTitle] = useState('');
  const [newNeedsInstall, setNewNeedsInstall] = useState(false);
  const [newPersonId, setNewPersonId] = useState('');
  const [newType, setNewType] = useState<string | null>(null);

  function addDeal() {
    startTransition(async () => {
      await createDeal(contactId, {
        title: newTitle.trim() || null,
        needsInstallation: newNeedsInstall,
        contactPersonId: newPersonId || null,
        businessType: newType,
      });
      setNewTitle('');
      setNewNeedsInstall(false);
      setNewPersonId('');
      setNewType(null);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Briefcase className="h-4 w-4 text-primary" />
          {t('title')}
          {deals.length > 0 && (
            <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
              {deals.length}
            </span>
          )}
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
                isManager={isManager}
              />
            ))}
          </div>
        )}

        {/* New affaire — deliberately unlike the cards above: dashed and
            recessed, the same "nothing here yet" language as the photo slots,
            so a form is never mistaken for a record. */}
        <div className="space-y-2 rounded-lg border-2 border-dashed border-muted-foreground/25 bg-muted/40 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Plus className="h-3.5 w-3.5" />
            {t('newAffaire')}
          </p>
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
