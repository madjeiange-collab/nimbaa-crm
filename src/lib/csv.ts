'use client';

type Cell = string | number | null | undefined;

/** Trigger a client-side CSV download (Excel-friendly UTF-8 BOM). */
export function downloadCsv(filename: string, rows: Cell[][]): void {
  const esc = (v: Cell) => {
    const s = v == null ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const content = rows.map((r) => r.map(esc).join(',')).join('\n');
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
