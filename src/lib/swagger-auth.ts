import { createHmac, timingSafeEqual } from "node:crypto";

export const SWAGGER_AUTH_COOKIE = "wa_akg_swagger_auth";
export const SWAGGER_AUTH_MAX_AGE_SECONDS = 60 * 60;

function getSigningSecret(): string | null {
    const secret = process.env.AUTH_SECRET;
    return secret && secret.length >= 32 ? secret : null;
}

function signatureFor(timestamp: number, secret: string): string {
    return createHmac("sha256", secret)
        .update(`wa-akg-swagger:${timestamp}`)
        .digest("hex");
}

export function createSwaggerAuthToken(now = Date.now()): string | null {
    const secret = getSigningSecret();
    if (!secret) return null;

    const timestamp = Math.floor(now / 1000);
    return `${timestamp}.${signatureFor(timestamp, secret)}`;
}

export function isValidSwaggerAuthToken(token: string | undefined, now = Date.now()): boolean {
    if (!token) return false;

    const separator = token.indexOf(".");
    if (separator <= 0) return false;

    const timestampText = token.slice(0, separator);
    const suppliedSignature = token.slice(separator + 1);
    if (!/^\d+$/.test(timestampText) || !/^[a-f0-9]{64}$/.test(suppliedSignature)) {
        return false;
    }

    const timestamp = Number(timestampText);
    const nowSeconds = Math.floor(now / 1000);
    if (!Number.isSafeInteger(timestamp) || timestamp > nowSeconds + 60) return false;
    if (nowSeconds - timestamp > SWAGGER_AUTH_MAX_AGE_SECONDS) return false;

    const secret = getSigningSecret();
    if (!secret) return false;

    const expected = Buffer.from(signatureFor(timestamp, secret), "hex");
    const supplied = Buffer.from(suppliedSignature, "hex");
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function constantTimeStringEqual(actual: string, expected: string): boolean {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length
        && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function getSwaggerCredentials(): { username: string; password: string } | null {
    // The NEXT_PUBLIC_* names are supported temporarily for existing Compose files.
    // Never read these values in client components or embed them in browser code.
    const username = process.env.SWAGGER_USERNAME || process.env.NEXT_PUBLIC_SWAGGER_USERNAME;
    const password = process.env.SWAGGER_PASSWORD || process.env.NEXT_PUBLIC_SWAGGER_PASSWORD;
    if (!username || !password) return null;
    return { username, password };
}
