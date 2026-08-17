'use client';

import { Input } from '@/components/ui/input';

/**
 * Phone input with a country-prefix dropdown (flag + ISO code), defaulting to
 * Côte d'Ivoire. The rep types only the local number; the stored value is
 * always full international format ("+225 0712345678"), so WhatsApp/tel
 * links work without guesswork. Pasting a "+"/"00"-prefixed number into the
 * local field re-detects the country automatically.
 */
export interface Country {
  iso: string;
  flag: string;
  dial: string; // digits only, no '+'
}

// Côte d'Ivoire first, then neighbours/diaspora — ordered by expected use.
export const COUNTRIES: Country[] = [
  { iso: 'CI', flag: '🇨🇮', dial: '225' },
  { iso: 'GH', flag: '🇬🇭', dial: '233' },
  { iso: 'BF', flag: '🇧🇫', dial: '226' },
  { iso: 'ML', flag: '🇲🇱', dial: '223' },
  { iso: 'SN', flag: '🇸🇳', dial: '221' },
  { iso: 'GN', flag: '🇬🇳', dial: '224' },
  { iso: 'LR', flag: '🇱🇷', dial: '231' },
  { iso: 'TG', flag: '🇹🇬', dial: '228' },
  { iso: 'BJ', flag: '🇧🇯', dial: '229' },
  { iso: 'NE', flag: '🇳🇪', dial: '227' },
  { iso: 'NG', flag: '🇳🇬', dial: '234' },
  { iso: 'CM', flag: '🇨🇲', dial: '237' },
  { iso: 'MA', flag: '🇲🇦', dial: '212' },
  { iso: 'FR', flag: '🇫🇷', dial: '33' },
  { iso: 'DE', flag: '🇩🇪', dial: '49' },
  { iso: 'GB', flag: '🇬🇧', dial: '44' },
  { iso: 'US', flag: '🇺🇸', dial: '1' },
];

const DEFAULT_ISO = 'CI';

/** Splits a stored value into country + local part (default CI). */
export function splitPhone(value: string): { country: Country; local: string } {
  let v = value.trim();
  if (v.startsWith('00')) v = `+${v.slice(2)}`;
  if (v.startsWith('+')) {
    const digits = v.slice(1).replace(/[^0-9]/g, '');
    // Longest dial code first so +226 doesn't match +22, etc.
    const match = [...COUNTRIES]
      .sort((a, b) => b.dial.length - a.dial.length)
      .find((c) => digits.startsWith(c.dial));
    if (match) return { country: match, local: digits.slice(match.dial.length) };
  }
  return {
    country: COUNTRIES.find((c) => c.iso === DEFAULT_ISO)!,
    local: value.replace(/[^0-9]/g, ''),
  };
}

/** Joins country + local into the stored international format. */
export function joinPhone(country: Country, local: string): string {
  const digits = local.replace(/[^0-9]/g, '');
  return digits ? `+${country.dial} ${digits}` : '';
}

export function PhoneInput({
  id,
  value,
  onChange,
  placeholder,
}: {
  id?: string;
  value: string;
  onChange: (full: string) => void;
  placeholder?: string;
}) {
  const { country, local } = splitPhone(value);

  function setCountry(iso: string) {
    const next = COUNTRIES.find((c) => c.iso === iso) ?? country;
    onChange(joinPhone(next, local));
  }

  function setLocal(raw: string) {
    // Pasted full international number → re-detect the country.
    if (raw.trim().startsWith('+') || raw.trim().startsWith('00')) {
      const parsed = splitPhone(raw);
      onChange(joinPhone(parsed.country, parsed.local));
      return;
    }
    onChange(joinPhone(country, raw));
  }

  return (
    <div className="flex gap-2">
      <select
        value={country.iso}
        onChange={(e) => setCountry(e.target.value)}
        aria-label="Indicatif pays"
        className="flex min-h-touch w-[7.5rem] shrink-0 rounded-md border border-input bg-background px-2 text-sm"
      >
        {COUNTRIES.map((c) => (
          <option key={c.iso} value={c.iso}>
            {c.flag} {c.iso} +{c.dial}
          </option>
        ))}
      </select>
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder ?? '07 12 34 56 78'}
        className="flex-1"
      />
    </div>
  );
}
