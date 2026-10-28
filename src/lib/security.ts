import dns from "dns";
import http from "http";
import https from "https";
import net from "net";

/** A DNS answer retained so the transport connects to the exact address validated. */
export type LookupAddress = { address: string; family: number };

/**
 * Checks whether an address is non-global or reserved. This is deliberately
 * fail-closed: addresses that cannot be parsed are unsafe.
 */
export function isPrivateOrReservedIp(input: string): boolean {
    const ip = input.replace(/^\[|\]$/g, "");
    const family = net.isIP(ip);
    if (family === 4) {
        const parts = ip.split(".").map(Number);
        const value = parts.reduce((acc, part) => acc * 256 + part, 0);
        const inCidr = (network: string, prefix: number) => {
            const base = network.split(".").map(Number).reduce((acc, part) => acc * 256 + part, 0);
            const mask = prefix === 0 ? 0 : Math.floor(0x100000000 / (2 ** (32 - prefix))) * (2 ** (32 - prefix)) - (2 ** (32 - prefix));
            return (value & mask) === (base & mask);
        };
        const nonGlobal = [
            ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
            ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
            ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24],
            ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
            ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
        ] as const;
        return nonGlobal.some(([network, prefix]) => inCidr(network, prefix));
    }

    if (family !== 6) return true;
    const groups = parseIpv6(ip);
    if (!groups) return true;

    // IPv4-mapped IPv6 can encode private IPv4 destinations.
    if (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff) {
        const mappedV4 = `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
        return isPrivateOrReservedIp(mappedV4);
    }

    // Only global-unicast 2000::/3 is allowed; deny special-purpose blocks.
    if ((groups[0] & 0xe000) !== 0x2000) return true;
    if (groups[0] === 0x2001 && groups[1] <= 0x01ff) return true; // IETF special-use
    if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true; // Documentation
    if (groups[0] === 0x2002) return true; // 6to4 embeds IPv4
    return false;
}

function parseIpv6(input: string): number[] | null {
    let address = input.toLowerCase();
    if (address.includes(".")) {
        const lastColon = address.lastIndexOf(":");
        if (lastColon < 0) return null;
        const v4 = address.slice(lastColon + 1);
        if (net.isIP(v4) !== 4) return null;
        const [a, b, c, d] = v4.split(".").map(Number);
        address = `${address.slice(0, lastColon)}:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
    }

    const halves = address.split("::");
    if (halves.length > 2) return null;
    const left = halves[0] ? halves[0].split(":") : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    if ([...left, ...right].some(part => !/^[0-9a-f]{1,4}$/.test(part))) return null;
    const missing = 8 - left.length - right.length;
    if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
    return [...left.map(part => parseInt(part, 16)), ...Array(missing).fill(0), ...right.map(part => parseInt(part, 16))];
}

/**
 * Returns true only for the local destinations that may be explicitly opted
 * into by a caller. Link-local, metadata, multicast and other special-purpose
 * ranges intentionally remain excluded even when local access is enabled.
 */
export function isExplicitlyAllowedLocalIp(input: string): boolean {
    const ip = input.replace(/^\[|\]$/g, "");
    const family = net.isIP(ip);

    if (family === 4) {
        const parts = ip.split(".").map(Number);
        const value = parts.reduce((acc, part) => acc * 256 + part, 0);
        const inCidr = (network: string, prefix: number) => {
            const base = network.split(".").map(Number).reduce((acc, part) => acc * 256 + part, 0);
            const mask = prefix === 0 ? 0 : Math.floor(0x100000000 / (2 ** (32 - prefix))) * (2 ** (32 - prefix)) - (2 ** (32 - prefix));
            return (value & mask) === (base & mask);
        };
        const localRanges = [
            ["127.0.0.0", 8],
            ["10.0.0.0", 8],
            ["172.16.0.0", 12],
            ["192.168.0.0", 16],
        ] as const;
        return localRanges.some(([network, prefix]) => inCidr(network, prefix));
    }

    if (family !== 6) return false;
    const groups = parseIpv6(ip);
    if (!groups) return false;

    // IPv4-mapped IPv6 can encode an explicitly allowed local IPv4 address.
    if (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff) {
        const mappedV4 = `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
        return isExplicitlyAllowedLocalIp(mappedV4);
    }

    return groups.slice(0, 7).every(group => group === 0) && groups[7] === 1;
}

export const MAX_REQUEST_HEADER_COUNT = 50;
export const MAX_REQUEST_HEADERS_BYTES = 16 * 1024;
export const MAX_REQUEST_HEADER_NAME_BYTES = 256;
export const MAX_REQUEST_HEADER_VALUE_BYTES = 8 * 1024;

/** HTTP field-name token syntax from RFC 9110. */
const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Headers controlled by the transport and never accepted from configuration. */
export const PROTECTED_REQUEST_HEADERS = new Set([
    "connection",
    "content-length",
    "content-type",
    "host",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "user-agent",
    "x-webhook-signature",
]);

export type ParsedRequestHeaders = Record<string, string>;

/**
 * Parses user-controlled HTTP headers supplied as one `Name: value` per line.
 * The parser is deliberately strict because the result is passed to Node's
 * HTTP client and must not provide a way to smuggle or override transport
 * headers.
 */
export function parseRequestHeaders(input: unknown): ParsedRequestHeaders {
    if (input === undefined || input === null) return {};
    if (typeof input !== "string") throw new TypeError("requestHeaders must be a text value");
    if (input.trim() === "") return {};
    if (input.includes("\r")) throw new Error("requestHeaders must not contain CRLF or carriage returns");
    if (Buffer.byteLength(input, "utf8") > MAX_REQUEST_HEADERS_BYTES) {
        throw new Error(`requestHeaders exceed the maximum permitted size of ${MAX_REQUEST_HEADERS_BYTES} bytes`);
    }

    const parsed: ParsedRequestHeaders = {};
    const names = new Set<string>();
    let count = 0;

    for (const line of input.split("\n")) {
        if (line.trim() === "") continue;
        count++;
        if (count > MAX_REQUEST_HEADER_COUNT) {
            throw new Error(`requestHeaders exceed the maximum of ${MAX_REQUEST_HEADER_COUNT} headers`);
        }

        const separator = line.indexOf(":");
        if (separator <= 0) throw new Error("Each request header must use the format 'Name: value'");
        const name = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        const normalizedName = name.toLowerCase();

        if (!HTTP_TOKEN.test(name)) throw new Error(`Invalid HTTP header name '${name}'`);
        if (PROTECTED_REQUEST_HEADERS.has(normalizedName)) {
            throw new Error(`Header '${name}' is controlled by the webhook transport`);
        }
        if (names.has(normalizedName)) throw new Error(`Duplicate request header '${name}'`);
        if (Buffer.byteLength(name, "utf8") > MAX_REQUEST_HEADER_NAME_BYTES) {
            throw new Error(`Request header name '${name}' is too long`);
        }
        if (Buffer.byteLength(value, "utf8") > MAX_REQUEST_HEADER_VALUE_BYTES) {
            throw new Error(`Request header '${name}' value is too long`);
        }
        if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
            throw new Error(`Request header '${name}' contains forbidden control characters`);
        }

        names.add(normalizedName);
        parsed[name] = value;
    }

    return parsed;
}

/** Alias with a domain-specific name for webhook configuration consumers. */
export const parseWebhookRequestHeaders = parseRequestHeaders;

/** Merges configured headers while making transport-owned headers authoritative. */
export function mergeRequestHeaders(
    configured: Record<string, string>,
    internal: Record<string, string>,
): Record<string, string> {
    const merged: Record<string, string> = {};
    const configuredNames = new Map<string, string>();
    for (const [name, value] of Object.entries(configured)) {
        configuredNames.set(name.toLowerCase(), name);
        merged[name] = value;
    }
    for (const [name, value] of Object.entries(internal)) {
        const configuredName = configuredNames.get(name.toLowerCase());
        if (configuredName) delete merged[configuredName];
        merged[name] = value;
    }
    return merged;
}

export interface ValidateUrlOptions {
    allowHttp?: boolean;
    allowLocal?: boolean;
    allowedHostnames?: string[];
}

/** Validates URL policy and every DNS answer before the transport is opened. */
export async function validateSafeUrl(
    urlStr: string,
    options: ValidateUrlOptions = {},
    lookup: (hostname: string) => Promise<LookupAddress[]> = hostname => dns.promises.lookup(hostname, { all: true })
): Promise<{ valid: boolean; error?: string; url?: URL; resolvedIps?: string[] }> {
    if (!urlStr || typeof urlStr !== "string") return { valid: false, error: "URL must be a non-empty string" };

    let parsed: URL;
    try { parsed = new URL(urlStr); } catch { return { valid: false, error: "Malformed URL" }; }
    const allowedProtocols = options.allowHttp ? ["https:", "http:"] : ["https:"];
    if (!allowedProtocols.includes(parsed.protocol)) return { valid: false, error: `Protocol '${parsed.protocol}' is not allowed. HTTPS${options.allowHttp ? " and HTTP" : " only"} is supported.` };
    if (parsed.username || parsed.password) return { valid: false, error: "URL credentials are not allowed" };

    const hostname = parsed.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
    if (!hostname) return { valid: false, error: "URL missing valid hostname" };
    if (options.allowedHostnames?.length) {
        const matches = options.allowedHostnames.some(allowed => {
            const normalized = allowed.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
            return hostname === normalized || hostname.endsWith(`.${normalized}`);
        });
        if (!matches) return { valid: false, error: `Hostname '${hostname}' is not in the allowed domains list` };
    }
    if (!options.allowLocal && (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local"))) {
        return { valid: false, error: "Access to local hostnames is forbidden" };
    }

    const family = net.isIP(hostname);
    if (family) {
        if (isPrivateOrReservedIp(hostname) && !(options.allowLocal && isExplicitlyAllowedLocalIp(hostname))) {
            return { valid: false, error: `Access to private or reserved IP address (${hostname}) is forbidden` };
        }
        return { valid: true, url: parsed, resolvedIps: [hostname] };
    }

    try {
        const results = await lookup(hostname);
        if (!results?.length) return { valid: false, error: `Unable to resolve hostname '${hostname}'` };
        if (results.some(result => isPrivateOrReservedIp(result.address) && !(options.allowLocal && isExplicitlyAllowedLocalIp(result.address)))) {
            return { valid: false, error: "Hostname resolves to a private or reserved IP address" };
        }
        return { valid: true, url: parsed, resolvedIps: results.map(result => result.address) };
    } catch (error) {
        return { valid: false, error: `DNS lookup failed for '${hostname}': ${error instanceof Error ? error.message : "unknown error"}` };
    }
}

export interface SafeFetchOptions extends ValidateUrlOptions {
    maxBytes?: number;
    timeoutMs?: number;
}

export interface SafeRequestOptions extends SafeFetchOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Buffer;
    followRedirects?: boolean;
    maxRedirects?: number;
}

export interface SafeHttpResponse {
    status: number;
    statusText: string;
    headers: Headers;
    body: Buffer;
}

export type SafeRequestDependencies = {
    lookup: (hostname: string) => Promise<LookupAddress[]>;
    request: (url: URL, pinnedAddress: string, options: SafeRequestOptions) => Promise<SafeHttpResponse>;
};

const defaultDependencies: SafeRequestDependencies = {
    lookup: hostname => dns.promises.lookup(hostname, { all: true }),
    request: nodePinnedRequest
};

function nodePinnedRequest(url: URL, pinnedAddress: string, options: SafeRequestOptions): Promise<SafeHttpResponse> {
    return new Promise((resolve, reject) => {
        const transport = url.protocol === "https:" ? https : http;
        const host = url.hostname.replace(/^\[|\]$/g, "");
        const headers = { ...(options.headers ?? {}) };
        for (const key of Object.keys(headers)) if (key.toLowerCase() === "host") delete headers[key];
        const requestOptions: https.RequestOptions = {
            protocol: url.protocol,
            hostname: host,
            port: url.port || undefined,
            method: options.method ?? "GET",
            path: `${url.pathname}${url.search}`,
            headers: { ...headers, host: url.host },
            // A fresh socket ensures no pooled connection bypasses the validated IP.
            agent: false,
            lookup: (_hostname: string, _lookupOptions: unknown, callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void) => {
                callback(null, pinnedAddress, net.isIP(pinnedAddress));
            },
            ...(url.protocol === "https:" && !net.isIP(host) ? { servername: host } : {})
        };
        const request = transport.request(requestOptions, response => {
            const chunks: Buffer[] = [];
            let size = 0;
            const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
            response.on("data", chunk => {
                const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                size += data.length;
                if (size > maxBytes) {
                    request.destroy(new Error(`Response exceeds the maximum permitted size of ${maxBytes} bytes`));
                    return;
                }
                chunks.push(data);
            });
            response.on("end", () => resolve({
                status: response.statusCode ?? 0,
                statusText: response.statusMessage ?? "",
                headers: new Headers(Object.entries(response.headers).flatMap(([key, value]) =>
                    value === undefined ? [] : (Array.isArray(value) ? value : [value]).map(item => [key, String(item)] as [string, string])
                )),
                body: Buffer.concat(chunks)
            }));
            response.on("error", reject);
        });
        const timer = setTimeout(() => request.destroy(new Error(`Request timed out after ${options.timeoutMs ?? 10000}ms`)), options.timeoutMs ?? 10000);
        request.on("error", error => { clearTimeout(timer); reject(error); });
        request.on("close", () => clearTimeout(timer));
        if (options.body !== undefined) request.write(options.body);
        request.end();
    });
}

/**
 * Performs a request only to a previously validated DNS answer. DNS is resolved
 * once per hop and the exact selected IP is pinned in the socket lookup callback.
 * Redirects are denied by default; GET media downloads may opt into revalidation.
 * The dependency parameter exists for deterministic unit tests.
 */
export async function safeRequest(
    urlStr: string,
    options: SafeRequestOptions = {},
    dependencies: SafeRequestDependencies = defaultDependencies
): Promise<SafeHttpResponse> {
    const method = options.method ?? "GET";
    if (options.body && Buffer.byteLength(options.body) > (options.maxBytes ?? 16 * 1024 * 1024)) {
        throw new Error("Request body exceeds the configured size limit");
    }
    let current = urlStr;
    const maxRedirects = options.maxRedirects ?? 3;
    for (let redirectCount = 0; redirectCount <= (options.followRedirects ? maxRedirects : 0); redirectCount++) {
        const validation = await validateSafeUrl(current, options, dependencies.lookup);
        if (!validation.valid || !validation.url || !validation.resolvedIps?.length) throw new Error(`SSRF Prevention: ${validation.error}`);
        const response = await dependencies.request(validation.url, validation.resolvedIps[0], options);
        if (response.body.length > (options.maxBytes ?? 16 * 1024 * 1024)) throw new Error("Response exceeds the configured size limit");

        if (response.status >= 300 && response.status < 400) {
            if (!options.followRedirects) throw new Error(`Redirect response (${response.status}) is not allowed`);
            const location = response.headers.get("location");
            if (!location) throw new Error(`Redirect response (${response.status}) missing Location header`);
            if (method !== "GET" && method !== "HEAD") throw new Error("Redirects are not allowed for non-idempotent requests");
            if (redirectCount === maxRedirects) throw new Error(`Too many redirects (max ${maxRedirects})`);
            current = new URL(location, validation.url).toString();
            continue;
        }
        return response;
    }
    throw new Error(`Too many redirects (max ${maxRedirects})`);
}

/** Safely downloads a remote file with IP pinning, size limits and timeout. */
export async function safeFetchBuffer(
    urlStr: string,
    options: SafeFetchOptions = {}
): Promise<{ buffer: Buffer; contentType: string; fileName?: string }> {
    const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
    const response = await safeRequest(urlStr, { ...options, method: "GET", followRedirects: true, maxBytes });
    if (response.status < 200 || response.status >= 300) throw new Error(`Remote server responded with HTTP ${response.status} ${response.statusText}`);
    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > maxBytes) throw new Error(`File size (${contentLength} bytes) exceeds the maximum limit of ${maxBytes} bytes`);
    if (response.body.length === 0) throw new Error("Empty response body from remote server");
    return {
        buffer: response.body,
        contentType: response.headers.get("content-type") || "application/octet-stream",
        fileName: new URL(urlStr).pathname.split("/").pop() || "media"
    };
}
