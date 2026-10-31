import { randomInt } from "node:crypto";
import argon2 from "argon2";
import { PASSWORD_MIN_LENGTH } from "@idrok/shared";

// OWASP minimum for argon2id: m=19 MiB, t=2, p=1.
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (plain: string) => argon2.hash(plain, OPTIONS);

/** Verified against a dummy hash when the user does not exist, so timing does not reveal valid usernames. */
let dummyHash: Promise<string> | undefined;
export async function verifyPassword(hash: string | null, plain: string): Promise<boolean> {
  if (!hash) {
    dummyHash ??= hashPassword("dummy-password-for-timing");
    await argon2.verify(await dummyHash, plain);
    return false;
  }
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** Rejects weak new passwords; returns the reason code or null. */
export function passwordProblem(password: string, username: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return "TOO_SHORT";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "NEEDS_LETTER_AND_DIGIT";
  if (password.toLowerCase().includes(username.toLowerCase())) return "CONTAINS_USERNAME";
  return null;
}

// No look-alike characters (0/O, 1/l/I) — temporary passwords are read from paper or a screen.
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Random temporary password shown once; the user must change it at first login. */
export function generateTemporaryPassword(length = 12): string {
  let out = "";
  while (!/\d/.test(out) || !/[a-zA-Z]/.test(out)) {
    out = Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  }
  return out;
}
