'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { createContact, findByPhone } from '@/lib/contacts/actions';
import { Link } from '@/i18n/navigation';
import { PhoneInput } from '@/components/shared/phone-input';
import { AddressPicker } from '@/components/shared/address-picker';
import { BusinessTypeSelect } from '@/components/shared/business-type-select';
import { TagsInput } from '@/components/shared/tags-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Record a prospect met away from a doorstep — a phone call, a referral,
 * someone introduced at a market. Only the name is required; the rest of the
 * fiche is filled in afterwards, which is where the tags, the type d'activité
 * and the affaires live.
 */
export function NewContactForm() {
  const t = useTranslations('contacts');
  const tCommon = useTranslations('common');
  const tDeals = useTranslations('deals');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [businessType, setBusinessType] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState<{ id: string; name: string | null }[]>([]);

  // A number already on file usually means this fiche exists. Usually — a
  // family running three kiosks shares one line — so this informs, never blocks.
  useEffect(() => {
    const digits = phone.replace(/[^0-9]/g, '');
    if (digits.length < 8) {
      setSharing([]);
      return;
    }
    const timer = setTimeout(async () => setSharing(await findByPhone(phone)), 500);
    return () => clearTimeout(timer);
  }, [phone]);

  const canSave = name.trim() !== '' && !isPending;

  function save() {
    if (!canSave) return;
    setError(null);
    startTransition(async () => {
      const res = await createContact({ name, phone, address, lat, lng, businessType, tags });
      if (!res.ok) {
        setError(t('newError'));
        return;
      }
      // Straight to the fiche: the next thing anyone wants is the affaire.
      router.replace(`/contacts/${res.id}`);
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-4">
        <div className="space-y-2">
          <Label htmlFor="nc-name">{t('newName')}</Label>
          <Input
            id="nc-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('newNamePlaceholder')}
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="nc-phone">{t('newPhone')}</Label>
          <PhoneInput id="nc-phone" value={phone} onChange={setPhone} />
        </div>

        {sharing.length > 0 && (
          <div className="rounded-md bg-brand-amber/10 p-2.5 text-xs">
            <p className="font-medium text-brand-brown">{t('phoneInUse')}</p>
            <p className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1">
              {sharing.map((c) => (
                <Link
                  key={c.id}
                  href={`/contacts/${c.id}`}
                  className="underline hover:text-foreground"
                >
                  {c.name ?? '—'}
                </Link>
              ))}
            </p>
            <p className="mt-1 text-muted-foreground">{t('phoneInUseHint')}</p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="nc-address">{t('newAddress')}</Label>
          <AddressPicker
            value={address}
            lat={lat}
            lng={lng}
            onChange={(a, la, ln) => {
              setAddress(a);
              setLat(la);
              setLng(ln);
            }}
          />
        </div>

        {/* Properties of the business: set here once, every affaire inherits. */}
        <div className="space-y-2">
          <Label>{tDeals('businessType')}</Label>
          <BusinessTypeSelect
            value={businessType}
            onCommit={setBusinessType}
            emptyLabel={tDeals('noBusinessType')}
            otherPlaceholder={tDeals('businessTypeOther')}
          />
        </div>

        <div className="space-y-2">
          <Label>{tDeals('tags')}</Label>
          <TagsInput tags={tags} onCommit={setTags} placeholder={tDeals('tagsPlaceholder')} />
        </div>

        <p className="text-xs text-muted-foreground">{t('newHint')}</p>
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => router.back()}
            disabled={isPending}
          >
            {tCommon('cancel')}
          </Button>
          <Button type="button" className="flex-[2]" onClick={save} disabled={!canSave}>
            {isPending ? tCommon('saving') : t('newSave')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
