'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { UserPlus, Pencil, KeyRound, Check, X, Power } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import {
  createUser,
  updateUser,
  resetUserPassword,
  setUserActive,
  type ActionResult,
} from '@/lib/admin/users-actions';
import type { UserRole } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

export interface AdminUser {
  id: string;
  username: string | null;
  full_name: string | null;
  role: UserRole;
  can_do_b2b: boolean;
  can_do_d2d: boolean;
  daily_goal?: number | null;
  is_active: boolean;
}

const ROLES: UserRole[] = ['rep', 'technician', 'manager', 'admin'];

export function UsersManager({
  users,
  currentUserId,
}: {
  users: AdminUser[];
  currentUserId: string;
}) {
  const t = useTranslations('adminUsers');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [cUsername, setCUsername] = useState('');
  const [cFullName, setCFullName] = useState('');
  const [cPassword, setCPassword] = useState('');
  const [cRole, setCRole] = useState<UserRole>('rep');
  const [cB2b, setCB2b] = useState(false);
  const [cD2d, setCD2d] = useState(true);

  // Per-row editing
  const [editId, setEditId] = useState<string | null>(null);
  const [eFullName, setEFullName] = useState('');
  const [eRole, setERole] = useState<UserRole>('rep');
  const [eB2b, setEB2b] = useState(false);
  const [eD2d, setED2d] = useState(false);
  const [eGoal, setEGoal] = useState('');
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState('');

  function roleLabel(r: UserRole) {
    return t(`role_${r}` as never);
  }

  function handle(fn: () => Promise<ActionResult>, okText: string, after?: () => void) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        setMsg({ kind: 'ok', text: okText });
        after?.();
        router.refresh();
      } else {
        const known = [
          'invalidUsername',
          'passwordTooShort',
          'usernameTaken',
          'cannotChangeOwnRole',
          'cannotDeactivateSelf',
        ];
        setMsg({ kind: 'error', text: known.includes(res.error) ? t(res.error as never) : t('error') });
      }
    });
  }

  function submitCreate() {
    handle(
      () =>
        createUser({
          username: cUsername,
          password: cPassword,
          fullName: cFullName,
          role: cRole,
          canB2b: cB2b,
          canD2d: cD2d,
        }),
      t('created'),
      () => {
        setCUsername('');
        setCFullName('');
        setCPassword('');
        setCRole('rep');
        setCB2b(false);
        setCD2d(true);
        setShowCreate(false);
      },
    );
  }

  function startEdit(u: AdminUser) {
    setResetId(null);
    setEditId(u.id);
    setEFullName(u.full_name ?? '');
    setERole(u.role);
    setEB2b(u.can_do_b2b);
    setED2d(u.can_do_d2d);
    setEGoal(u.daily_goal ? String(u.daily_goal) : '');
  }

  return (
    <div className="space-y-4">
      {msg && (
        <div
          className={`rounded-md px-3 py-2 text-sm font-medium ${
            msg.kind === 'ok'
              ? 'bg-knock-green/15 text-knock-green'
              : 'bg-destructive/10 text-destructive'
          }`}
          role="status"
        >
          {msg.text}
        </div>
      )}

      {/* Create */}
      {!showCreate ? (
        <Button onClick={() => setShowCreate(true)}>
          <UserPlus className="mr-1 h-4 w-4" />
          {t('addUser')}
        </Button>
      ) : (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <p className="text-sm font-semibold">{t('addUser')}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="c-user">{t('username')}</Label>
                <Input id="c-user" value={cUsername} onChange={(e) => setCUsername(e.target.value)} autoCapitalize="none" placeholder="ex. amadou" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-name">{t('fullName')}</Label>
                <Input id="c-name" value={cFullName} onChange={(e) => setCFullName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-pass">{t('password')}</Label>
                <Input id="c-pass" value={cPassword} onChange={(e) => setCPassword(e.target.value)} placeholder="min. 8" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-role">{t('role')}</Label>
                <select
                  id="c-role"
                  value={cRole}
                  onChange={(e) => setCRole(e.target.value as UserRole)}
                  className="flex min-h-touch w-full rounded-md border border-input bg-background px-3 text-base"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {(cRole === 'rep') && (
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={cD2d} onChange={(e) => setCD2d(e.target.checked)} />
                  {t('capD2d')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={cB2b} onChange={(e) => setCB2b(e.target.checked)} />
                  {t('capB2b')}
                </label>
              </div>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  // Cancel discards: reopening the form must start clean.
                  setShowCreate(false);
                  setCUsername('');
                  setCFullName('');
                  setCPassword('');
                  setCRole('rep');
                  setCB2b(false);
                  setCD2d(true);
                }}
                disabled={isPending}
              >
                {t('cancel')}
              </Button>
              <Button onClick={submitCreate} disabled={isPending}>
                {isPending ? t('creating') : t('create')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* List */}
      <div className="space-y-2">
        {users.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">{t('noUsers')}</Card>
        ) : (
          users.map((u) => (
            <Card key={u.id} className={u.is_active ? '' : 'opacity-60'}>
              <CardContent className="space-y-3 pt-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">
                      {u.full_name || u.username || '—'}
                      {u.id === currentUserId && (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">({t('you')})</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      @{u.username ?? '—'} · {roleLabel(u.role)}
                      {u.role === 'rep' && (u.can_do_d2d || u.can_do_b2b)
                        ? ` · ${[u.can_do_d2d ? t('capD2d') : null, u.can_do_b2b ? t('capB2b') : null].filter(Boolean).join(', ')}`
                        : ''}
                      {!u.is_active ? ` · ${t('inactive')}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      aria-label={t('edit')}
                      onClick={() => startEdit(u)}
                      className="rounded-md p-2 text-muted-foreground hover:bg-accent"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={t('resetPassword')}
                      onClick={() => {
                        setEditId(null);
                        setResetId(u.id);
                        setResetPw('');
                      }}
                      className="rounded-md p-2 text-muted-foreground hover:bg-accent"
                    >
                      <KeyRound className="h-4 w-4" />
                    </button>
                    {u.id !== currentUserId && (
                      <button
                        type="button"
                        aria-label={u.is_active ? t('deactivate') : t('activate')}
                        disabled={isPending}
                        onClick={() => handle(() => setUserActive(u.id, !u.is_active), t('saved'))}
                        className={`rounded-md p-2 hover:bg-accent ${u.is_active ? 'text-destructive' : 'text-knock-green'}`}
                      >
                        <Power className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Edit panel */}
                {editId === u.id && (
                  <div className="space-y-3 rounded-md border p-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label>{t('fullName')}</Label>
                        <Input value={eFullName} onChange={(e) => setEFullName(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label>{t('role')}</Label>
                        <select
                          value={eRole}
                          onChange={(e) => setERole(e.target.value as UserRole)}
                          disabled={u.id === currentUserId}
                          className="flex min-h-touch w-full rounded-md border border-input bg-background px-3 text-base disabled:opacity-50"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {roleLabel(r)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {eRole === 'rep' && (
                      <div className="flex flex-wrap gap-4">
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={eD2d} onChange={(e) => setED2d(e.target.checked)} />
                          {t('capD2d')}
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={eB2b} onChange={(e) => setEB2b(e.target.checked)} />
                          {t('capB2b')}
                        </label>
                      </div>
                    )}
                    {eRole === 'rep' && (
                      <div className="space-y-1">
                        <Label className="text-xs">{t('dailyGoal')}</Label>
                        <Input
                          type="number"
                          min={1}
                          max={200}
                          inputMode="numeric"
                          value={eGoal}
                          onChange={(e) => setEGoal(e.target.value)}
                          placeholder={t('dailyGoalPlaceholder')}
                        />
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setEditId(null)} disabled={isPending}>
                        <X className="mr-1 h-4 w-4" />
                        {t('cancel')}
                      </Button>
                      <Button
                        size="sm"
                        disabled={isPending}
                        onClick={() =>
                          handle(
                            () => updateUser(u.id, { fullName: eFullName, role: eRole, canB2b: eB2b, canD2d: eD2d, dailyGoal: eGoal ? Number(eGoal) : null }),
                            t('saved'),
                            () => setEditId(null),
                          )
                        }
                      >
                        <Check className="mr-1 h-4 w-4" />
                        {t('save')}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Reset password panel */}
                {resetId === u.id && (
                  <div className="space-y-2 rounded-md border p-3">
                    <Label>{t('newPassword')}</Label>
                    <Input value={resetPw} onChange={(e) => setResetPw(e.target.value)} placeholder="min. 8" />
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setResetId(null)} disabled={isPending}>
                        {t('cancel')}
                      </Button>
                      <Button
                        size="sm"
                        disabled={isPending || resetPw.length < 8}
                        onClick={() =>
                          handle(() => resetUserPassword(u.id, resetPw), t('saved'), () => {
                            setResetId(null);
                            setResetPw('');
                          })
                        }
                      >
                        {t('resetPassword')}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
