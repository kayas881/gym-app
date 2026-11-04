/**
 * Verify a Clerk session JWT from Authorization: Bearer.
 *
 * The Supabase Edge gateway cannot validate Clerk tokens (they are not
 * Supabase JWTs; auth.uid() is always null). Verification is done here with
 * Web Crypto so the same code runs on Deno and in Node tests:
 *   - signature against the instance JWKS
 *   - algorithm pinned to RS256 (alg=none / HS* rejected)
 *   - exp and nbf with a 5s clock tolerance
 *   - issuer derived from CLERK_PUBLISHABLE_KEY
 *   - optional azp allow-list from CLERK_AUTHORIZED_PARTIES
 *
 * CLERK_PUBLISHABLE_KEY selects the Clerk instance (FAPI host / iss).
 * CLERK_SECRET_KEY authenticates the JWKS fetch from Clerk's Backend API
 * so we only accept signing keys for that instance.
 *
 * JWKS is cached in-process for 10 minutes and refreshed once on an unknown
 * kid so a Clerk key rotation is picked up.
 *
 * Docs: https://clerk.com/docs/guides/sessions/manual-jwt-verification
 */

export type EnvReader = (name: string) => string | undefined;

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type ClerkAuthDeps = {
  getJwks?: () => Promise<unknown>;
  now?: () => Date;
};

const ALLOWED_ALG = "RS256";
const CLOCK_TOLERANCE_SECONDS = 5;
const JWKS_CACHE_MS = 10 * 60 * 1000;

type JwksCache = {
  expiresAt: number;
  body: unknown;
};

let jwksCache: JwksCache | null = null;

export function resetJwksCache(): void {
  jwksCache = null;
}

export function readBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

export function frontendApiFromPublishableKey(publishableKey: string): string {
  const parts = publishableKey.split("_");
  if (parts.length < 3) {
    throw new AuthError("auth_not_configured", 503);
  }
  const encoded = parts.slice(2).join("_");
  const padded = encoded + "=".repeat((4 - (encoded.length % 4)) % 4);
  const decoded = atob(padded);
  return decoded.replace(/\$+$/g, "");
}

export function issuerFromPublishableKey(publishableKey: string): string {
  return `https://${frontendApiFromPublishableKey(publishableKey)}`;
}

function decodeSegment(segment: string): unknown {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (segment.length % 4)) % 4);
  return JSON.parse(atob(padded));
}

function bytesOf(segment: string): Uint8Array {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (segment.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

type Jwk = {
  kid?: string;
  kty?: string;
  alg?: string;
  n?: string;
  e?: string;
};

function jwksKeys(body: unknown): Jwk[] {
  if (!body || typeof body !== "object" || !("keys" in body)) return [];
  const keys = (body as { keys: unknown }).keys;
  return Array.isArray(keys) ? (keys as Jwk[]) : [];
}

function findKey(keys: Jwk[], kid: string | undefined): Jwk | undefined {
  if (kid) {
    return keys.find((key) => key.kid === kid && key.kty === "RSA");
  }
  const rsa = keys.filter((key) => key.kty === "RSA");
  return rsa.length === 1 ? rsa[0] : undefined;
}

function claimTime(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function verifyRs256Signature(
  signingInput: string,
  signature: Uint8Array,
  jwk: Jwk,
): Promise<boolean> {
  if (!jwk.n || !jwk.e) return false;
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature.buffer as ArrayBuffer,
    new TextEncoder().encode(signingInput),
  );
}

async function fetchInstanceJwks(secretKey: string): Promise<unknown> {
  const now = Date.now();
  if (jwksCache && jwksCache.expiresAt > now) {
    return jwksCache.body;
  }

  const jwksRes = await fetch("https://api.clerk.com/v1/jwks", {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!jwksRes.ok) {
    throw new AuthError("auth_not_configured", 503);
  }
  const body = await jwksRes.json();
  jwksCache = { body, expiresAt: now + JWKS_CACHE_MS };
  return body;
}

export async function verifyClerkSessionToken(
  token: string,
  options: {
    issuer: string;
    authorizedParties?: string[];
    getJwks: () => Promise<unknown>;
    now?: () => Date;
  },
): Promise<{ userId: string }> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new AuthError("unauthorized", 401);
  }

  let header: { alg?: unknown; kid?: unknown };
  let payload: Record<string, unknown>;
  try {
    header = decodeSegment(parts[0]) as { alg?: unknown; kid?: unknown };
    payload = decodeSegment(parts[1]) as Record<string, unknown>;
  } catch {
    throw new AuthError("unauthorized", 401);
  }

  if (header.alg !== ALLOWED_ALG) {
    throw new AuthError("unauthorized", 401);
  }

  const kid = typeof header.kid === "string" ? header.kid : undefined;
  let keys = jwksKeys(await options.getJwks());
  let jwk = findKey(keys, kid);
  if (!jwk) {
    resetJwksCache();
    keys = jwksKeys(await options.getJwks());
    jwk = findKey(keys, kid);
  }
  if (!jwk) {
    throw new AuthError("unauthorized", 401);
  }

  const ok = await verifyRs256Signature(
    `${parts[0]}.${parts[1]}`,
    bytesOf(parts[2]),
    jwk,
  );
  if (!ok) {
    throw new AuthError("unauthorized", 401);
  }

  if (payload.iss !== options.issuer) {
    throw new AuthError("unauthorized", 401);
  }

  const now = Math.floor((options.now ? options.now() : new Date()).getTime() / 1000);
  const exp = claimTime(payload.exp);
  const nbf = claimTime(payload.nbf);
  if (exp === null || now > exp + CLOCK_TOLERANCE_SECONDS) {
    throw new AuthError("unauthorized", 401);
  }
  if (nbf !== null && now + CLOCK_TOLERANCE_SECONDS < nbf) {
    throw new AuthError("unauthorized", 401);
  }

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new AuthError("unauthorized", 401);
  }

  if (options.authorizedParties && options.authorizedParties.length > 0) {
    const azp = typeof payload.azp === "string" ? payload.azp : "";
    if (!options.authorizedParties.includes(azp)) {
      throw new AuthError("unauthorized", 401);
    }
  }

  return { userId: payload.sub };
}

export async function requireClerkUser(
  req: Request,
  env: EnvReader,
  deps: ClerkAuthDeps = {},
): Promise<{ userId: string }> {
  const token = readBearerToken(req);
  if (!token) {
    throw new AuthError("unauthorized", 401);
  }

  const secretKey = env("CLERK_SECRET_KEY")?.trim();
  const publishableKey = env("CLERK_PUBLISHABLE_KEY")?.trim();
  if (!secretKey || !publishableKey) {
    throw new AuthError("auth_not_configured", 503);
  }

  const allowed = env("CLERK_AUTHORIZED_PARTIES")?.trim();
  const authorizedParties = allowed
    ? allowed.split(",").map((item) => item.trim()).filter(Boolean)
    : undefined;

  return verifyClerkSessionToken(token, {
    issuer: issuerFromPublishableKey(publishableKey),
    authorizedParties,
    getJwks: deps.getJwks ?? (() => fetchInstanceJwks(secretKey)),
    now: deps.now,
  });
}
