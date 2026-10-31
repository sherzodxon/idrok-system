// Normalisation used for matching imported names, topics and phone numbers.

const APOSTROPHES = /[‘’ʻʼ`´']/g;

/** Trim, lower-case (Uzbek-aware), unify apostrophe variants (o‘ o' o` oʻ), collapse whitespace. */
export function normalizeText(value: string): string {
  return value.normalize("NFC").replace(APOSTROPHES, "'").toLocaleLowerCase("uz").replace(/\s+/g, " ").trim();
}

/** Person name as displayed: single spaces, unified apostrophes, original case kept. */
export function cleanName(value: string): string {
  return value.normalize("NFC").replace(APOSTROPHES, "ʻ").replace(/\s+/g, " ").trim();
}

/**
 * Uzbek phone numbers to E.164 (+998XXXXXXXXX). Accepts "+998 90 123-45-67", "998901234567", "90 123 45 67",
 * "8 90 1234567" (old trunk prefix). Returns null when the number is not a valid 9-digit national number.
 */
export function normalizeUzPhone(value: string): string | null {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("998")) digits = digits.slice(3);
  else if (digits.length === 10 && digits.startsWith("8")) digits = digits.slice(1);
  if (digits.length !== 9) return null;
  return `+998${digits}`;
}
