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
