'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  Briefcase,
  Phone,
  Plus,
  Trash2,
  Wrench,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
} from 'lucide-react';
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
import {
  FREE_EXTENSIONS,
  addDays,
  daysBetween,
  daysLeft,
  daysOnSite,
  isRunning,
  todayKey,
  type TrialRow,
} from '@/lib/deals/trial';
import { extendTrial, convertTrial, declineTrial } from '@/lib/deals/trial-actions';
import { buildJournal, stageDwell, type JournalLine } from '@/lib/deals/journal';
import type { DealEvent } from '@/lib/deals/events';

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
  /** Every trial period this affaire has had, oldest first. */
  trials: TrialRow[];
  /** Recorded changes, newest first. Empty on a pre-0034 database. */
  events: DealEvent[];
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

/**
 * An affaire on trial: the periods it has had, how long the equipment has
 * actually been out, and the three ways out.
 *
 * The headline number is days ON SITE, not days left. "J-4" on a second
 * extension reads as nearly over when the honest figure is seventy-five days
 * on someone's counter — and that figure is the one that decides whether a
 * third extension is reasonable.
 */
function TrialPanel({
  deal,
  isManager,
  isPending,
  run,
}: {
  deal: DealCard;
  isManager: boolean;
  isPending: boolean;
  run: (fn: () => Promise<unknown>) => void;
}) {
  const t = useTranslations('deals');
  const [extending, setExtending] = useState(false);
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');

  const current = deal.trials.find(isRunning) ?? null;
  const onSite = daysOnSite(deal.trials);
  const left = current ? daysLeft(current) : null;
  const used = current?.extensions?.length ?? 0;
  const canExtend = isManager || used < FREE_EXTENSIONS;

  const fmt = (d: string) =>
    new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(
      new Date(`${d}T12:00:00Z`),
    );

  return (
    <div className="space-y-2 rounded-md border border-brand-amber/40 bg-brand-amber/5 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{t('trialTitle')}</span>
        {current && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              left != null && left < 0
                ? 'bg-destructive/10 text-destructive'
                : 'bg-brand-amber/20 text-brand-brown'
            }`}
          >
            {left != null && left < 0 ? t('trialOverdue', { n: -left }) : t('trialLeft', { n: left ?? 0 })}
          </span>
        )}
      </div>

      <ol className="space-y-0.5 text-xs text-muted-foreground">
        {deal.trials.map((tr) => (
          <li key={tr.id}>
            <span className="font-medium text-foreground">{t('trialNo', { n: tr.seq })}</span>{' '}
            {fmt(tr.started_on)} → {fmt(tr.ends_on)}{' '}
            <span>({t('trialDays', { n: daysBetween(tr.started_on, tr.ended_on ?? tr.ends_on) })})</span>
            {tr.outcome && <span> · {t(`trialOutcome_${tr.outcome}` as never)}</span>}
            {(tr.extensions ?? []).map((e, i) => (
              <span key={i} className="block pl-3">
                ↳ {t('trialExtendedTo', { date: fmt(e.to) })}
                {e.note ? ` — « ${e.note} »` : ''}
              </span>
            ))}
          </li>
        ))}
      </ol>

      {onSite > 0 && (
        <p className="text-xs font-medium text-brand-brown">{t('trialOnSite', { n: onSite })}</p>
      )}

      {current && !extending && (
        <div className="flex flex-wrap gap-2 pt-0.5">
          <Button
            type="button"
            size="sm"
            disabled={isPending}
            onClick={() => run(() => convertTrial(deal.id))}
          >
            {t('trialConvert')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            className="text-destructive"
            onClick={() => {
              const why = window.prompt(t('trialDeclineWhy')) ?? '';
              run(() => declineTrial(deal.id, why));
            }}
          >
            {t('trialDecline')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending || !canExtend}
            title={canExtend ? undefined : t('trialExtendLocked')}
            onClick={() => {
              setTo(addDays(current.ends_on > todayKey() ? current.ends_on : todayKey(), 15));
              setExtending(true);
            }}
          >
            {t('trialExtend')}
            {!canExtend && ' 🔒'}
          </Button>
        </div>
      )}

      {!canExtend && !extending && (
        <p className="text-xs text-muted-foreground">{t('trialExtendLocked')}</p>
      )}

      {current && extending && (
        <div className="space-y-2 pt-0.5">
          <Input type="date" value={to} min={addDays(todayKey(), 1)} onChange={(e) => setTo(e.target.value)} />
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('trialExtendNote')}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={isPending || !to}
              onClick={() => {
                run(() => extendTrial(deal.id, to, note));
                setExtending(false);
                setNote('');
              }}
            >
              {t('trialExtendSave')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setExtending(false)}>
              {t('trialExtendCancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The life of one affaire, folded shut.
 *
 * Deliberately here and not in the customer's Historique: that one is about
 * PASSAGES — who stood in the shop, for how long, with which photos. Pouring
 * "étape changée" into it would bury the field work under record-keeping.
 */
function DealJournal({
  deal,
  names,
  stageName,
}: {
  deal: DealCard;
  names: Record<string, string>;
  stageName: string | null;
}) {
  const t = useTranslations('deals');
  const [open, setOpen] = useState(false);

  const lines = buildJournal(deal.events, deal.trials);
  if (lines.length === 0) return null;
  const dwell = stageDwell(lines, stageName);

  const when = (iso: string) =>
    new Intl.DateTimeFormat('fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Abidjan',
    }).format(new Date(iso));

  const say = (l: JournalLine) => {
    const who = l.actorId ? (names[l.actorId] ?? null) : null;
    const body =
      l.kind === 'stage' && l.from
        ? `${l.from} → ${l.to ?? '—'}`
        : l.kind === 'stage'
          ? (l.to ?? '—')
          : l.kind === 'created'
            ? t('evCreated')
            : l.kind === 'deleted'
              ? t('evDeleted')
              : l.kind === 'renamed'
                ? `${l.from ?? '—'} → ${l.to ?? '—'}`
                : l.kind === 'install_flag'
                  ? t('evInstallFlag', { v: l.to ?? '—' })
                  : l.kind === 'trial_opened'
                    ? t('evTrialOpened', { date: l.to ?? '—' })
                    : l.kind === 'trial_extended'
                      ? t('evTrialExtended', { date: l.to ?? '—' })
                      : l.kind === 'trial_ended'
                        ? t(`trialOutcome_${l.to}` as never)
                        : `${l.from ?? '—'} → ${l.to ?? '—'}`;
    return { who, body };
  };

  const max = Math.max(1, ...dwell.map((d) => d.days));

  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs text-muted-foreground"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        <span className="font-medium text-foreground">{t('journal')}</span>
        <span className="ml-auto">{t('journalCount', { n: lines.length })}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t px-2.5 py-2">
          {dwell.length > 1 && (
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t('journalDwell')}
              </p>
              {dwell.map((d) => (
                <div key={d.stage} className="grid grid-cols-[92px_1fr_38px] items-center gap-2">
                  <span className="truncate text-xs text-muted-foreground">{d.stage}</span>
                  <span className="h-2 overflow-hidden rounded-sm bg-muted">
                    <span
                      className={`block h-full rounded-sm ${d.current ? 'bg-brand-amber' : 'bg-primary/60'}`}
                      style={{ width: `${Math.round((d.days / max) * 100)}%` }}
                    />
                  </span>
                  <span className="text-right text-xs [font-variant-numeric:tabular-nums]">
                    {t('nDays', { n: d.days })}
                  </span>
                </div>
              ))}
            </div>
          )}

          <ol className="ml-0.5 space-y-0 border-l-2 border-border pl-2.5">
            {lines.map((l) => {
              const { who, body } = say(l);
              return (
                <li key={l.key} className="py-0.5 text-xs">
                  <span className="text-muted-foreground">{when(l.at)}</span>{' '}
                  <span className="uppercase text-[10px] tracking-wide text-muted-foreground">
                    {t(`ev_${l.kind}` as never)}
                  </span>{' '}
                  <span>{body}</span>
                  {who && <span className="text-muted-foreground"> · {who}</span>}
                  {l.note && <span className="text-muted-foreground"> — « {l.note} »</span>}
                  {l.satDays != null && (
                    <span className="block text-[11px] text-brand-brown">
                      {t('journalSat', { n: l.satDays })}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
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
  staff = {},
}: {
  contactId: string;
  deal: DealCard;
  stages: DealStage[];
  products: ProductOption[];
  people: PersonOption[];
  technicians: { id: string; name: string }[];
  canInstall: boolean;
  isManager?: boolean;
  staff?: Record<string, string>;
}) {
  const t = useTranslations('deals');
  const tInstall = useTranslations('installation');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState(deal.title ?? '');
  const [failed, setFailed] = useState<string | null>(null);
  const KNOWN = new Set([
    'manager_only_second_trial',
    'manager_only_extension',
    'date_must_move_forward',
    'no_open_trial',
  ]);

  // Every action on this card returns ActionResult. Discarding it meant a
  // refusal — no rights, row gone, save failed — was indistinguishable from a
  // dead control: the value simply snapped back on refresh with no message.
  function run(fn: () => Promise<unknown>) {
    startTransition(async () => {
      const res = (await fn()) as { ok?: boolean; error?: string } | undefined;
      setFailed(res?.ok === false ? (res.error ?? 'save_failed') : null);
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

      {failed && (
        <p className="text-xs text-destructive">
          {KNOWN.has(failed) ? t(`err_${failed}` as never) : t('saveFailed')}
        </p>
      )}

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
      <DealJournal
        deal={deal}
        names={staff}
        stageName={stages.find((s) => s.id === deal.pipelineStageId)?.name ?? null}
      />

      {deal.trials.length > 0 ? (
        <TrialPanel deal={deal} isManager={!!isManager} isPending={isPending} run={run} />
      ) : (
        deal.needsInstallation &&
        deal.status !== 'won' && (
          <p className="pl-6 text-xs text-muted-foreground">{t('installOnWin')}</p>
        )
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
  staff = {},
}: {
  contactId: string;
  deals: DealCard[];
  stages: DealStage[];
  products: ProductOption[];
  people?: PersonOption[];
  technicians: { id: string; name: string }[];
  canInstall: boolean;
  isManager?: boolean;
  /** user id → name, for the journal's actor column. */
  staff?: Record<string, string>;
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
                staff={staff}
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
