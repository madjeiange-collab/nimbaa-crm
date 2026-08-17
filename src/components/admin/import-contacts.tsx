'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Upload, FileDown, Check } from 'lucide-react';
import { parseCsv } from '@/lib/csv/parse';
import { importContacts, type ImportRow, type ImportSummary } from '@/lib/admin/import-actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/** Import target fields, in display order. `name` or `phone` is required. */
const FIELDS = ['name', 'phone', 'address', 'territory', 'rep', 'tags', 'lat', 'lng'] as const;
type Field = (typeof FIELDS)[number];

/** Header auto-detection: first regex that matches wins. */
const AUTO: Record<Field, RegExp> = {
  name: /^(nom|name|client|contact|societe|société|entreprise|business)/i,
  phone: /^(phone|t[ée]l|mobile|num[ée]ro|gsm|portable)/i,
  address: /^(adresse|address|rue|quartier|localisation)/i,
  territory: /^(secteur|territo|zone|turf)/i,
  rep: /^(commercial|rep|vendeur|username|utilisateur|assign)/i,
  tags: /^(tags?|branche|cat[ée]gorie|type)/i,
  lat: /^(lat)/i,
  lng: /^(lng|lon|long)/i,
};

const TEMPLATE =
  'name;phone;address;secteur;commercial;tags\n' +
  'Boutique Exemple;+225 07 00 00 00 00;Rue des Jardins, Cocody;Abidjan Nord;kofi;boutique\n' +
  'Pharmacie Demo;+225 05 11 22 33 44;Bd Lagunaire, Treichville;Abidjan Sud;awa;pharmacie';

export function ImportContacts({
  territoryNames,
  repUsernames,
}: {
  territoryNames: string[];
  repUsernames: string[];
}) {
  const t = useTranslations('adminImport');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<Field, number>>({
    name: -1, phone: -1, address: -1, territory: -1, rep: -1, tags: -1, lat: -1, lng: -1,
  });
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function onFile(f: File | undefined) {
    if (!f) return;
    setResult(null);
    setError(null);
    const parsed = parseCsv(await f.text());
    if (parsed.length < 2) {
      setError(t('errorNoRows'));
      setHeaders([]);
      setRows([]);
      return;
    }
    const hdr = parsed[0].map((h) => h.trim());
    setFileName(f.name);
    setHeaders(hdr);
    setRows(parsed.slice(1));
    const next = { name: -1, phone: -1, address: -1, territory: -1, rep: -1, tags: -1, lat: -1, lng: -1 };
    for (const field of FIELDS) {
      const idx = hdr.findIndex((h) => AUTO[field].test(h));
      // Don't map two fields onto the same column.
      if (idx >= 0 && !Object.values(next).includes(idx)) next[field] = idx;
    }
    setMapping(next);
  }

  const ready = mapping.name >= 0 || mapping.phone >= 0;
  const preview = useMemo(() => rows.slice(0, 5), [rows]);

  const cell = (row: string[], field: Field) =>
    mapping[field] >= 0 ? (row[mapping[field]] ?? '').trim() : '';

  function buildRows(): ImportRow[] {
    return rows.map((r) => ({
      name: cell(r, 'name') || null,
      phone: cell(r, 'phone') || null,
      address: cell(r, 'address') || null,
      lat: mapping.lat >= 0 ? Number(cell(r, 'lat').replace(',', '.')) || null : null,
      lng: mapping.lng >= 0 ? Number(cell(r, 'lng').replace(',', '.')) || null : null,
      territory: cell(r, 'territory') || null,
      rep: cell(r, 'rep') || null,
      tags: cell(r, 'tags') ? cell(r, 'tags').split(/[|,]/) : [],
    }));
  }

  function onImport() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const all = buildRows();
      const total: ImportSummary = {
        inserted: 0, duplicates: 0, invalid: 0, unknownTerritories: [], unknownReps: [],
      };
      // Serial chunks keep each server action call well under limits.
      for (let i = 0; i < all.length; i += 1000) {
        const res = await importContacts(all.slice(i, i + 1000));
        if (!res.ok) {
          setError(t(`error_${res.error}` as Parameters<typeof t>[0]));
          return;
        }
        total.inserted += res.inserted;
        total.duplicates += res.duplicates;
        total.invalid += res.invalid;
        total.unknownTerritories = [...new Set([...total.unknownTerritories, ...res.unknownTerritories])];
        total.unknownReps = [...new Set([...total.unknownReps, ...res.unknownReps])];
      }
      setResult(total);
      setHeaders([]);
      setRows([]);
      setFileName(null);
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex min-h-touch cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              <Upload className="h-4 w-4" />
              {t('chooseFile')}
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </label>
            <a
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
              download="contacts-template.csv"
              className="inline-flex items-center gap-1.5 text-sm text-primary underline"
            >
              <FileDown className="h-4 w-4" />
              {t('template')}
            </a>
          </div>
          {fileName && (
            <p className="text-sm">
              <span className="font-medium">{fileName}</span> — {t('rowCount', { count: rows.length })}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {t('knownTerritories')}: {territoryNames.join(', ') || '—'}
            <br />
            {t('knownReps')}: {repUsernames.join(', ') || '—'}
          </p>
        </CardContent>
      </Card>

      {headers.length > 0 && (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <p className="text-sm font-semibold">{t('mappingTitle')}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {FIELDS.map((f) => (
                <div key={f} className="space-y-1">
                  <label className="text-xs font-medium">
                    {t(`field_${f}`)}
                    {(f === 'name' || f === 'phone') && ' *'}
                  </label>
                  <select
                    value={mapping[f]}
                    onChange={(e) => setMapping({ ...mapping, [f]: Number(e.target.value) })}
                    className="flex min-h-touch w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value={-1}>—</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `#${i + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            {!ready && <p className="text-sm font-medium text-destructive">{t('needNameOrPhone')}</p>}

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    {FIELDS.filter((f) => mapping[f] >= 0).map((f) => (
                      <th key={f} className="py-1 pr-3 font-medium">{t(`field_${f}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      {FIELDS.filter((f) => mapping[f] >= 0).map((f) => (
                        <td key={f} className="py-1 pr-3">{cell(r, f) || '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Button onClick={onImport} disabled={!ready || isPending} size="lg" className="w-full">
              {isPending ? t('importing') : t('importN', { count: rows.length })}
            </Button>
          </CardContent>
        </Card>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">{error}</p>
      )}
      {result && (
        <Card>
          <CardContent className="space-y-1.5 pt-4 text-sm">
            <p className="flex items-center gap-1.5 font-semibold text-knock-green">
              <Check className="h-4 w-4" />
              {t('doneInserted', { count: result.inserted })}
            </p>
            {result.duplicates > 0 && <p>{t('doneDuplicates', { count: result.duplicates })}</p>}
            {result.invalid > 0 && <p>{t('doneInvalid', { count: result.invalid })}</p>}
            {result.unknownTerritories.length > 0 && (
              <p className="text-muted-foreground">
                {t('doneUnknownTerritories')}: {result.unknownTerritories.join(', ')}
              </p>
            )}
            {result.unknownReps.length > 0 && (
              <p className="text-muted-foreground">
                {t('doneUnknownReps')}: {result.unknownReps.join(', ')}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
