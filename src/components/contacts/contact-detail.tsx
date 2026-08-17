'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Phone, MessageCircle, StickyNote, DoorOpen, Pencil, MapPin, Navigation } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import { directionsUrl } from '@/lib/geo';
import type { ContactLifecycle, PriorityLevel, ActivityType } from '@/types/database';
import { logActivity, updateContact, assignContact } from '@/lib/contacts/actions';
import {
  DealsSection,
  type DealCard,
  type DealStage,
  type PersonOption,
  type ProductOption,
} from '@/components/contacts/deals-section';
import { PeopleSection, type PersonCard } from '@/components/contacts/people-section';
import { WhatsappDraft } from '@/components/contacts/whatsapp-draft';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

export interface ContactFull {
  id: string;
  name: string | null;
  phone: string | null;
  address: string | null;
  lifecycle: ContactLifecycle;
  priority: PriorityLevel;
  valueXof: number | null;
  tags: string[];
  assignedRepId: string | null;
  lat: number | null;
  lng: number | null;
}

export interface Stage {
  id: string;
  name: string;
  sort_order: number;
  is_won: boolean;
  is_lost: boolean;
}

export interface RepOption {
  id: string;
  name: string;
}

export type TimelineItem =
  | {
      kind: 'visit';
      id: string;
      at: string;
      disposition: string | null;
      content: string | null;
      repName: string | null;
      photos: string[];
    }
  | {
      kind: 'activity';
      id: string;
      at: string;
      activityType: string;
      content: string | null;
      repName: string | null;
    };

const PRIORITIES: PriorityLevel[] = ['vip', 'high', 'medium', 'low'];

function fmt(at: string): string {
  try {
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(
      new Date(at),
    );
  } catch {
    return at;
  }
}

export function ContactDetail({
  contact,
  stages,
  timeline,
  reps,
  technicians,
  deals,
  products,
  people = [],
  canInstall,
}: {
  contact: ContactFull;
  stages: Stage[];
  timeline: TimelineItem[];
  reps: RepOption[];
  technicians: RepOption[];
  deals: DealCard[];
  products: ProductOption[];
  people?: PersonCard[];
  canInstall: boolean;
}) {
  const t = useTranslations('contacts');
  const tLife = useTranslations('lifecycle');
  const tPrio = useTranslations('priority');
  const tDisp = useTranslations('dispositions');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(contact.name ?? '');
  const [phone, setPhone] = useState(contact.phone ?? '');
  const [priority, setPriority] = useState<PriorityLevel>(contact.priority);

  const [actType, setActType] = useState<ActivityType>('call');
  const [actContent, setActContent] = useState('');

  function run(fn: () => Promise<unknown>) {
    startTransition(async () => {
      await fn();
      router.refresh();
    });
  }

  // Which deals each interlocutor handles (shown on their card).
  const dealsByPerson: Record<string, string[]> = {};
  for (const d of deals) {
    if (!d.contactPersonId) continue;
    const label =
      d.title || products.find((p) => p.id === d.productId)?.name || t('rowDealFallback');
    (dealsByPerson[d.contactPersonId] ??= []).push(label);
  }

  const whatsappHref = contact.phone
    ? `https://wa.me/${contact.phone.replace(/[^0-9]/g, '')}`
    : null;
  const goHref = directionsUrl(contact.lat, contact.lng, contact.address);

  return (
    <div className="space-y-3">
      {/* Header / badges */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
              {tLife(contact.lifecycle)}
            </span>
            <span className="rounded bg-brand-amber/15 px-2 py-0.5 text-xs font-medium text-brand-brown">
              {tPrio(contact.priority)}
            </span>
            <button
              onClick={() => setEditing((v) => !v)}
              className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
              {t('edit')}
            </button>
          </div>

          {editing ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="c-name">{t('noName')}</Label>
                <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-phone">{t('phone')}</Label>
                <Input id="c-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-prio">{t('priority')}</Label>
                <select
                  id="c-prio"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as PriorityLevel)}
                  className="flex min-h-touch w-full rounded-md border border-input bg-background px-3 text-base"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {tPrio(p)}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                className="w-full"
                disabled={isPending}
                onClick={() =>
                  run(async () => {
                    await updateContact(contact.id, {
                      name: name.trim() || null,
                      phone: phone.trim() || null,
                      priority,
                    });
                    setEditing(false);
                  })
                }
              >
                {t('save')}
              </Button>
            </div>
          ) : (
            <div className="space-y-1 text-sm">
              {contact.phone && (
                <div className="flex flex-wrap items-center gap-3">
                  <a href={`tel:${contact.phone}`} className="inline-flex items-center gap-1.5 text-primary">
                    <Phone className="h-4 w-4" /> {contact.phone}
                  </a>
                  {whatsappHref && (
                    <a href={whatsappHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-knock-green">
                      <MessageCircle className="h-4 w-4" /> WhatsApp
                    </a>
                  )}
                  <WhatsappDraft contactId={contact.id} phone={contact.phone} />
                </div>
              )}
              {contact.address && (
                <p className="flex items-center gap-1.5 text-muted-foreground">
                  <MapPin className="h-4 w-4 shrink-0" /> {contact.address}
                </p>
              )}
              {goHref && (
                <a
                  href={goHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 pt-0.5 font-medium text-primary"
                >
                  <Navigation className="h-4 w-4" /> {tCommon('goThere')}
                </a>
              )}
              {contact.valueXof != null && (
                <p className="text-muted-foreground">
                  {t('value')}: {contact.valueXof.toLocaleString('fr-FR')} XOF
                </p>
              )}
              {contact.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {contact.tags.map((tag) => (
                    <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Account owner (commercial) */}
      <Card>
        <CardContent className="space-y-1 pt-4">
          <Label htmlFor="c-assign">{t('assignedTo')}</Label>
          <select
            id="c-assign"
            value={contact.assignedRepId ?? ''}
            onChange={(e) => run(() => assignContact(contact.id, e.target.value || null))}
            disabled={isPending}
            className="flex min-h-touch w-full rounded-md border border-input bg-background px-3 text-base"
          >
            <option value="">{t('unassigned')}</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      {/* Interlocuteurs (gérant, chef de projet…) of this business */}
      <PeopleSection contactId={contact.id} people={people} dealsByPerson={dealsByPerson} />

      {/* Affaires (deals): several businesses, each sellable and/or installable */}
      <DealsSection
        contactId={contact.id}
        deals={deals}
        stages={stages as DealStage[]}
        products={products}
        people={people as PersonOption[]}
        technicians={technicians}
        canInstall={canInstall}
      />

      {/* Activity composer */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          <p className="text-sm font-semibold">{t('logActivity')}</p>
          <div className="grid grid-cols-4 gap-2">
            <Link
              href={`/visit/new?contact=${contact.id}`}
              className="flex min-h-touch flex-col items-center justify-center gap-0.5 rounded-lg bg-primary/10 px-1 text-xs font-medium text-primary hover:bg-primary/15"
            >
              <DoorOpen className="h-4 w-4" /> {t('visitShort')}
            </Link>
            {(
              [
                { k: 'call', label: t('typeCall'), icon: Phone },
                { k: 'whatsapp', label: t('typeWhatsapp'), icon: MessageCircle },
                { k: 'note', label: t('typeNote'), icon: StickyNote },
              ] as const
            ).map((a) => (
              <button
                key={a.k}
                onClick={() => setActType(a.k)}
                className={`flex min-h-touch flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-xs font-medium ${
                  actType === a.k
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground'
                }`}
              >
                <a.icon className="h-4 w-4" /> {a.label}
              </button>
            ))}
          </div>
          <textarea
            rows={2}
            value={actContent}
            onChange={(e) => setActContent(e.target.value)}
            placeholder={t('activityPlaceholder')}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-base"
          />
          <Button
            className="w-full"
            disabled={isPending}
            onClick={() =>
              run(async () => {
                await logActivity(contact.id, actType, actContent);
                setActContent('');
              })
            }
          >
            {t('add')}
          </Button>
        </CardContent>
      </Card>

      {/* Timeline */}
      <div>
        <p className="mb-2 text-sm font-semibold">{t('history')}</p>
        {timeline.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">{t('noHistory')}</Card>
        ) : (
          <div className="space-y-2">
            {timeline.map((it) => (
              <Card key={`${it.kind}-${it.id}`} className="p-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {it.kind === 'visit'
                      ? `${t('visitLabel')}${it.disposition ? ' · ' + tDisp(it.disposition as never) : ''}`
                      : it.activityType === 'call'
                        ? t('typeCall')
                        : it.activityType === 'whatsapp'
                          ? t('typeWhatsapp')
                          : t('typeNote')}
                  </span>
                  <span className="shrink-0 text-right">
                    {it.repName && <span className="font-medium text-foreground">{it.repName}</span>}
                    {it.repName && ' · '}
                    {fmt(it.at)}
                  </span>
                </div>
                {it.content && <p className="mt-1 text-sm">{it.content}</p>}
                {it.kind === 'visit' && it.photos.length > 0 && (
                  <div className="mt-2 flex gap-2 overflow-x-auto">
                    {it.photos.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={i}
                        src={src}
                        alt=""
                        className="h-20 w-20 shrink-0 rounded-md border object-cover"
                      />
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
