import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_MS = 30_000;

function decodeBase32(encoded: string): Buffer | null {
  if (!/^[A-Z2-7]{32,128}$/.test(encoded)) return null;
  const bytes: number[] = [];
  let remaining = 0;
  let value = 0;
  for (const character of encoded) {
    value = (value << 5) | BASE32.indexOf(character);
    remaining += 5;
    if (remaining >= 8) {
      remaining -= 8;
      bytes.push(value >> remaining);
      value &= (1 << remaining) - 1;
    }
  }
  return value === 0 ? Buffer.from(bytes) : null;
}

export function verifyAdminTotp(secret: string, code: string, now: number): number | null {
  if (!/^[0-9]{6}$/.test(code) || !Number.isSafeInteger(now) || now < STEP_MS) return null;
  const key = decodeBase32(secret);
  if (!key) return null;
  const step = Math.floor(now / STEP_MS);
  const provided = Buffer.from(code, "ascii");
  const buffer = Buffer.alloc(8);
  let matched: number | null = null;
  for (const candidate of [step - 1, step, step + 1]) {
    buffer.writeBigUInt64BE(BigInt(candidate));
    const digest = createHmac("sha1", key).update(buffer).digest();
    const offset = digest[digest.length - 1] & 15;
    const expected = ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
    if (timingSafeEqual(provided, Buffer.from(expected, "ascii"))) {
      if (matched !== null) return null;
      matched = candidate;
    }
  }
  return matched;
}

export function adminTotpClaimId(userId: string, step: number): string {
  return `admin-totp-${createHash("sha256").update(JSON.stringify([userId, step])).digest("hex")}`;
}
