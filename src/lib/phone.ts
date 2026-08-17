/**
 * Builds a wa.me link from a phone as entered in the field. WhatsApp requires
 * full international format, so local Ivorian numbers (10 digits, leading 0 —
 * e.g. "07 12 34 56 78") get the 225 country code prepended; numbers already
 * carrying a country code pass through unchanged.
 */
export function whatsappUrl(phone: string, text?: string): string {
  let digits = phone.replace(/[^0-9]/g, '');
  // "00" international dialing prefix → bare country code (0022507… → 22507…).
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!digits.startsWith('225') && digits.length === 10 && digits.startsWith('0')) {
    digits = `225${digits}`;
  }
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
