'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Briefcase, Phone, Mail, MessageCircle, Plus, Trash2, UserRound } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { addContactPerson, deleteContactPerson } from '@/lib/contacts/people-actions';
import { whatsappUrl } from '@/lib/phone';
import { PhoneInput } from '@/components/shared/phone-input';
import { RoleSelect, DEFAULT_ROLE } from '@/components/shared/role-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

export interface PersonCard {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
}

export function PeopleSection({
  contactId,
  people,
  dealsByPerson = {},
}: {
  contactId: string;
  people: PersonCard[];
  /** Labels of the deals each person handles (personId → deal names). */
  dealsByPerson?: Record<string, string[]>;
}) {
  const t = useTranslations('people');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState(DEFAULT_ROLE);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState(false);

  function onAdd() {
    if (!name.trim()) return;
    setError(false);
    startTransition(async () => {
      const res = await addContactPerson(contactId, { name, role, phone, email });
      if (!res.ok) {
        setError(true);
        return;
      }
      setName('');
      setRole(DEFAULT_ROLE);
      setPhone('');
      setEmail('');
      setAdding(false);
      router.refresh();
    });
  }

  function onDelete(p: PersonCard) {
    if (!window.confirm(t('deleteConfirm', { name: p.name }))) return;
    startTransition(async () => {
      await deleteContactPerson(p.id, contactId);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <UserRound className="h-4 w-4 text-primary" />
            {t('title')}
          </p>
          {!adding && (
            <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
              <Plus className="mr-1 h-4 w-4" />
              {t('add')}
            </Button>
          )}
        </div>

        {people.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        )}

        <ul className="space-y-2">
          {people.map((p) => (
            <li key={p.id} className="rounded-lg bg-muted/40 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {p.name}
                    {p.role && (
                      <span className="ml-2 rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        {p.role}
                      </span>
                    )}
                  </p>
                  {p.email && (
                    <a
                      href={`mailto:${p.email}`}
                      className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground underline"
                    >
                      <Mail className="h-3 w-3" /> {p.email}
                    </a>
                  )}
                  {(dealsByPerson[p.id] ?? []).length > 0 && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <Briefcase className="h-3 w-3 shrink-0" />
                      {t('handlesDeals')}: {dealsByPerson[p.id].join(' · ')}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onDelete(p)}
                  disabled={isPending}
                  aria-label={t('remove')}
                  className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {p.phone && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <a
                    href={`tel:${p.phone}`}
                    className="flex min-h-touch items-center justify-center gap-1.5 rounded-md bg-primary/10 text-sm font-medium text-primary"
                  >
                    <Phone className="h-4 w-4" /> {t('call')}
                  </a>
                  <a
                    href={whatsappUrl(p.phone)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-h-touch items-center justify-center gap-1.5 rounded-md bg-knock-green/10 text-sm font-medium text-knock-green"
                  >
                    <MessageCircle className="h-4 w-4" /> WhatsApp
                  </a>
                </div>
              )}
            </li>
          ))}
        </ul>

        {adding && (
          <div className="space-y-2 rounded-lg border p-3">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('namePlaceholder')}
              autoFocus
            />
            <RoleSelect value={role} onChange={setRole} otherPlaceholder={t('rolePlaceholder')} />
            <PhoneInput value={phone} onChange={setPhone} placeholder={t('phonePlaceholder')} />
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              inputMode="email"
              placeholder={t('emailPlaceholder')}
            />
            {error && <p className="text-xs text-destructive">{t('error')}</p>}
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                onClick={onAdd}
                disabled={isPending || !name.trim()}
              >
                {t('save')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setAdding(false)}
                disabled={isPending}
              >
                {t('cancel')}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
