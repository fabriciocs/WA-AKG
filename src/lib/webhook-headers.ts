import { decryptData, encryptData } from "./crypto";
import { parseRequestHeaders } from "./security";

/** Stores validated webhook headers encrypted at rest. */
export function protectWebhookRequestHeaders(input: unknown): string | null {
    const headers = parseRequestHeaders(input);
    if (Object.keys(headers).length === 0) return null;
    return encryptData(JSON.stringify(headers));
}

/** Returns canonical multiline headers, accepting legacy plaintext rows. */
export function revealWebhookRequestHeaders(stored: string | null | undefined): string | null {
    if (!stored) return null;
    const plaintext = stored.startsWith("enc:v1:") ? decryptData(stored) : stored;
    let headerText = plaintext;
    if (plaintext.trimStart().startsWith("{")) {
        const decoded: unknown = JSON.parse(plaintext);
        if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
            throw new Error("Stored webhook headers are invalid");
        }
        headerText = Object.entries(decoded as Record<string, unknown>)
            .map(([name, value]) => `${name}: ${String(value)}`)
            .join("\n");
    }
    const headers = parseRequestHeaders(headerText);
    return Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join("\n") || null;
}
