import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function generateRandomString(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function verifyToken(token: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !/^[a-f0-9]{64}$/i.test(storedHash)) return false;
  const expected = Buffer.from(storedHash, "hex");
  const actual = Buffer.from(hashToken(token), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function verifyCodeChallenge(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return false;
  const actual = createHash("sha256").update(verifier, "ascii").digest("base64url");
  const actualBytes = Buffer.from(actual, "ascii");
  const expectedBytes = Buffer.from(challenge, "ascii");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

/** OAuth redirect URIs are matched byte-for-byte after the URL parser accepts them. */
export function validateRedirectUri(requested: string, allowed: string[]): boolean {
  try {
    const url = new URL(requested);
    if (url.hash || url.username || url.password) return false;
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    const secure = url.protocol === "https:" || (local && url.protocol === "http:") || !["http:", "https:"].includes(url.protocol);
    if (!secure) return false;
    return allowed.includes(requested);
  } catch {
    // Custom URI schemes used by installed apps are not necessarily hierarchical URLs.
    return /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s#]+$/.test(requested) && allowed.includes(requested);
  }
}
