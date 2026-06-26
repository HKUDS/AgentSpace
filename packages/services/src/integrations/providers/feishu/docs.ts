import type { ExternalResourceDescriptor } from "../../core/index.ts";

const FEISHU_DOC_TOKEN_PATTERN = /(?:docx?|docs|wiki)\/([A-Za-z0-9_-]+)/;

export function resolveFeishuDocResource(value: string): ExternalResourceDescriptor | null {
  const trimmed = value.trim();
  const parsed = parseFeishuDocResource(trimmed);
  const token = parsed?.token ?? normalizeToken(trimmed);
  if (!token) {
    return null;
  }
  return {
    providerResourceType: "doc",
    providerResourceToken: token,
    providerResourceUrl: trimmed.startsWith("http") ? trimmed : undefined,
    metadata: {
      docType: parsed?.docType ?? "docx",
    },
  };
}

function parseFeishuDocResource(value: string): { token: string; docType: "doc" | "docx" | "wiki" } | undefined {
  const match = FEISHU_DOC_TOKEN_PATTERN.exec(value.trim());
  if (!match?.[1]) {
    return undefined;
  }
  return {
    token: match[1],
    docType: resolveFeishuDocType(match[0]),
  };
}

function resolveFeishuDocType(matchedPath: string): "doc" | "docx" | "wiki" {
  if (matchedPath.startsWith("wiki/")) {
    return "wiki";
  }
  if (matchedPath.startsWith("docs/") || matchedPath.startsWith("doc/")) {
    return "doc";
  }
  return "docx";
}

function normalizeToken(value: string): string | undefined {
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]{8,}$/.test(trimmed) ? trimmed : undefined;
}
