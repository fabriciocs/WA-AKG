import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { prisma } from "@/lib/prisma";
import { validatePublicClientMetadata } from "./dcr-registration";
import { OAuthError, type OAuthClientRecord } from "./types";
import { getClient } from "./service";

const MAX_METADATA_BYTES = 16 * 1024;
// Keep URL IDs within the MySQL unique-indexed OAuthClient.clientId column limit.
const MAX_URL_LENGTH = 191;
const FETCH_TIMEOUT_MS = 5000;
const CIMD_DESCRIPTION = "CIMD client (HTTPS client_id metadata document)";
const ALL_SCOPES = ["api:read", "api:write", "mcp:read", "mcp:write", "sessions:read"];

function reject(message: string): never {
  throw new OAuthError(message, "invalid_client", 400);
}

export function isCimdClientId(value: string): boolean {
  return value.startsWith("https://");
}

export function validateCimdUrl(value: string): URL {
  if (!isCimdClientId(value) || value.length > MAX_URL_LENGTH) return reject("CIMD client_id must be an HTTPS URL");
  // Reject encoded path delimiters/dot segments before URL parsing normalizes them.
  if (/%2e|%2f|%5c/i.test(value) || /\/(?:\.|\.\.)(?:\/|$)/.test(value)) return reject("Unsafe CIMD URL path");
  let url: URL;
  try { url = new URL(value); } catch { return reject("Invalid CIMD client_id URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      url.pathname === "/" || url.port || isIP(url.hostname) !== 0 ||
      !/^[a-z0-9.-]+$/i.test(url.hostname) || !url.hostname.includes(".") ||
      url.hostname.endsWith(".") || url.hostname.split(".").some((part) => !part || part.startsWith("-") || part.endsWith("-"))) {
    return reject("CIMD requires a public HTTPS hostname and document path on port 443");
  }
  return url;
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function ipv6Groups(address: string): number[] | null {
  // Exclude IPv4-mapped, local, transitional and malformed addresses.
  if (!/^[0-9a-f:]+$/i.test(address)) return null;
  const chunks = address.toLowerCase().split("::");
  if (chunks.length > 2) return null;
  const left = chunks[0] ? chunks[0].split(":") : [];
  const right = chunks.length === 2 && chunks[1] ? chunks[1].split(":") : [];
  if (left.concat(right).some((chunk) => !/^[0-9a-f]{1,4}$/.test(chunk))) return null;
  const missing = 8 - left.length - right.length;
  if ((chunks.length === 1 && missing !== 0) || (chunks.length === 2 && missing < 1)) return null;
  return [...left, ...Array(missing).fill("0"), ...right].map((part) => parseInt(part, 16));
}

export function isPublicCimdAddress(address: string): boolean {
  if (isIP(address) === 4) return isPublicIpv4(address);
  if (isIP(address) !== 6) return false;
  const groups = ipv6Groups(address);
  if (!groups) return false;
  const [first, second] = groups;
  // Permit regular global unicast, reject special-use, transition and documentation prefixes.
  return first >= 0x2000 && first < 0x4000 &&
    !(first === 0x2001 && second < 0x0200) &&
    !(first === 0x2001 && second === 0x0db8) &&
    first !== 0x2002 &&
    !(first === 0x3fff && second < 0x1000);
}

export async function fetchCimdDocument(clientId: string): Promise<unknown> {
  const url = validateCimdUrl(clientId);
  let addresses: { address: string; family: number }[];
  try { addresses = await lookup(url.hostname, { all: true, verbatim: true }); }
  catch { return reject("CIMD hostname resolution failed"); }
  if (!addresses.length || addresses.some(({ address }) => !isPublicCimdAddress(address))) {
    return reject("CIMD hostname must resolve only to public IP addresses");
  }
  const pinned = addresses[0];
  return new Promise((resolve, fail) => {
    const req = httpsRequest(url, {
      method: "GET", headers: { Accept: "application/json" }, timeout: FETCH_TIMEOUT_MS,
      lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
    }, (response) => {
      if (response.statusCode !== 200) { response.destroy(); fail(new Error("HTTP status is not 200")); return; }
      const mediaType = (response.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
      if (!/^application\/(?:json|[a-z0-9.+-]+\+json)$/.test(mediaType)) {
        response.destroy(); fail(new Error("CIMD content type is not JSON")); return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_METADATA_BYTES) { response.destroy(new Error("CIMD document exceeds size limit")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { fail(new Error("CIMD document is not valid JSON")); }
      });
      response.on("error", fail);
    });
    req.on("timeout", () => req.destroy(new Error("CIMD request timed out")));
    req.on("error", fail);
    req.end();
  }).catch(() => reject("Unable to retrieve a valid CIMD metadata document"));
}

export function validateCimdDocument(clientId: string, document: unknown) {
  validateCimdUrl(clientId);
  if (!document || typeof document !== "object" || Array.isArray(document)) return reject("Invalid CIMD document");
  const raw = document as Record<string, unknown>;
  if (raw.client_id !== clientId) return reject("CIMD client_id does not match the metadata URL");
  if (raw.client_secret !== undefined || raw.client_secret_expires_at !== undefined ||
      raw.jwks !== undefined || raw.jwks_uri !== undefined) {
    return reject("CIMD shared secrets and unsupported client authentication keys are not accepted");
  }
  // Published clients may advertise grants unsupported by this authorization server.
  // Claude Web advertises the JWT bearer grant alongside authorization_code; never
  // enable that grant, but do allow the shared authorization-code flow to proceed.
  const advertisedGrants = raw.grant_types;
  if (advertisedGrants !== undefined &&
      (!Array.isArray(advertisedGrants) || advertisedGrants.length > 16 ||
       advertisedGrants.some((grant) => typeof grant !== "string" || grant.length > 256) ||
       new Set(advertisedGrants).size !== advertisedGrants.length)) {
    return reject("Invalid CIMD grant_types metadata");
  }
  const supportedGrants = Array.isArray(advertisedGrants)
    ? advertisedGrants.filter((grant) => grant === "authorization_code" || grant === "refresh_token")
    : undefined;
  if (supportedGrants && !supportedGrants.includes("authorization_code")) {
    return reject("CIMD must advertise authorization_code");
  }
  try {
    const metadata = validatePublicClientMetadata({
      ...raw,
      grant_types: supportedGrants,
      // CIMD clients may request supported scopes at consent time even if metadata omits scope.
      scope: raw.scope === undefined ? ALL_SCOPES.join(" ") : raw.scope,
    });
    return metadata;
  } catch {
    return reject("Invalid CIMD metadata: redirects, grant, auth method or scopes");
  }
}

export function createCimdClientResolver(dependencies: {
  fetchDocument?: (id: string) => Promise<unknown>;
  findClient?: typeof getClient;
  persist?: (input: {
    clientId: string; name: string; redirectUris: string[]; allowedScopes: string[];
    grantTypes: ("authorization_code" | "refresh_token")[];
  }) => Promise<OAuthClientRecord>;
} = {}) {
  const fetchDocument = dependencies.fetchDocument ?? fetchCimdDocument;
  const findClient = dependencies.findClient ?? getClient;
  const persist = dependencies.persist ?? (async (input) => {
    await prisma.oAuthClient.create({
      data: {
        clientId: input.clientId, name: input.name, description: CIMD_DESCRIPTION,
        redirectUris: input.redirectUris, allowedScopes: input.allowedScopes,
        grantTypes: input.grantTypes, isConfidential: false, createdById: null,
      },
    });
    const saved = await getClient(input.clientId);
    if (!saved) return reject("CIMD registration could not be confirmed");
    return saved;
  });

  return async function resolveCimdClient(clientId: string): Promise<OAuthClientRecord> {
    validateCimdUrl(clientId);
    // Always validate published metadata before authorizing; never trust a stale cached document.
    const metadata = validateCimdDocument(clientId, await fetchDocument(clientId));
    const existing = await findClient(clientId);
    if (existing) {
      if (!existing.isActive || existing.isConfidential || !existing.clientId.startsWith("https://")) {
        return reject("CIMD client is disabled or conflicts with a registered client");
      }
      // Only the intersection of stored and freshly published permissions can be authorized.
      const redirectUris = metadata.redirectUris.filter((uri) => existing.redirectUris.includes(uri));
      const allowedScopes = metadata.allowedScopes.filter((scope) => existing.allowedScopes.includes(scope));
      if (!redirectUris.length) return reject("CIMD redirect URIs have changed; administrator review required");
      return { ...existing, name: metadata.name, redirectUris, allowedScopes };
    }
    try {
      return await persist({
        clientId, name: metadata.name, redirectUris: metadata.redirectUris,
        allowedScopes: metadata.allowedScopes, grantTypes: metadata.grantTypes,
      });
    } catch (error) {
      // Another request may have inserted the same URL concurrently.
      const concurrent = await findClient(clientId);
      if (concurrent && concurrent.isActive && !concurrent.isConfidential) {
        return { ...concurrent, redirectUris: metadata.redirectUris.filter((uri) => concurrent.redirectUris.includes(uri)),
          allowedScopes: metadata.allowedScopes.filter((scope) => concurrent.allowedScopes.includes(scope)) };
      }
      throw error;
    }
  };
}

export const resolveCimdClient = createCimdClientResolver();
