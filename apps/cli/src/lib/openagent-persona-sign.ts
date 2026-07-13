import {
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from "node:crypto";
import type { OpenAgentPersona } from "@agent-space/domain";

/**
 * Node-layer signer for OpenAgent persona-cards. The pure `employeeToPersona()`
 * mapper (packages/domain) produces an unsigned persona; this composes on top of
 * it to attach a self-verifying ed25519 provenance block and derive the agent's
 * did:key address. It lives here — not in packages/domain — because it depends on
 * node:crypto and Buffer, which the runtime-agnostic domain build cannot type.
 *
 * The canonicalisation, ed25519 signature and did:key derivation mirror
 * `@5dive/openagent` (lib/provenance.js) exactly, so a signed export validates and
 * verifies with `npx @5dive/openagent validate` / provenance verify without any
 * dependency on the (CommonJS) CLI package.
 */

export interface SignPersonaOptions {
  /** Fixed timestamp (ISO 8601) for the provenance block; defaults to now. */
  now?: string;
  /** Deterministic keypair injection for tests / reproducible exports. */
  keyPair?: { publicKey: KeyObject; privateKey: KeyObject };
}

export interface SignPersonaResult {
  persona: OpenAgentPersona;
  /** The agent's canonical public address, e.g. "did:key:z6Mk…". */
  didKey: string;
}

// ---- canonicalisation (mirrors @5dive/openagent lib/provenance.js) ----------

// Deterministic JSON: object keys sorted recursively, primitives via JSON.stringify.
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// The exact bytes a signature covers: the whole persona with
// provenance.signature removed. Round-trips through JSON to drop undefined.
function canonicalBytes(persona: OpenAgentPersona): Buffer {
  const clone = JSON.parse(JSON.stringify(persona)) as OpenAgentPersona;
  if (clone.provenance) {
    delete clone.provenance.signature;
  }
  return Buffer.from(stableStringify(clone), "utf8");
}

// ---- did:key address (multicodec ed25519-pub + base58btc) -------------------

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58btcEncode(bytes: Buffer): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) {
    zeros += 1;
  }
  const digits: number[] = [];
  for (let index = zeros; index < bytes.length; index += 1) {
    let carry = bytes[index];
    for (let digitIndex = 0; digitIndex < digits.length; digitIndex += 1) {
      carry += digits[digitIndex] << 8;
      digits[digitIndex] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = "1".repeat(zeros);
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    out += BASE58_ALPHABET[digits[index]];
  }
  return out;
}

// Raw 32-byte ed25519 public key via JWK export (no hand-parsed SPKI offsets).
function rawEd25519PublicKey(publicKey: KeyObject): Buffer {
  const jwk = publicKey.export({ format: "jwk" }) as { crv?: string; x?: string };
  if (jwk.crv !== "Ed25519" || !jwk.x) {
    throw new Error("did:key needs an Ed25519 public key");
  }
  const raw = Buffer.from(jwk.x, "base64url");
  if (raw.length !== 32) {
    throw new Error(`unexpected ed25519 key length: ${raw.length}`);
  }
  return raw;
}

/** Derive the did:key public address for an ed25519 public key. */
export function didKeyFromPublicKey(publicKey: KeyObject): string {
  const raw = rawEd25519PublicKey(publicKey);
  const prefixed = Buffer.concat([Buffer.from([0xed, 0x01]), raw]); // 0xed01 = ed25519-pub
  return `did:key:z${base58btcEncode(prefixed)}`;
}

// ---- signing ----------------------------------------------------------------

/**
 * Attach a signed ed25519 provenance block to a persona (mutating it in place)
 * and return it alongside the signer's did:key address. Mints a fresh keypair
 * unless one is injected via `opts.keyPair`.
 */
export function signPersona(
  persona: OpenAgentPersona,
  opts: SignPersonaOptions = {},
): SignPersonaResult {
  const { publicKey, privateKey } = opts.keyPair ?? generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString().trim();

  persona.provenance = {
    created_by: {
      name: persona.name,
      key: publicPem,
      url: "https://github.com/HKUDS/AgentSpace",
    },
    signed_at: opts.now ?? new Date().toISOString(),
  };

  persona.provenance.signature = edSign(null, canonicalBytes(persona), privateKey).toString("base64");

  return { persona, didKey: didKeyFromPublicKey(publicKey) };
}

/**
 * Verify a signed persona's provenance block the same way `@5dive/openagent`
 * does: recompute the canonical bytes (signature removed) and check the ed25519
 * signature against created_by.key.
 */
export function verifyPersonaSignature(persona: OpenAgentPersona): boolean {
  const sig = persona.provenance?.signature;
  const key = persona.provenance?.created_by?.key;
  if (!sig || !key) {
    return false;
  }
  const publicKey = createPublicKey(key);
  return edVerify(null, canonicalBytes(persona), publicKey, Buffer.from(sig, "base64"));
}
