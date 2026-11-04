/**
 * Real JWT verification tests for requireClerkUser / verifyClerkSessionToken.
 * Tokens are signed locally with RS256. This is not a stubbed authenticate().
 *
 * Run: node --experimental-strip-types --test supabase/functions/_shared/clerk_auth_test.ts
 */
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  frontendApiFromPublishableKey,
  requireClerkUser,
  resetJwksCache,
} from "./clerk_auth.ts";

const PUBLISHABLE_KEY =
  "pk_test_aG9wZWZ1bC1sZW11ci00NTEwLmNsZXJrLmFjY291bnRzLmRldiQ";
const ISSUER = `https://${frontendApiFromPublishableKey(PUBLISHABLE_KEY)}`;

type KeyPair = {
  kid: string;
  privateKeyPem: string;
  jwk: JsonWebKey & { kid: string; alg: string; use: string };
};

function makeRsaKey(kid: string): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
  return {
    kid,
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    jwk: { ...jwk, kid, alg: "RS256", use: "sig" },
  };
}

function signRs256(
  payload: Record<string, unknown>,
  key: KeyPair,
  headerExtra: Record<string, unknown> = {},
): string {
  const header = { alg: "RS256", typ: "JWT", kid: key.kid, ...headerExtra };
  const head = Buffer.from(JSON.stringify(header)).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${body}`);
  signer.end();
  const sig = signer.sign(key.privateKeyPem).toString("base64url");
  return `${head}.${body}.${sig}`;
}

function bearerRequest(token: string): Request {
  return new Request("https://example.test/extract-workout-set", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

function env(extra: Record<string, string> = {}) {
  const values: Record<string, string> = {
    CLERK_SECRET_KEY: "sk_test_dummy_not_sent",
    CLERK_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
    ...extra,
  };
  return (name: string) => values[name];
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

const primary = makeRsaKey("gymnos-test-1");
const other = makeRsaKey("gymnos-test-2");

function getJwks() {
  return Promise.resolve({ keys: [primary.jwk] });
}

function sessionClaims(overrides: Record<string, unknown> = {}) {
  const now = nowSeconds();
  return {
    sub: "user_test_member",
    iss: ISSUER,
    iat: now,
    nbf: now - 5,
    exp: now + 60,
    azp: "gymnos-dev",
    ...overrides,
  };
}

test("valid RS256 session token from the intended issuer is accepted", async () => {
  resetJwksCache();
  const token = signRs256(sessionClaims(), primary);
  const result = await requireClerkUser(bearerRequest(token), env(), { getJwks });
  assert.equal(result.userId, "user_test_member");
});

test("token with the wrong issuer is rejected", async () => {
  resetJwksCache();
  const token = signRs256(
    sessionClaims({ iss: "https://other-app.clerk.accounts.dev" }),
    primary,
  );
  await assert.rejects(
    () => requireClerkUser(bearerRequest(token), env(), { getJwks }),
    (err: { status?: number }) => err.status === 401,
  );
});

test("expired token is rejected", async () => {
  resetJwksCache();
  const now = nowSeconds();
  const token = signRs256(
    sessionClaims({ iat: now - 120, nbf: now - 120, exp: now - 30 }),
    primary,
  );
  await assert.rejects(
    () => requireClerkUser(bearerRequest(token), env(), { getJwks }),
    (err: { status?: number }) => err.status === 401,
  );
});

test("not-before in the future is rejected", async () => {
  resetJwksCache();
  const now = nowSeconds();
  const token = signRs256(
    sessionClaims({ nbf: now + 120, exp: now + 180 }),
    primary,
  );
  await assert.rejects(
    () => requireClerkUser(bearerRequest(token), env(), { getJwks }),
    (err: { status?: number }) => err.status === 401,
  );
});

test("token signed with a different RSA key is rejected", async () => {
  resetJwksCache();
  const token = signRs256(sessionClaims(), other);
  await assert.rejects(
    () => requireClerkUser(bearerRequest(token), env(), { getJwks }),
    (err: { status?: number }) => err.status === 401,
  );
});

test("unauthorized party is rejected when an allow-list is configured", async () => {
  resetJwksCache();
  const token = signRs256(sessionClaims({ azp: "some-other-client" }), primary);
  await assert.rejects(
    () =>
      requireClerkUser(
        bearerRequest(token),
        env({ CLERK_AUTHORIZED_PARTIES: "gymnos-dev" }),
        { getJwks },
      ),
    (err: { status?: number }) => err.status === 401,
  );
});

test("alg none is rejected", async () => {
  resetJwksCache();
  const claims = sessionClaims();
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT", kid: primary.kid }))
    .toString("base64url");
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const token = `${header}.${body}.`;
  await assert.rejects(
    () => requireClerkUser(bearerRequest(token), env(), { getJwks }),
    (err: { status?: number }) => err.status === 401,
  );
});

test("authorized party is accepted when it matches the allow-list", async () => {
  resetJwksCache();
  const token = signRs256(sessionClaims({ azp: "gymnos-dev" }), primary);
  const result = await requireClerkUser(
    bearerRequest(token),
    env({ CLERK_AUTHORIZED_PARTIES: "gymnos-dev" }),
    { getJwks },
  );
  assert.equal(result.userId, "user_test_member");
});

test("HS256 tokens are rejected", async () => {
  resetJwksCache();
  const claims = sessionClaims();
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT", kid: primary.kid }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const token = `${header}.${body}.not-a-real-hmac`;
  await assert.rejects(
    () => requireClerkUser(bearerRequest(token), env(), { getJwks }),
    (err: { status?: number }) => err.status === 401,
  );
});

test("token without exp is rejected", async () => {
  resetJwksCache();
  const claims = sessionClaims();
  delete claims.exp;
  const token = signRs256(claims, primary);
  await assert.rejects(
    () => requireClerkUser(bearerRequest(token), env(), { getJwks }),
    (err: { status?: number }) => err.status === 401,
  );
});

test("missing azp is rejected when an allow-list is configured", async () => {
  resetJwksCache();
  const claims = sessionClaims();
  delete claims.azp;
  const token = signRs256(claims, primary);
  await assert.rejects(
    () =>
      requireClerkUser(
        bearerRequest(token),
        env({ CLERK_AUTHORIZED_PARTIES: "gymnos-dev" }),
        { getJwks },
      ),
    (err: { status?: number }) => err.status === 401,
  );
});

test("missing azp is accepted when no allow-list is configured", async () => {
  resetJwksCache();
  const claims = sessionClaims();
  delete claims.azp;
  const token = signRs256(claims, primary);
  const result = await requireClerkUser(bearerRequest(token), env(), { getJwks });
  assert.equal(result.userId, "user_test_member");
});

test("missing Clerk keys fail closed with 503", async () => {
  resetJwksCache();
  const token = signRs256(sessionClaims(), primary);
  await assert.rejects(
    () => requireClerkUser(bearerRequest(token), () => undefined, { getJwks }),
    (err: { status?: number }) => err.status === 503,
  );
});

test("unknown kid refreshes JWKS and then accepts the rotated key", async () => {
  resetJwksCache();
  let fetches = 0;
  const rotatedGetJwks = async () => {
    fetches += 1;
    return { keys: fetches === 1 ? [primary.jwk] : [other.jwk] };
  };
  const token = signRs256(sessionClaims(), other);
  const result = await requireClerkUser(bearerRequest(token), env(), {
    getJwks: rotatedGetJwks,
  });
  assert.equal(result.userId, "user_test_member");
  assert.equal(fetches, 2);
});
