/**
 * Amounts are integers in the currency's smallest unit, everywhere. XOF has no
 * subdivision, so 1500 is 1500 F; EUR has two, so 1500 is 12,50 €. The number
 * of decimals comes from core.currencies, never from a hardcoded assumption.
 */
export function formatMoney(
  amount: number,
  currency: string,
  decimals: number,
  locale = 'fr-FR',
) {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount / 10 ** decimals);
}

/**
 * The reverse, for a form field. Accepts "3500", "3 500", "12,50" and "12.50",
 * and returns minor units — or null if it is not a number at all.
 *
 * Rounding is the point: 12,507 € cannot be stored, and silently truncating it
 * to 12,50 loses a centime on every line. It rounds, once, here.
 */
export function parseMoney(input: string, decimals: number): number | null {
  const cleaned = input.replace(/\s| /g, '').replace(',', '.');
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '' || cleaned === '.') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 10 ** decimals);
}
