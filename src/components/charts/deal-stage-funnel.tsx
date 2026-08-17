import { useTranslations } from 'next-intl';
import { Funnel } from '@/components/charts/funnel';
import { Card, CardContent } from '@/components/ui/card';

export interface FunnelStage {
  id: string;
  name: string;
  isWon: boolean;
  isLost: boolean;
}

export interface FunnelDeal {
  stageId: string | null;
  status: 'open' | 'won' | 'lost';
  valueXof: number | null;
}

const STAGE_COLORS = [
  'hsl(var(--knock-grey))',
  '#60a5fa',
  'hsl(var(--knock-yellow))',
  'hsl(var(--brand-amber))',
  '#8b5cf6',
  '#f97316',
];

/**
 * Deal-based funnel: OPEN deals per pipeline stage, plus the won/lost outcome
 * with the real deal conversion rate. Complements the visit-disposition
 * funnels (doors) with what actually sits in the pipeline (affaires).
 * Works in server and client components; money lines are opt-in.
 */
export function DealStageFunnel({
  stages,
  deals,
  showMoney = false,
}: {
  stages: FunnelStage[];
  deals: FunnelDeal[];
  showMoney?: boolean;
}) {
  const t = useTranslations('dealFunnel');

  const openStages = stages.filter((s) => !s.isWon && !s.isLost);
  const openByStage = new Map<string, { count: number; value: number }>();
  let won = 0;
  let lost = 0;
  let wonValue = 0;
  let pipelineValue = 0;
  for (const d of deals) {
    if (d.status === 'won') {
      won++;
      wonValue += d.valueXof ?? 0;
    } else if (d.status === 'lost') {
      lost++;
    } else {
      pipelineValue += d.valueXof ?? 0;
      const key = d.stageId ?? '';
      const cur = openByStage.get(key) ?? { count: 0, value: 0 };
      cur.count++;
      cur.value += d.valueXof ?? 0;
      openByStage.set(key, cur);
    }
  }
  const conversion = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null;
  const fcfa = (n: number) => `${n.toLocaleString('fr-FR')} FCFA`;

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <p className="text-sm font-semibold">{t('title')}</p>
        {deals.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <>
            <Funnel
              steps={openStages.map((s, i) => ({
                label: s.name,
                value: openByStage.get(s.id)?.count ?? 0,
                color: STAGE_COLORS[i % STAGE_COLORS.length],
              }))}
            />
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span className="font-medium text-knock-green">
                {t('won')}: {won}
                {showMoney && wonValue > 0 && ` (${fcfa(wonValue)})`}
              </span>
              <span className="font-medium text-knock-red">
                {t('lost')}: {lost}
              </span>
              {conversion != null && (
                <span className="font-medium">
                  {t('conversion')}: {conversion}%
                </span>
              )}
              {showMoney && (
                <span className="text-muted-foreground">
                  {t('pipelineValue')}: {fcfa(pipelineValue)}
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
