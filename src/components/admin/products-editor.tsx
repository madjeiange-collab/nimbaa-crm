'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2, Eye, EyeOff, Check, X, Pencil } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { addProduct, updateProduct, deleteProduct } from '@/lib/products/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

export interface Product {
  id: string;
  name: string;
  price_xof: number;
  commission_pct: number;
  is_active: boolean;
  billing_interval?: string;
  commission_mode?: string;
  commission_months?: number;
}

const INTERVALS = ['one_time', 'daily', 'weekly', 'monthly'] as const;

/** Labeled product fields — shared by the add and edit forms. */
function ProductFields({
  t,
  idPrefix,
  name, setName,
  price, setPrice,
  pct, setPct,
  interval, setInterval,
  mode, setMode,
  months, setMonths,
}: {
  t: ReturnType<typeof useTranslations<'adminProducts'>>;
  idPrefix: string;
  name: string; setName: (v: string) => void;
  price: string; setPrice: (v: string) => void;
  pct: string; setPct: (v: string) => void;
  interval: string; setInterval: (v: string) => void;
  mode: string; setMode: (v: string) => void;
  months: string; setMonths: (v: string) => void;
}) {
  const selectCls =
    'flex min-h-touch w-full rounded-md border border-input bg-background px-2 text-sm';
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-name`}>{t('name')}</Label>
        <Input id={`${idPrefix}-name`} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('namePlaceholder')} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-price`}>{t('price')}</Label>
          <Input id={`${idPrefix}-price`} value={price} inputMode="numeric" onChange={(e) => setPrice(e.target.value)} placeholder="15000" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-pct`}>{t('commissionPct')}</Label>
          <Input id={`${idPrefix}-pct`} value={pct} inputMode="decimal" onChange={(e) => setPct(e.target.value)} placeholder="10" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-interval`}>{t('billing')}</Label>
          <select id={`${idPrefix}-interval`} value={interval} onChange={(e) => setInterval(e.target.value)} className={selectCls}>
            {INTERVALS.map((i) => (
              <option key={i} value={i}>{t(`billing_${i}` as never)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-mode`}>{t('commissionMode')}</Label>
          <select id={`${idPrefix}-mode`} value={mode} onChange={(e) => setMode(e.target.value)} className={selectCls}>
            <option value="once">{t('mode_once')}</option>
            <option value="recurring">{t('mode_recurring')}</option>
          </select>
        </div>
      </div>
      {mode === 'recurring' && (
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-months`}>{t('commissionMonths')}</Label>
          <Input id={`${idPrefix}-months`} value={months} inputMode="numeric" onChange={(e) => setMonths(e.target.value)} placeholder="3" />
          <p className="text-xs text-muted-foreground">{t('monthsHint')}</p>
        </div>
      )}
    </div>
  );
}

export function ProductsEditor({ products }: { products: Product[] }) {
  const t = useTranslations('adminProducts');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const [nName, setNName] = useState('');
  const [nPrice, setNPrice] = useState('');
  const [nPct, setNPct] = useState('');
  const [nInterval, setNInterval] = useState('one_time');
  const [nMode, setNMode] = useState('once');
  const [nMonths, setNMonths] = useState('3');

  const [editId, setEditId] = useState<string | null>(null);
  const [eName, setEName] = useState('');
  const [ePrice, setEPrice] = useState('');
  const [ePct, setEPct] = useState('');
  const [eInterval, setEInterval] = useState('one_time');
  const [eMode, setEMode] = useState('once');
  const [eMonths, setEMonths] = useState('3');

  function run(fn: () => Promise<unknown>) {
    setMsg(null);
    startTransition(async () => {
      await fn();
      router.refresh();
    });
  }
  const num = (s: string) => Number(s.replace(/[^0-9.]/g, '')) || 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>

      <Card>
        <CardContent className="space-y-2 pt-4">
          {products.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            products.map((p) => (
              <div
                key={p.id}
                className={`rounded-lg border p-2.5 ${p.is_active ? '' : 'opacity-50'}`}
              >
                {editId === p.id ? (
                  <div className="space-y-2">
                    <ProductFields
                      t={t}
                      idPrefix={`e-${p.id}`}
                      name={eName} setName={setEName}
                      price={ePrice} setPrice={setEPrice}
                      pct={ePct} setPct={setEPct}
                      interval={eInterval} setInterval={setEInterval}
                      mode={eMode} setMode={setEMode}
                      months={eMonths} setMonths={setEMonths}
                    />
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setEditId(null)} disabled={isPending}>
                        <X className="mr-1 h-4 w-4" /> {t('cancel')}
                      </Button>
                      <Button
                        size="sm"
                        disabled={isPending}
                        onClick={() =>
                          run(async () => {
                            await updateProduct(p.id, {
                              name: eName,
                              priceXof: num(ePrice),
                              commissionPct: num(ePct),
                              billingInterval: eInterval,
                              commissionMode: eMode,
                              commissionMonths: num(eMonths) || 3,
                            });
                            setEditId(null);
                          })
                        }
                      >
                        <Check className="mr-1 h-4 w-4" /> {t('save')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.price_xof.toLocaleString('fr-FR')} XOF · {t(`billing_${p.billing_interval ?? 'one_time'}` as never)} ·{' '}
                        {t('commissionPct')} {p.commission_pct}%
                        {p.commission_mode === 'recurring' && ` ×${p.commission_months ?? 3} ${t('monthsShort')}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={t('edit')}
                      onClick={() => {
                        setEditId(p.id);
                        setEName(p.name);
                        setEPrice(String(p.price_xof));
                        setEPct(String(p.commission_pct));
                        setEInterval(p.billing_interval ?? 'one_time');
                        setEMode(p.commission_mode ?? 'once');
                        setEMonths(String(p.commission_months ?? 3));
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={p.is_active ? t('deactivate') : t('activate')}
                      disabled={isPending}
                      onClick={() => run(() => updateProduct(p.id, { isActive: !p.is_active }))}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {p.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      aria-label={t('delete')}
                      disabled={isPending}
                      onClick={() => run(() => deleteProduct(p.id))}
                      className="text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Add */}
      <Card>
        <CardContent className="space-y-2 pt-4">
          <Label className="text-sm font-semibold">{t('addProduct')}</Label>
          <ProductFields
            t={t}
            idPrefix="new"
            name={nName} setName={setNName}
            price={nPrice} setPrice={setNPrice}
            pct={nPct} setPct={setNPct}
            interval={nInterval} setInterval={setNInterval}
            mode={nMode} setMode={setNMode}
            months={nMonths} setMonths={setNMonths}
          />
          <Button
            disabled={isPending || !nName.trim()}
            onClick={() =>
              run(async () => {
                await addProduct(nName, num(nPrice), num(nPct), {
                  billingInterval: nInterval,
                  commissionMode: nMode,
                  commissionMonths: num(nMonths) || 3,
                });
                setNName('');
                setNPrice('');
                setNPct('');
                setNInterval('one_time');
                setNMode('once');
                setNMonths('3');
              })
            }
          >
            <Plus className="mr-1 h-4 w-4" /> {t('add')}
          </Button>
          {msg && <p className="text-sm text-destructive">{msg}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
