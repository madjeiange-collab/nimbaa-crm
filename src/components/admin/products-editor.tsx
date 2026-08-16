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
}

export function ProductsEditor({ products }: { products: Product[] }) {
  const t = useTranslations('adminProducts');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const [nName, setNName] = useState('');
  const [nPrice, setNPrice] = useState('');
  const [nPct, setNPct] = useState('');

  const [editId, setEditId] = useState<string | null>(null);
  const [eName, setEName] = useState('');
  const [ePrice, setEPrice] = useState('');
  const [ePct, setEPct] = useState('');

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
                    <Input value={eName} onChange={(e) => setEName(e.target.value)} placeholder={t('name')} />
                    <div className="grid grid-cols-2 gap-2">
                      <Input value={ePrice} inputMode="numeric" onChange={(e) => setEPrice(e.target.value)} placeholder={t('price')} />
                      <Input value={ePct} inputMode="decimal" onChange={(e) => setEPct(e.target.value)} placeholder={t('commissionPct')} />
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setEditId(null)} disabled={isPending}>
                        <X className="mr-1 h-4 w-4" /> {t('cancel')}
                      </Button>
                      <Button
                        size="sm"
                        disabled={isPending}
                        onClick={() =>
                          run(async () => {
                            await updateProduct(p.id, { name: eName, priceXof: num(ePrice), commissionPct: num(ePct) });
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
                        {p.price_xof.toLocaleString('fr-FR')} XOF · {t('commissionPct')} {p.commission_pct}%
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
          <Input value={nName} onChange={(e) => setNName(e.target.value)} placeholder={t('name')} />
          <div className="grid grid-cols-2 gap-2">
            <Input value={nPrice} inputMode="numeric" onChange={(e) => setNPrice(e.target.value)} placeholder={t('price')} />
            <Input value={nPct} inputMode="decimal" onChange={(e) => setNPct(e.target.value)} placeholder={t('commissionPct')} />
          </div>
          <Button
            disabled={isPending || !nName.trim()}
            onClick={() =>
              run(async () => {
                await addProduct(nName, num(nPrice), num(nPct));
                setNName('');
                setNPrice('');
                setNPct('');
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
