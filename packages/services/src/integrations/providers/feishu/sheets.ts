import type { ExternalResourceDescriptor } from "../../core/index.ts";

const FEISHU_SHEET_TOKEN_PATTERN = /sheets?\/([A-Za-z0-9_-]+)/;

export function resolveFeishuSheetResource(value: string): ExternalResourceDescriptor | null {
  const trimmed = value.trim();
  const token = FEISHU_SHEET_TOKEN_PATTERN.exec(trimmed)?.[1] ?? normalizeToken(trimmed);
  if (!token) {
    return null;
  }
  return {
    providerResourceType: "sheet",
    providerResourceToken: token,
    providerResourceUrl: trimmed.startsWith("http") ? trimmed : undefined,
  };
}

function normalizeToken(value: string): string | undefined {
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]{8,}$/.test(trimmed) ? trimmed : undefined;
}
