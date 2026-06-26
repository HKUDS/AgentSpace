import type { ExternalResourceDescriptor } from "../../core/index.ts";

const FEISHU_BASE_TOKEN_PATTERN = /base\/([A-Za-z0-9_-]+)/;
const FEISHU_BITABLE_TOKEN_PATTERN = /bitable\/([A-Za-z0-9_-]+)/;

export function resolveFeishuBaseResource(value: string): ExternalResourceDescriptor | null {
  const trimmed = value.trim();
  const token = FEISHU_BASE_TOKEN_PATTERN.exec(trimmed)?.[1]
    ?? FEISHU_BITABLE_TOKEN_PATTERN.exec(trimmed)?.[1]
    ?? normalizeToken(trimmed);
  if (!token) {
    return null;
  }
  return {
    providerResourceType: "base",
    providerResourceToken: token,
    providerResourceUrl: trimmed.startsWith("http") ? trimmed : undefined,
  };
}

function normalizeToken(value: string): string | undefined {
  return /^[A-Za-z0-9_-]{8,}$/.test(value) ? value : undefined;
}
