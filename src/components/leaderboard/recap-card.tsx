'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

const COLLAPSE_THRESHOLD = 420; // chars — short recaps render fully

/**
 * Recap/brief card: long content starts collapsed (with a fade) and expands
 * on demand, so the daily brief never swallows the whole screen.
 */
export function RecapCard({
  title,
  dateLabel,
  content,
  action,
}: {
  title: string;
  dateLabel?: string | null;
  content: string | null;
  action?: ReactNode;
}) {
  const t = useTranslations('leaderboard');
  const [expanded, setExpanded] = useState(false);
  const collapsible = (content?.length ?? 0) > COLLAPSE_THRESHOLD;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="pt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" />
            {title}
            {dateLabel && (
              <span className="truncate font-normal text-muted-foreground">· {dateLabel}</span>
            )}
          </p>
          {action}
        </div>

        {content ? (
          <>
            <div className="relative">
              <p
                className={`whitespace-pre-wrap text-sm ${
                  collapsible && !expanded ? 'max-h-44 overflow-hidden' : ''
                }`}
              >
                {content}
              </p>
              {collapsible && !expanded && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[hsl(var(--card))]/0 via-transparent to-transparent" style={{ background: 'linear-gradient(to bottom, transparent, hsl(var(--background)) 95%)' }} />
              )}
            </div>
            {collapsible && (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="mt-2 flex items-center gap-1 text-sm font-medium text-primary"
              >
                {expanded ? (
                  <>
                    <ChevronUp className="h-4 w-4" /> {t('recapCollapse')}
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-4 w-4" /> {t('recapExpand')}
                  </>
                )}
              </button>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        )}
      </CardContent>
    </Card>
  );
}
