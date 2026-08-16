'use client';

import { useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Camera, Loader2, Trash2 } from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { useRouter } from '@/i18n/navigation';
import { updateMyAvatar, removeMyAvatar } from '@/lib/profile/avatar-actions';
import { Avatar } from '@/components/shared/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function AvatarUploader({
  url,
  name,
}: {
  url: string | null;
  name: string | null;
}) {
  const t = useTranslations('profile');
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(false);
    setBusy(true);
    try {
      // Square-ish, small: avatars never need more than ~512px.
      const compressed = await imageCompression(file, {
        maxWidthOrHeight: 512,
        maxSizeMB: 0.25,
        initialQuality: 0.85,
        useWebWorker: true,
        fileType: 'image/jpeg',
      });
      const form = new FormData();
      form.append('avatar', new File([compressed], 'avatar.jpg', { type: 'image/jpeg' }));
      const res = await updateMyAvatar(form);
      if (!res.ok) throw new Error(res.error);
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  function onRemove() {
    setError(false);
    startTransition(async () => {
      const res = await removeMyAvatar();
      if (!res.ok) setError(true);
      else router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="flex items-center gap-4 pt-4">
        <Avatar url={url} name={name} size={72} />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-semibold">{t('photoTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('photoHint')}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={busy || isPending}
            >
              {busy ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Camera className="mr-1.5 h-4 w-4" />
              )}
              {t('changePhoto')}
            </Button>
            {url && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onRemove}
                disabled={busy || isPending}
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                {t('removePhoto')}
              </Button>
            )}
          </div>
          {error && <p className="text-xs text-destructive">{t('photoError')}</p>}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onPick}
        />
      </CardContent>
    </Card>
  );
}
