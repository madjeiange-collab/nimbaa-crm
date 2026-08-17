import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import { ProductsEditor, type Product } from '@/components/admin/products-editor';

export default async function AdminProductsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['admin']);
  const t = await getTranslations('admin');
  const tp = await getTranslations('adminProducts');

  const supabase = await createClient();
  const { data: products } = await supabase
    .from('products')
    .select('id, name, price_xof, commission_pct, is_active, billing_interval, commission_mode, commission_months, tech_commission_pct')
    .order('sort_order', { ascending: true });

  return (
    <>
      <AppHeader title={tp('title')} subtitle={tp('subtitle')} />
      <main className="mx-auto max-w-3xl space-y-3 p-4">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('title')}
        </Link>
        <ProductsEditor products={(products ?? []) as Product[]} />
      </main>
    </>
  );
}
