import { createHash } from "node:crypto";

export interface ExternalReferenceOptions {
  hashLength?: number;
  prefix?: string;
  separator?: string;
}

export function buildExternalIdHash(value: string, hashLength = 16): string {
  return hashExternalId(value, hashLength);
}

export function buildExternalIdReference(
  value: string,
  options: ExternalReferenceOptions = {},
): string {
  const hash = hashExternalId(value, options.hashLength ?? 8);
  const prefix = options.prefix ?? "ref";
  const separator = options.separator ?? "_";
  return prefix ? `${prefix}${separator}${hash}` : hash;
}

export function buildOptionalExternalIdReference(
  value: string | undefined | null,
  options: ExternalReferenceOptions = {},
): string | undefined {
  const normalized = value?.trim();
  return normalized ? buildExternalIdReference(normalized, options) : undefined;
}

export function buildLabeledExternalIdReference(
  label: string,
  value: string | undefined | null,
  options: Omit<ExternalReferenceOptions, "prefix" | "separator"> = {},
): string | undefined {
  const normalized = value?.trim();
  return normalized ? `${label} ${hashExternalId(normalized, options.hashLength ?? 16)}` : undefined;
}

function hashExternalId(value: string, hashLength: number): string {
  const normalizedLength = Math.max(1, Math.min(64, Math.floor(hashLength)));
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, normalizedLength);
}
